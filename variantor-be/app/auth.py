import secrets
import time
from dataclasses import dataclass

from flask import Request, Response
from werkzeug.security import check_password_hash, generate_password_hash

from app.db import connect


COOKIE_NAME = "ta_session"
SESSION_TTL_SECONDS = 7 * 24 * 60 * 60


class InvalidCredentials(Exception):
    pass


@dataclass(frozen=True)
class User:
    id: str
    email: str

    def as_dict(self) -> dict:
        return {"id": self.id, "email": self.email}


class AuthService:
    def __init__(self, email: str, password: str, cookie_secure: bool):
        self.email = email
        self.password = password
        self.cookie_secure = cookie_secure
        self._sessions: dict[str, tuple[str, float]] = {}
        self._ensure_default_user()

    def login(self, response: Response, email: str, password: str) -> User:
        user = self._user_by_email(email)
        if user is None or not check_password_hash(user["password_hash"], password):
            raise InvalidCredentials()
        return self._start_session(response, User(id=str(user["id"]), email=str(user["email"])))

    def register(self, response: Response, email: str, password: str) -> User:
        email = (email or "").strip().lower()
        password = password or ""
        if not email or "@" not in email or len(password) < 4:
            raise InvalidCredentials()
        user_id = secrets.token_hex(16)
        with connect() as conn:
            exists = conn.execute("select 1 from users where lower(email) = lower(%s)", (email,)).fetchone()
            if exists:
                raise InvalidCredentials()
            conn.execute(
                "insert into users (id, email, password_hash) values (%s, %s, %s)",
                (user_id, email, generate_password_hash(password)),
            )
        return self._start_session(response, User(id=user_id, email=email))

    def _start_session(self, response: Response, user: User) -> User:
        session_id = secrets.token_hex(32)
        self._sessions[session_id] = (user.id, time.time() + SESSION_TTL_SECONDS)
        response.set_cookie(
            COOKIE_NAME,
            session_id,
            max_age=SESSION_TTL_SECONDS,
            httponly=True,
            secure=self.cookie_secure,
            samesite="Lax",
            path="/",
        )
        return user

    def logout(self, response: Response, request: Request) -> None:
        session_id = request.cookies.get(COOKIE_NAME)
        if session_id:
            self._sessions.pop(session_id, None)
        response.set_cookie(
            COOKIE_NAME,
            "",
            max_age=0,
            httponly=True,
            secure=self.cookie_secure,
            samesite="Lax",
            path="/",
        )

    def is_authenticated(self, request: Request) -> bool:
        return self.current_user(request) is not None

    def current_user(self, request: Request) -> User | None:
        session_id = request.cookies.get(COOKIE_NAME)
        if not session_id:
            return None
        session = self._sessions.get(session_id)
        if session is None:
            return None
        user_id, expires_at = session
        if time.time() > expires_at:
            self._sessions.pop(session_id, None)
            return None
        with connect() as conn:
            user = conn.execute("select id, email from users where id = %s", (user_id,)).fetchone()
        if user is None:
            self._sessions.pop(session_id, None)
            return None
        return User(id=str(user["id"]), email=str(user["email"]))

    def system_user(self) -> User:
        return User(id="default-user", email=self.email)

    def _ensure_default_user(self) -> None:
        with connect() as conn:
            user = conn.execute("select id from users where id = 'default-user'").fetchone()
            if user is None:
                conn.execute(
                    "insert into users (id, email, password_hash) values (%s, %s, %s)",
                    ("default-user", self.email, generate_password_hash(self.password)),
                )
                return
            if self.email:
                conn.execute(
                    "update users set email = %s where id = 'default-user' and email <> %s",
                    (self.email, self.email),
                )

    def _user_by_email(self, email: str) -> dict | None:
        with connect() as conn:
            return conn.execute(
                "select * from users where lower(email) = lower(%s)",
                ((email or "").strip(),),
            ).fetchone()

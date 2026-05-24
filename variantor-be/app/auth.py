import hmac
import secrets
import time
from dataclasses import dataclass

from flask import Request, Response


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
        self._sessions: dict[str, float] = {}

    def login(self, response: Response, email: str, password: str) -> User:
        if not hmac.compare_digest(email, self.email) or not hmac.compare_digest(password, self.password):
            raise InvalidCredentials()
        session_id = secrets.token_hex(32)
        self._sessions[session_id] = time.time() + SESSION_TTL_SECONDS
        response.set_cookie(
            COOKIE_NAME,
            session_id,
            max_age=SESSION_TTL_SECONDS,
            httponly=True,
            secure=self.cookie_secure,
            samesite="Lax",
            path="/",
        )
        return self.system_user()

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
        session_id = request.cookies.get(COOKIE_NAME)
        if not session_id:
            return False
        expires_at = self._sessions.get(session_id)
        if expires_at is None:
            return False
        if time.time() > expires_at:
            self._sessions.pop(session_id, None)
            return False
        return True

    def system_user(self) -> User:
        return User(id="default-user", email=self.email)

from flask import Flask
from flask_cors import CORS
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

from app.api import api
from app.config import Config
from app.db import init_db
from app.errors import ApiError


def create_app() -> Flask:
    app = Flask(__name__)
    config = Config()
    app.config.from_object(config)
    app.config["MAX_CONTENT_LENGTH"] = config.MAX_UPLOAD_BYTES
    app.pipeline_config = config

    CORS(
        app,
        resources={r"/api/*": {"origins": app.config["CORS_ALLOWED_ORIGINS"]}},
        methods=["GET", "POST", "PUT", "OPTIONS"],
        allow_headers=["Content-Type"],
        supports_credentials=True,
    )

    init_db(app.config["DATABASE_URL"], app.config["MIGRATIONS_DIR"])
    app.register_blueprint(api, url_prefix="/api")

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    register_error_handlers(app)
    return app


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(ApiError)
    def handle_api_error(error: ApiError):
        return {"error": {"code": error.code, "message": error.message}}, error.status_code

    @app.errorhandler(RequestEntityTooLarge)
    def handle_too_large(_: RequestEntityTooLarge):
        return {"error": {"code": "file_too_large", "message": "Файл слишком большой."}}, 413

    @app.errorhandler(HTTPException)
    def handle_http_error(error: HTTPException):
        return {
            "error": {
                "code": error.name.lower().replace(" ", "_"),
                "message": error.description,
            }
        }, error.code or 500

    @app.errorhandler(Exception)
    def handle_unexpected_error(error: Exception):
        app.logger.exception("Unhandled backend error")
        return {"error": {"code": "internal_error", "message": "Внутренняя ошибка сервера."}}, 500

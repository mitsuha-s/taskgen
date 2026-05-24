from flask import Blueprint, current_app, jsonify, make_response, request, send_file

from app.auth import AuthService, InvalidCredentials
from app.errors import NotFoundError, ValidationError
from app.pipeline.service import PipelineService

api = Blueprint("api", __name__)


def service() -> PipelineService:
    if not hasattr(current_app, "pipeline_service"):
        current_app.pipeline_service = PipelineService(current_app.pipeline_config)
    return current_app.pipeline_service


def auth_service() -> AuthService:
    if not hasattr(current_app, "auth_service"):
        config = current_app.pipeline_config
        current_app.auth_service = AuthService(
            email=config.AUTH_EMAIL,
            password=config.AUTH_PASSWORD,
            cookie_secure=config.COOKIE_SECURE,
        )
    return current_app.auth_service


@api.before_request
def require_auth():
    if request.method == "OPTIONS":
        return None
    if request.endpoint in {"api.login", "api.health"}:
        return None
    if not auth_service().is_authenticated(request):
        return jsonify({"error": {"code": "unauthorized", "message": "Authentication is required."}}), 401
    return None


@api.get("/health")
def health():
    return jsonify({"ok": True, "service": "variantor-be"})


@api.post("/auth/login")
def login():
    payload = request.get_json(silent=True) or {}
    response = make_response()
    try:
        user = auth_service().login(response, payload.get("email", ""), payload.get("password", ""))
    except InvalidCredentials:
        return jsonify({"error": {"code": "invalid_credentials", "message": "Invalid email or password."}}), 401
    response.set_data(jsonify({"user": user.as_dict()}).get_data())
    response.content_type = "application/json"
    return response


@api.post("/auth/logout")
def logout():
    response = make_response(jsonify({"ok": True}))
    auth_service().logout(response, request)
    return response


@api.get("/me")
def me():
    return jsonify({"user": auth_service().system_user().as_dict()})


@api.post("/assignments")
def create_assignment():
    payload = request.get_json(silent=True) or {}
    assignment = service().create_assignment(payload.get("title") or "")
    return jsonify(assignment), 201


@api.get("/assignments/<assignment_id>")
def get_assignment(assignment_id: str):
    return jsonify(service().get_assignment(assignment_id))


@api.post("/assignments/<assignment_id>/image")
def upload_assignment_image(assignment_id: str):
    return jsonify(service().save_assignment_image(assignment_id, request.files.get("file")))


@api.post("/assignments/<assignment_id>/extract")
def start_extraction(assignment_id: str):
    payload = request.get_json(silent=True) or {}
    return jsonify(service().start_extraction(assignment_id, payload)), 202


@api.get("/extraction-runs/<run_id>")
def get_extraction_run(run_id: str):
    return jsonify(service().get_run(run_id))


@api.post("/extraction-runs/<run_id>/continue")
def continue_extraction_run(run_id: str):
    payload = request.get_json(silent=True) or {}
    return jsonify(service().continue_run(run_id, payload)), 202


@api.put("/extraction-runs/<run_id>/steps/<int:step>")
def update_extraction_step(run_id: str, step: int):
    payload = request.get_json(silent=True) or {}
    return jsonify(service().update_step(run_id, step, payload.get("content") or ""))


@api.post("/extraction-runs/<run_id>/steps/<int:step>/regenerate")
def regenerate_extraction_step(run_id: str, step: int):
    return jsonify(service().regenerate_step(run_id, step)), 202


@api.get("/files/assignments/<assignment_id>/original")
def serve_assignment_image(assignment_id: str):
    image = service()._image_by_assignment_id(assignment_id)
    path = service().image_full_path(image)
    if not path.exists():
        raise NotFoundError("Assignment image file was not found.", code="image_not_found")
    return send_file(path, mimetype=image["mime_type"], download_name="original")


def parse_variant_count(_: str | None) -> int:
    raise ValidationError("This endpoint uses the old Variantor assignment contract.")

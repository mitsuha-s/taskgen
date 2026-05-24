class ApiError(Exception):
    code = "api_error"
    status_code = 400

    def __init__(self, message: str, *, code: str | None = None, status_code: int | None = None):
        super().__init__(message)
        self.message = message
        self.code = code or self.code
        self.status_code = status_code or self.status_code


class ValidationError(ApiError):
    code = "validation_failed"
    status_code = 400


class NotFoundError(ApiError):
    code = "not_found"
    status_code = 404


class PipelineStateError(ApiError):
    code = "invalid_pipeline_state"
    status_code = 400

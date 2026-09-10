"""API key authentication middleware."""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


class ApiKeyMiddleware(BaseHTTPMiddleware):
    """Check Bearer token on all routes except /health."""

    def __init__(self, app, api_key: str = ""):  # noqa: ANN001
        super().__init__(app)
        self.api_key = api_key

    async def dispatch(self, request: Request, call_next):  # noqa: ANN001
        if request.url.path == "/health":
            return await call_next(request)
        if not self.api_key:
            return await call_next(request)
        auth = request.headers.get("authorization", "")
        if auth != f"Bearer {self.api_key}":
            return JSONResponse(
                {"detail": "Invalid or missing API key"},
                status_code=401,
            )
        return await call_next(request)

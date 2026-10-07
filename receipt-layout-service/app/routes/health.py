"""Health check endpoint."""

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/health")
async def health(request: Request) -> dict:
    """Return service health status."""
    detector = getattr(request.app.state, "detector", None)
    model_loaded = detector is not None and detector.is_loaded()
    return {
        "status": "ok",
        "model_loaded": model_loaded,
        "version": "1.0.0",
    }

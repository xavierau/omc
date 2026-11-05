"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.middleware.auth import ApiKeyMiddleware
from app.routes import health, preprocess, templates, verify
from app.services.detector import LayoutDetector
from app.services.sam_segmenter import SAMSegmenter
from app.services.sanitizer import set_sam_segmenter
from app.utils.logging import setup_logging

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(application: FastAPI):  # noqa: ANN201
    """Log startup/shutdown. State is set eagerly in create_app."""
    setup_logging(application.state.settings.log_level)
    detector_ok = application.state.detector.is_loaded()
    sam_ok = application.state.sam_segmenter.is_loaded()
    logger.info(
        "Startup",
        extra={"data": {"model_loaded": detector_ok, "sam_loaded": sam_ok}},
    )
    yield
    logger.info("Shutdown")


def create_app() -> FastAPI:
    """Application factory. Eagerly sets state for testability."""
    settings = get_settings()
    application = FastAPI(title="Receipt Layout Service", lifespan=lifespan)
    application.state.settings = settings
    application.state.detector = LayoutDetector(settings.model_path)

    sam = SAMSegmenter(settings.sam_model_path)
    application.state.sam_segmenter = sam
    set_sam_segmenter(sam)

    application.add_middleware(ApiKeyMiddleware, api_key=settings.api_key)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(health.router)
    application.include_router(preprocess.router)
    application.include_router(templates.router)
    application.include_router(verify.router)
    return application


app = create_app()

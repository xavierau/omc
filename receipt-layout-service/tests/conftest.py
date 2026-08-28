"""Shared test fixtures and helpers for route tests."""

import io

import numpy as np
from PIL import Image

from app.models.layout import (
    LayoutTemplate,
    StatValue,
    VerificationResult,
)


def make_app(api_key: str = ""):
    """Create test app with optional API key."""
    import os
    os.environ["LAYOUT_API_KEY"] = api_key
    os.environ["LAYOUT_MODEL_PATH"] = "nonexistent.onnx"
    from importlib import reload
    import app.config
    reload(app.config)
    import app.main
    reload(app.main)
    return app.main.create_app()


def jpeg_bytes() -> bytes:
    """Create a minimal 100x300 white JPEG image."""
    img = Image.fromarray(np.full((300, 100, 3), 255, dtype=np.uint8))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def sample_template_dict() -> dict:
    return LayoutTemplate(
        aspect_ratio=StatValue(mean=0.33, std=0.02),
        regions=[],
        region_count=StatValue(mean=3.0, std=0.5),
        spatial_graph=[],
        created_from=3,
    ).model_dump()


def sample_verification() -> VerificationResult:
    return VerificationResult(
        score=0.75,
        passed=True,
        aspect_ratio_score=0.9,
        region_match_score=0.7,
        spatial_score=0.6,
        missing_regions=[],
        extra_regions=[],
        detected_regions=[],
    )


def mock_sanitize_result():
    """Return a fake SanitizeResult-like object."""
    return type("R", (), {
        "image": np.full((300, 100, 3), 255, dtype=np.uint8),
        "method": "original",
        "corners_detected": False,
    })()

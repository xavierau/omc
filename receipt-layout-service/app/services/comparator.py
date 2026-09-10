"""Compare detected layout against a template."""

from __future__ import annotations

from app.models.layout import (
    DetectedRegion,
    LayoutTemplate,
    VerificationResult,
)
from app.services.scoring import (
    aspect_ratio_score,
    region_match_score,
    spatial_score,
)

_W_ASPECT = 0.15
_W_REGION = 0.50
_W_SPATIAL = 0.35


def compare_layout(
    detected: list[DetectedRegion],
    receipt_aspect_ratio: float,
    template: LayoutTemplate,
    threshold: float = 0.65,
) -> VerificationResult:
    """Compare detected layout against template."""
    ar_score = aspect_ratio_score(
        receipt_aspect_ratio, template.aspect_ratio,
    )
    rm_score, missing, extra = region_match_score(
        detected, template,
    )
    sp_score = spatial_score(detected, template)

    final = (
        _W_ASPECT * ar_score
        + _W_REGION * rm_score
        + _W_SPATIAL * sp_score
    )

    return VerificationResult(
        score=final,
        passed=final >= threshold,
        aspect_ratio_score=ar_score,
        region_match_score=rm_score,
        spatial_score=sp_score,
        missing_regions=missing,
        extra_regions=extra,
        detected_regions=detected,
    )

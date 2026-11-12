"""Tests for layout Pydantic models."""

from __future__ import annotations

from app.models.layout import (
    DetectedRegion,
    LayoutTemplate,
    NormBBox,
    StatValue,
    TemplateRegion,
    VerificationResult,
)


def _make_template() -> LayoutTemplate:
    return LayoutTemplate(
        aspect_ratio=StatValue(mean=0.4, std=0.02),
        regions=[
            TemplateRegion(
                label="Title",
                bbox_norm=NormBBox(x=0.1, y=0.0, w=0.8, h=0.05),
                bbox_std=NormBBox(x=0.01, y=0.0, w=0.02, h=0.01),
                confidence_mean=0.9,
                occurrence_rate=1.0,
            ),
        ],
        region_count=StatValue(mean=3.0, std=0.5),
        spatial_graph=[],
        created_from=5,
    )


def test_layout_template_round_trip() -> None:
    template = _make_template()
    json_str = template.model_dump_json()
    restored = LayoutTemplate.model_validate_json(json_str)
    assert restored == template


def test_normbbox_accepts_full_range() -> None:
    bbox = NormBBox(x=0.0, y=0.0, w=1.0, h=1.0)
    assert bbox.w == 1.0


def test_normbbox_accepts_edge_values() -> None:
    bbox = NormBBox(x=-0.01, y=0.0, w=1.05, h=0.5)
    assert bbox.x == -0.01  # flexible, no strict validation


def test_verification_result_has_all_fields() -> None:
    result = VerificationResult(
        score=0.85,
        passed=True,
        aspect_ratio_score=0.95,
        region_match_score=0.80,
        spatial_score=0.90,
        missing_regions=["Footer"],
        extra_regions=[],
        detected_regions=[
            DetectedRegion(
                label="Title",
                bbox=NormBBox(x=0.1, y=0.0, w=0.8, h=0.05),
                confidence=0.92,
            ),
        ],
    )
    assert result.passed is True
    assert len(result.detected_regions) == 1


def test_detected_region_serialization() -> None:
    region = DetectedRegion(
        label="Table",
        bbox=NormBBox(x=0.1, y=0.3, w=0.8, h=0.4),
        confidence=0.88,
    )
    data = region.model_dump()
    assert data["label"] == "Table"
    assert data["bbox"]["x"] == 0.1

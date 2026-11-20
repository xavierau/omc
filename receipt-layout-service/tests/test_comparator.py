"""Tests for layout comparator."""

from __future__ import annotations

import pytest

from app.models.layout import (
    DetectedRegion,
    LayoutTemplate,
    NormBBox,
    SpatialRelation,
    StatValue,
    TemplateRegion,
)
from app.services.comparator import compare_layout


def _region(
    label: str,
    x: float = 0.1,
    y: float = 0.1,
    w: float = 0.8,
    h: float = 0.1,
    conf: float = 0.9,
) -> DetectedRegion:
    return DetectedRegion(
        label=label,
        bbox=NormBBox(x=x, y=y, w=w, h=h),
        confidence=conf,
    )


def _template_region(
    label: str,
    x: float = 0.1,
    y: float = 0.1,
    w: float = 0.8,
    h: float = 0.1,
    occ: float = 1.0,
) -> TemplateRegion:
    return TemplateRegion(
        label=label,
        bbox_norm=NormBBox(x=x, y=y, w=w, h=h),
        bbox_std=NormBBox(x=0.01, y=0.01, w=0.02, h=0.01),
        confidence_mean=0.9,
        occurrence_rate=occ,
    )


def _make_template(
    regions: list[TemplateRegion] | None = None,
    spatial: list[SpatialRelation] | None = None,
) -> LayoutTemplate:
    return LayoutTemplate(
        aspect_ratio=StatValue(mean=0.4, std=0.02),
        regions=regions or [
            _template_region("Title", y=0.0),
            _template_region("Table", y=0.3, h=0.4),
        ],
        region_count=StatValue(mean=2.0, std=0.0),
        spatial_graph=spatial or [],
        created_from=5,
    )


def test_identical_layout_high_score() -> None:
    detected = [_region("Title", y=0.0), _region("Table", y=0.3, h=0.4)]
    result = compare_layout(detected, 0.4, _make_template())
    assert result.score > 0.85
    assert result.passed is True


def test_completely_different_layout_low_score() -> None:
    detected = [
        _region("Picture", x=0.5, y=0.5, w=0.1, h=0.1),
        _region("Footnote", x=0.0, y=0.9, w=0.3, h=0.05),
    ]
    result = compare_layout(detected, 0.4, _make_template())
    assert result.score <= 0.5


def test_missing_expected_region_lowers_score() -> None:
    detected = [_region("Title", y=0.0)]  # missing Table
    result = compare_layout(detected, 0.4, _make_template())
    assert "Table" in result.missing_regions
    assert result.region_match_score < 0.8


def test_extra_unexpected_region_small_penalty() -> None:
    detected = [
        _region("Title", y=0.0),
        _region("Table", y=0.3, h=0.4),
        _region("Formula", y=0.8, h=0.05),
    ]
    result = compare_layout(detected, 0.4, _make_template())
    assert "Formula" in result.extra_regions
    full = compare_layout(
        detected[:2], 0.4, _make_template()
    )
    assert result.region_match_score <= full.region_match_score


def test_spatial_violation_lowers_score() -> None:
    spatial = [
        SpatialRelation(
            from_label="Title",
            to_label="Table",
            relation="above",
            gap_norm=0.2,
        ),
    ]
    template = _make_template(spatial=spatial)
    # Correct: Title above Table
    correct = [_region("Title", y=0.0), _region("Table", y=0.3, h=0.4)]
    good = compare_layout(correct, 0.4, template)
    # Violated: Table above Title (swapped y)
    violated = [_region("Title", y=0.8), _region("Table", y=0.0, h=0.4)]
    bad = compare_layout(violated, 0.4, template)
    assert bad.spatial_score < good.spatial_score


def test_aspect_ratio_mismatch_lowers_score() -> None:
    detected = [_region("Title", y=0.0), _region("Table", y=0.3, h=0.4)]
    good = compare_layout(detected, 0.4, _make_template())
    bad = compare_layout(detected, 1.5, _make_template())
    assert bad.aspect_ratio_score < good.aspect_ratio_score


def test_score_below_threshold_fails() -> None:
    detected = [
        _region("Picture", x=0.5, y=0.5, w=0.1, h=0.1),
    ]
    result = compare_layout(detected, 1.5, _make_template(), threshold=0.65)
    assert result.passed is False

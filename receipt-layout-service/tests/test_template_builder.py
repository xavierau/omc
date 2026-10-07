"""Tests for template builder."""

from __future__ import annotations

import pytest

from app.models.layout import DetectedRegion, NormBBox
from app.services.template_builder import build_template


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


def test_identical_detections_give_zero_std() -> None:
    regions = [_region("Title", y=0.0), _region("Table", y=0.3)]
    detections = [regions, regions, regions]
    template = build_template(detections, [0.4, 0.4, 0.4])

    for tr in template.regions:
        assert tr.bbox_std.x == pytest.approx(0.0, abs=1e-9)
        assert tr.occurrence_rate == pytest.approx(1.0)


def test_missing_region_lowers_occurrence_rate() -> None:
    full = [_region("Title"), _region("Table")]
    partial = [_region("Title")]
    detections = [full, full, partial]
    template = build_template(detections, [0.4, 0.4, 0.4])

    table_region = next(
        (r for r in template.regions if r.label == "Table"), None
    )
    assert table_region is not None
    assert table_region.occurrence_rate == pytest.approx(2.0 / 3.0)


def test_spatial_graph_header_above_table() -> None:
    regions = [
        _region("Section-header", y=0.05, h=0.05),
        _region("Table", y=0.20, h=0.50),
    ]
    detections = [regions, regions, regions]
    template = build_template(detections, [0.4, 0.4, 0.4])

    above_rels = [
        r for r in template.spatial_graph if r.relation == "above"
    ]
    assert len(above_rels) >= 1
    rel = above_rels[0]
    assert rel.from_label == "Section-header"
    assert rel.to_label == "Table"


def test_empty_detections_give_empty_template() -> None:
    template = build_template([], [])
    assert template.regions == []
    assert template.created_from == 0


def test_low_occurrence_region_excluded() -> None:
    """Region appearing in <30% of samples is excluded."""
    full = [_region("Title"), _region("Table")]
    sparse = [_region("Title")]
    # Table in 1/5 = 0.2 < 0.3 threshold
    detections = [full, sparse, sparse, sparse, sparse]
    template = build_template(
        detections, [0.4, 0.4, 0.4, 0.4, 0.4]
    )

    labels = [r.label for r in template.regions]
    assert "Table" not in labels


def test_aspect_ratio_stats_computed() -> None:
    regions = [_region("Title")]
    detections = [regions, regions, regions]
    template = build_template(detections, [0.3, 0.4, 0.5])

    assert template.aspect_ratio.mean == pytest.approx(0.4)
    assert template.aspect_ratio.std > 0.0

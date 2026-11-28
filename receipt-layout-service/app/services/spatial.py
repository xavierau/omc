"""Spatial relation detection between layout regions."""

from __future__ import annotations

from collections import defaultdict

import numpy as np

from app.models.layout import (
    DetectedRegion,
    NormBBox,
    SpatialRelation,
    TemplateRegion,
)

_SPATIAL_CONSISTENCY = 0.7


def build_spatial_graph(
    detections: list[list[DetectedRegion]],
    regions: list[TemplateRegion],
    n: int,
) -> list[SpatialRelation]:
    """Build spatial relations between template regions."""
    if len(regions) < 2:
        return []
    relations: list[SpatialRelation] = []
    for i, a in enumerate(regions):
        for b in regions[i + 1:]:
            rel = _check_relation(detections, a, b)
            if rel is not None:
                relations.append(rel)
    return relations


def _check_relation(
    detections: list[list[DetectedRegion]],
    a: TemplateRegion,
    b: TemplateRegion,
) -> SpatialRelation | None:
    """Check if a consistent spatial relation exists."""
    counts: dict[str, list[float]] = defaultdict(list)
    for sample in detections:
        ra = _find_by_label(sample, a.label)
        rb = _find_by_label(sample, b.label)
        if ra is None or rb is None:
            continue
        rel, gap = classify_relation(ra.bbox, rb.bbox)
        if rel:
            counts[rel].append(gap)

    total = sum(len(v) for v in counts.values())
    if total == 0:
        return None

    best_rel = max(counts, key=lambda k: len(counts[k]))
    consistency = len(counts[best_rel]) / total
    if consistency < _SPATIAL_CONSISTENCY:
        return None

    gaps = counts[best_rel]
    return SpatialRelation(
        from_label=a.label,
        to_label=b.label,
        relation=best_rel,
        gap_norm=float(np.mean(gaps)),
    )


def _find_by_label(
    regions: list[DetectedRegion], label: str,
) -> DetectedRegion | None:
    """Find first region with given label."""
    for r in regions:
        if r.label == label:
            return r
    return None


def classify_relation(
    a: NormBBox, b: NormBBox,
) -> tuple[str | None, float]:
    """Determine spatial relation between two bboxes."""
    a_bottom = a.y + a.h
    b_bottom = b.y + b.h
    a_right = a.x + a.w
    b_right = b.x + b.w

    if a_bottom <= b.y:
        return "above", b.y - a_bottom
    if b_bottom <= a.y:
        return "below", a.y - b_bottom
    if a_right <= b.x:
        return "left_of", b.x - a_right
    if b_right <= a.x:
        return "right_of", a.x - b_right
    return None, 0.0

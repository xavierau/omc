"""Build a LayoutTemplate from multiple detection samples."""

from __future__ import annotations

from collections import defaultdict

import numpy as np

from app.models.layout import (
    DetectedRegion,
    LayoutTemplate,
    NormBBox,
    StatValue,
    TemplateRegion,
)
from app.services.spatial import build_spatial_graph

_MIN_OCCURRENCE = 0.3


def build_template(
    detections: list[list[DetectedRegion]],
    aspect_ratios: list[float],
) -> LayoutTemplate:
    """Merge N detection sets into a single template."""
    n = len(detections)
    if n == 0:
        return _empty_template()

    ar_stat = _compute_stat(aspect_ratios)
    counts = [float(len(d)) for d in detections]
    count_stat = _compute_stat(counts)
    regions = _build_regions(detections, n)
    spatial = build_spatial_graph(detections, regions, n)

    return LayoutTemplate(
        aspect_ratio=ar_stat,
        regions=regions,
        region_count=count_stat,
        spatial_graph=spatial,
        created_from=n,
    )


def _empty_template() -> LayoutTemplate:
    return LayoutTemplate(
        aspect_ratio=StatValue(mean=0.0, std=0.0),
        regions=[],
        region_count=StatValue(mean=0.0, std=0.0),
        spatial_graph=[],
        created_from=0,
    )


def _compute_stat(values: list[float]) -> StatValue:
    """Compute mean and population std of a list."""
    if not values:
        return StatValue(mean=0.0, std=0.0)
    arr = np.array(values, dtype=np.float64)
    return StatValue(mean=float(arr.mean()), std=float(arr.std()))


def _build_regions(
    detections: list[list[DetectedRegion]], n: int,
) -> list[TemplateRegion]:
    """Group detections by label, aggregate stats."""
    grouped = _group_by_label(detections)
    regions: list[TemplateRegion] = []
    for label, items in grouped.items():
        occ = len(items) / n
        if occ < _MIN_OCCURRENCE:
            continue
        regions.append(_aggregate_region(label, items, occ))
    return regions


def _group_by_label(
    detections: list[list[DetectedRegion]],
) -> dict[str, list[DetectedRegion]]:
    """Group all detections by label."""
    grouped: dict[str, list[DetectedRegion]] = defaultdict(list)
    for sample in detections:
        for region in sample:
            grouped[region.label].append(region)
    return dict(grouped)


def _aggregate_region(
    label: str, items: list[DetectedRegion], occ: float,
) -> TemplateRegion:
    """Compute mean/std bbox and confidence for a label."""
    xs = [r.bbox.x for r in items]
    ys = [r.bbox.y for r in items]
    ws = [r.bbox.w for r in items]
    hs = [r.bbox.h for r in items]
    confs = [r.confidence for r in items]

    return TemplateRegion(
        label=label,
        bbox_norm=NormBBox(
            x=_mean(xs), y=_mean(ys), w=_mean(ws), h=_mean(hs),
        ),
        bbox_std=NormBBox(
            x=_std(xs), y=_std(ys), w=_std(ws), h=_std(hs),
        ),
        confidence_mean=_mean(confs),
        occurrence_rate=occ,
    )


def _mean(vals: list[float]) -> float:
    return float(np.mean(vals))


def _std(vals: list[float]) -> float:
    return float(np.std(vals))

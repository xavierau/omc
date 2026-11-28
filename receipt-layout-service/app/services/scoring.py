"""Scoring helpers for layout comparison."""

from __future__ import annotations

import math

from app.models.layout import (
    DetectedRegion, LayoutTemplate, NormBBox, StatValue, TemplateRegion,
)
from app.utils.iou import compute_iou

_EPS = 1e-6
_MATCH_OCC_THRESHOLD = 0.5
_EXTRA_PENALTY = 0.05


def aspect_ratio_score(receipt_ar: float, template_ar: StatValue) -> float:
    """Score aspect ratio similarity."""
    deviation = abs(receipt_ar - template_ar.mean)
    max_dev = 3 * template_ar.std + _EPS
    return max(0.0, 1.0 - deviation / max_dev)


def region_match_score(
    detected: list[DetectedRegion], template: LayoutTemplate,
) -> tuple[float, list[str], list[str]]:
    """Score region matching against template."""
    required = [r for r in template.regions if r.occurrence_rate >= _MATCH_OCC_THRESHOLD]
    if not required:
        return 1.0, [], _find_extra_labels(detected, template)

    scores: list[float] = []
    missing: list[str] = []
    for tr in required:
        s, _ = _score_single_region(tr, detected)
        scores.append(s)
        if s == 0.0:
            missing.append(tr.label)

    extra = _find_extra_labels(detected, template)
    raw = _mean(scores) - _EXTRA_PENALTY * len(extra)
    return max(0.0, min(1.0, raw)), missing, extra


def _score_single_region(
    tr: TemplateRegion, detected: list[DetectedRegion],
) -> tuple[float, str | None]:
    """Score a single template region against detections."""
    best_score, best_label = 0.0, None
    for det in detected:
        if det.label != tr.label:
            continue
        score = compute_iou(det.bbox, tr.bbox_norm) * _gaussian_penalty(det.bbox, tr)
        if score > best_score:
            best_score, best_label = score, det.label
    return best_score, best_label


def _gaussian_penalty(bbox: NormBBox, tr: TemplateRegion) -> float:
    """Compute gaussian penalty based on center distance."""
    det_cx, det_cy = bbox.x + bbox.w / 2, bbox.y + bbox.h / 2
    tmpl_cx = tr.bbox_norm.x + tr.bbox_norm.w / 2
    tmpl_cy = tr.bbox_norm.y + tr.bbox_norm.h / 2
    dist = math.sqrt((det_cx - tmpl_cx) ** 2 + (det_cy - tmpl_cy) ** 2)
    z = dist / ((tr.bbox_std.x + tr.bbox_std.y) / 2 + _EPS)
    return math.exp(-0.5 * z * z)


def spatial_score(
    detected: list[DetectedRegion], template: LayoutTemplate,
) -> float:
    """Score spatial consistency."""
    if not template.spatial_graph:
        return 1.0
    scores = [s for rel in template.spatial_graph if (s := _score_relation(detected, rel)) is not None]
    return _mean(scores) if scores else 1.0


def _score_relation(
    detected: list[DetectedRegion], rel: object,
) -> float | None:
    """Score a single spatial relation."""
    a = _find_by_label(detected, rel.from_label)  # type: ignore[attr-defined]
    b = _find_by_label(detected, rel.to_label)  # type: ignore[attr-defined]
    if a is None or b is None:
        return None
    holds = _relation_holds(a.bbox, b.bbox, rel.relation)  # type: ignore[attr-defined]
    return 0.7 * (1.0 if holds else 0.0) + 0.3 * _gap_similarity(a.bbox, b.bbox, rel)


def _relation_holds(a: NormBBox, b: NormBBox, relation: str) -> bool:
    """Check if spatial relation holds between two bboxes."""
    if relation == "above":
        return (a.y + a.h) <= (b.y + _EPS)
    if relation == "below":
        return (b.y + b.h) <= (a.y + _EPS)
    if relation == "left_of":
        return (a.x + a.w) <= (b.x + _EPS)
    if relation == "right_of":
        return (b.x + b.w) <= (a.x + _EPS)
    return False


def _gap_similarity(a: NormBBox, b: NormBBox, rel: object) -> float:
    """Score gap similarity to template."""
    relation = rel.relation  # type: ignore[attr-defined]
    gap = abs(b.y - (a.y + a.h)) if relation in ("above", "below") else abs(b.x - (a.x + a.w))
    diff = abs(gap - rel.gap_norm)  # type: ignore[attr-defined]
    return max(0.0, 1.0 - min(1.0, diff / (3 * 0.05 + _EPS)))


def _find_extra_labels(
    detected: list[DetectedRegion], template: LayoutTemplate,
) -> list[str]:
    """Find detected labels not in template."""
    tmpl_labels = {r.label for r in template.regions}
    return [d.label for d in detected if d.label not in tmpl_labels]


def _find_by_label(
    regions: list[DetectedRegion], label: str,
) -> DetectedRegion | None:
    for r in regions:
        if r.label == label:
            return r
    return None


def _mean(vals: list[float]) -> float:
    return sum(vals) / len(vals) if vals else 0.0

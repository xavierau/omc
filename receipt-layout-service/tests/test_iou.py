"""Tests for IoU computation."""

from __future__ import annotations

import pytest

from app.models.layout import NormBBox
from app.utils.iou import compute_iou


def test_perfect_overlap_returns_one() -> None:
    box = NormBBox(x=0.1, y=0.1, w=0.5, h=0.5)
    assert compute_iou(box, box) == pytest.approx(1.0)


def test_no_overlap_returns_zero() -> None:
    a = NormBBox(x=0.0, y=0.0, w=0.2, h=0.2)
    b = NormBBox(x=0.5, y=0.5, w=0.2, h=0.2)
    assert compute_iou(a, b) == pytest.approx(0.0)


def test_partial_overlap_correct_value() -> None:
    a = NormBBox(x=0.0, y=0.0, w=0.4, h=0.4)
    b = NormBBox(x=0.2, y=0.2, w=0.4, h=0.4)
    # Intersection: 0.2*0.2 = 0.04, Union: 0.16+0.16-0.04 = 0.28
    assert compute_iou(a, b) == pytest.approx(0.04 / 0.28)


def test_same_position_different_size() -> None:
    a = NormBBox(x=0.1, y=0.1, w=0.2, h=0.2)
    b = NormBBox(x=0.1, y=0.1, w=0.4, h=0.4)
    # Intersection: 0.2*0.2 = 0.04, Union: 0.04+0.16-0.04 = 0.16
    assert compute_iou(a, b) == pytest.approx(0.04 / 0.16)

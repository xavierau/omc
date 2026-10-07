"""DocLayout-YOLO detector wrapping PyTorch inference."""

from __future__ import annotations

from typing import Optional

import numpy as np

from app.models.layout import DetectedRegion, NormBBox

DOCLAYNET_LABELS = [
    "title", "plain text", "abandon", "figure",
    "figure_caption", "table", "table_caption",
    "table_footnote", "isolate_formula", "formula_caption",
]

_CONF_THRESHOLD = 0.25
_INPUT_SIZE = 640


class LayoutDetector:
    """Wraps DocLayout-YOLO for region detection via PyTorch."""

    def __init__(self, model_path: str = "models/doclayout_yolo_docstructbench.pt"):
        """Load model. Sets model to None if unavailable."""
        self._model: Optional[object] = None
        try:
            from doclayout_yolo import YOLOv10
            self._model = YOLOv10(model_path)
        except Exception:
            self._model = None

    def is_loaded(self) -> bool:
        """Return True if model is loaded."""
        return self._model is not None

    def detect(self, image: np.ndarray) -> list[DetectedRegion]:
        """Run inference, return detected regions."""
        if not self.is_loaded():
            return []
        return _run_inference(self._model, image)


def _run_inference(model: object, image: np.ndarray) -> list[DetectedRegion]:
    """Run YOLOv10 predict and parse results."""
    results = model.predict(image, imgsz=_INPUT_SIZE, conf=_CONF_THRESHOLD, verbose=False)  # type: ignore
    if not results or len(results) == 0:
        return []
    return _parse_results(results[0], image.shape)


def _parse_results(result: object, orig_shape: tuple) -> list[DetectedRegion]:
    """Parse ultralytics-style result into DetectedRegion list."""
    boxes = result.boxes  # type: ignore
    if boxes is None or len(boxes) == 0:
        return []
    orig_h, orig_w = orig_shape[:2]
    regions: list[DetectedRegion] = []
    for i in range(len(boxes)):
        cls_id = int(boxes.cls[i].item())
        conf = float(boxes.conf[i].item())
        if cls_id >= len(DOCLAYNET_LABELS):
            continue
        xyxy = boxes.xyxy[i].cpu().numpy()
        regions.append(_xyxy_to_region(cls_id, conf, xyxy, orig_w, orig_h))
    return regions


def _xyxy_to_region(
    cls_id: int, conf: float,
    xyxy: np.ndarray, orig_w: int, orig_h: int,
) -> DetectedRegion:
    """Convert xyxy coords to normalized DetectedRegion."""
    x1, y1, x2, y2 = xyxy
    return DetectedRegion(
        label=DOCLAYNET_LABELS[cls_id],
        bbox=NormBBox(
            x=float(x1 / orig_w),
            y=float(y1 / orig_h),
            w=float((x2 - x1) / orig_w),
            h=float((y2 - y1) / orig_h),
        ),
        confidence=conf,
    )


class MockDetector:
    """Returns predefined regions for testing."""

    def __init__(self, regions: list[DetectedRegion]):
        self.regions = regions

    def detect(self, image: np.ndarray) -> list[DetectedRegion]:
        """Return predefined regions."""
        return self.regions

    def is_loaded(self) -> bool:
        """Always loaded."""
        return True

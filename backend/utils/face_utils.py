"""
face_utils.py
=============

Two-tier face analysis pipeline:

  Tier 1 (primary)  — InsightFace buffalo_l
      • SCRFD detector at 1280×1280 (much higher accuracy than 640)
      • Tiling for images wider/taller than 1280 px (group shots, hi-res)
      • ArcFace 512-dim embeddings for accurate person clustering
      • Age + gender built-in

  Tier 2 (fallback) — OpenCV SSD + dlib ResNet-34
      • Used when insightface / onnxruntime is not installed

  First run: InsightFace downloads buffalo_l (~200 MB) to
  ~/.insightface/models/buffalo_l/ automatically.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import cv2
import numpy as np

# ── Constants ─────────────────────────────────────────────────────────────────
# Tiling: run the detector on overlapping windows so small faces in large photos
# are seen at a reasonable resolution inside each tile.
TILE_SIZE    = 1280          # px — detector input for each tile
TILE_STRIDE  = 1024          # px — step between tiles (256 px overlap on each side)
MIN_FACE_PX  = 12            # minimum face box side (pixels) after merging
NMS_IOU_THR  = 0.45          # IoU threshold for duplicate suppression after tiling

MATCH_THRESHOLD      = 0.60  # dlib / DBSCAN person-match threshold
CONFIDENCE_THRESHOLD = 0.45  # SSD fallback confidence gate
AREA_RATIO_THRESHOLD = 0.12  # SSD fallback size filter


# ── Tier 1: InsightFace ───────────────────────────────────────────────────────
_face_app      = None
_insightface_ok = None   # None = not yet tried


def _get_face_app():
    global _face_app, _insightface_ok
    if _insightface_ok is not None:
        return _face_app
    try:
        from insightface.app import FaceAnalysis
        app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        # 1280 instead of 640 — the single biggest accuracy win for small faces
        app.prepare(ctx_id=-1, det_size=(TILE_SIZE, TILE_SIZE))
        _face_app = app
        _insightface_ok = True
        print("[face_utils] InsightFace buffalo_l 1280px loaded ✓")
    except Exception as exc:
        _insightface_ok = False
        _face_app = None
        print(f"[face_utils] InsightFace unavailable ({exc}); falling back to SSD+dlib")
    return _face_app


# ── EXIF rotation ─────────────────────────────────────────────────────────────
def _apply_exif_rotation(image: np.ndarray, file_path: str) -> np.ndarray:
    """Rotate image so faces are upright based on EXIF Orientation tag."""
    try:
        import exifread
        with open(file_path, "rb") as f:
            tags = exifread.process_file(f, details=False, stop_tag="Orientation")
        tag = tags.get("Image Orientation")
        if tag is None:
            return image
        val = tag.values[0] if hasattr(tag, "values") else int(str(tag))
        if val == 3:
            return cv2.rotate(image, cv2.ROTATE_180)
        if val == 6:
            return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
        if val == 8:
            return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    except Exception:
        pass
    return image


# ── IoU + NMS helpers ─────────────────────────────────────────────────────────
def _iou_xyxy(a: np.ndarray, b: np.ndarray) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter == 0:
        return 0.0
    ua = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - inter
    return inter / ua


def _nms(dets: list, iou_thr: float = NMS_IOU_THR) -> list:
    """Greedy NMS. dets = list of (score, bbox_xyxy, embedding, age, gender)."""
    dets = sorted(dets, key=lambda d: d[0], reverse=True)
    kept: list = []
    for d in dets:
        if all(_iou_xyxy(d[1], k[1]) < iou_thr for k in kept):
            kept.append(d)
    return kept


# ── Detection helpers ─────────────────────────────────────────────────────────
def _faces_from_tile(app, rgb_tile: np.ndarray, offset_x: int, offset_y: int) -> list:
    """Run app.get() on one tile; return raw det tuples with original-image coords."""
    faces = app.get(rgb_tile)
    dets = []
    for f in faces:
        bbox = f.bbox.copy().astype(float)
        bbox[0] += offset_x;  bbox[2] += offset_x
        bbox[1] += offset_y;  bbox[3] += offset_y
        dets.append((float(f.det_score), bbox, f.embedding, f.age, f.gender))
    return dets


def _collect_detections(app, rgb: np.ndarray) -> list:
    """
    For images larger than TILE_SIZE: slide a tiled window.
    For smaller images: single pass.
    """
    h, w = rgb.shape[:2]
    if max(h, w) <= TILE_SIZE:
        return _faces_from_tile(app, rgb, 0, 0)

    dets: list = []
    # Slide tiles — last tile always reaches the image edge
    ys = list(range(0, h - TILE_SIZE + 1, TILE_STRIDE)) + ([h - TILE_SIZE] if h > TILE_SIZE else [])
    xs = list(range(0, w - TILE_SIZE + 1, TILE_STRIDE)) + ([w - TILE_SIZE] if w > TILE_SIZE else [])
    ys = sorted(set(max(0, y) for y in ys))
    xs = sorted(set(max(0, x) for x in xs))

    for ty in ys:
        for tx in xs:
            tile = rgb[ty:ty + TILE_SIZE, tx:tx + TILE_SIZE]
            dets.extend(_faces_from_tile(app, tile, tx, ty))

    return dets


# ── Build output dict from merged detections ──────────────────────────────────
def _build_result(merged: list, img_h: int, img_w: int) -> dict:
    face_boxes: list[dict]        = []
    descriptors: list[list[float]] = []
    ages: list[Optional[int]]     = []
    genders: list[Optional[str]]  = []
    confidences: list[float]      = []

    for score, bbox, embedding, age, gender in merged:
        x1, y1, x2, y2 = (int(round(v)) for v in bbox)
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(img_w, x2), min(img_h, y2)
        bw, bh = x2 - x1, y2 - y1
        if bw < MIN_FACE_PX or bh < MIN_FACE_PX:
            continue

        face_boxes.append({
            "x": x1, "y": y1, "w": bw, "h": bh,
            "confidence": round(score, 4),
            "x_norm": round(x1 / img_w, 6),
            "y_norm": round(y1 / img_h, 6),
            "w_norm": round(bw / img_w, 6),
            "h_norm": round(bh / img_h, 6),
        })
        descriptors.append(embedding.tolist() if embedding is not None else [])
        confidences.append(round(score, 4))
        ages.append(int(round(float(age))) if age is not None else None)
        if gender is not None:
            genders.append("male" if float(gender) >= 0.5 else "female")
        else:
            genders.append(None)

    return {
        "facesDetected": len(face_boxes),
        "faceBoxes":     face_boxes,
        "descriptors":   descriptors,
        "ages":          ages,
        "genders":       genders,
        "confidences":   confidences,
    }


def _detect_insightface(image: np.ndarray) -> dict:
    app = _get_face_app()
    if app is None:
        return _detect_ssd_dlib(image)

    h, w = image.shape[:2]
    rgb  = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    raw    = _collect_detections(app, rgb)
    merged = _nms(raw)
    return _build_result(merged, h, w)


# ── Tier 2: SSD Caffe + dlib (fallback) ──────────────────────────────────────
_MODEL_DIR  = Path(__file__).resolve().parent.parent / "models"
_PROTOTXT   = str(_MODEL_DIR / "deploy.prototxt")
_CAFFEMODEL = str(_MODEL_DIR / "res10_300x300_ssd_iter_140000.caffemodel")

try:
    _ssd_net = cv2.dnn.readNetFromCaffe(_PROTOTXT, _CAFFEMODEL)
    _SSD_OK  = True
except Exception:
    _ssd_net = None
    _SSD_OK  = False

try:
    import face_recognition as _face_recognition_lib
    _DLIB_OK = True
except ImportError:
    _face_recognition_lib = None  # type: ignore[assignment]
    _DLIB_OK = False

try:
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision
    _MEDIAPIPE_OK = True
except ImportError:
    mp = None  # type: ignore[assignment]
    _MEDIAPIPE_OK = False

MEDIAPIPE_AVAILABLE = _MEDIAPIPE_OK


def _run_ssd(image: np.ndarray) -> list[tuple[int, int, int, int, float]]:
    h, w = image.shape[:2]
    blob = cv2.dnn.blobFromImage(
        cv2.resize(image, (300, 300)), 1.0, (300, 300), (104.0, 177.0, 123.0)
    )
    _ssd_net.setInput(blob)
    out   = _ssd_net.forward()
    boxes: list[tuple[int, int, int, int, float]] = []
    for i in range(out.shape[2]):
        conf = float(out[0, 0, i, 2])
        x1 = max(0, int(out[0, 0, i, 3] * w))
        y1 = max(0, int(out[0, 0, i, 4] * h))
        x2 = min(w, int(out[0, 0, i, 5] * w))
        y2 = min(h, int(out[0, 0, i, 6] * h))
        bw, bh = x2 - x1, y2 - y1
        if bw > 0 and bh > 0:
            boxes.append((x1, y1, bw, bh, conf))
    return boxes


def _apply_size_filter(boxes: list, ratio: float = AREA_RATIO_THRESHOLD) -> list:
    if not boxes:
        return boxes
    max_area = max(bw * bh for _, _, bw, bh, _ in boxes)
    return [b for b in boxes if (b[2] * b[3]) / max_area >= ratio]


def _compute_descriptor_dlib(rgb: np.ndarray, x: int, y: int, bw: int, bh: int) -> list[float]:
    if not _DLIB_OK:
        return []
    loc  = (y, x + bw, y + bh, x)
    encs = _face_recognition_lib.face_encodings(
        rgb, known_face_locations=[loc], num_jitters=3, model="large"
    )
    return encs[0].tolist() if encs else []


def _detect_ssd_dlib(image: np.ndarray) -> dict:
    if not _SSD_OK:
        return {"facesDetected": 0, "faceBoxes": [], "descriptors": [],
                "ages": [], "genders": [], "confidences": []}

    h, w = image.shape[:2]
    raw  = [b for b in _run_ssd(image) if b[4] >= CONFIDENCE_THRESHOLD]
    raw  = _apply_size_filter(raw)
    rgb  = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    face_boxes, descriptors, confidences = [], [], []
    for x, y, bw, bh, conf in raw:
        face_boxes.append({
            "x": x, "y": y, "w": bw, "h": bh,
            "confidence": round(conf, 4),
            "x_norm": round(x / w, 6), "y_norm": round(y / h, 6),
            "w_norm": round(bw / w, 6), "h_norm": round(bh / h, 6),
        })
        descriptors.append(_compute_descriptor_dlib(rgb, x, y, bw, bh))
        confidences.append(round(conf, 4))

    return {
        "facesDetected": len(face_boxes),
        "faceBoxes":     face_boxes,
        "descriptors":   descriptors,
        "ages":          [],
        "genders":       [],
        "confidences":   confidences,
    }


# ── Tier 3 (optional, comparison only): MediaPipe BlazeFace ───────────────────
# Not part of the automatic detect_faces() pipeline — used by detect_faces_multi()
# to give the frontend a second detector to compare against the primary result.
_mp_detector    = None
_mediapipe_ok   = None   # None = not yet tried
_MP_MODEL_PATH  = _MODEL_DIR / "mediapipe" / "blaze_face_short_range.tflite"
_MP_MODEL_URL   = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/latest/blaze_face_short_range.tflite"
)


def _get_mediapipe_detector():
    global _mp_detector, _mediapipe_ok
    if _mediapipe_ok is not None:
        return _mp_detector
    if not _MEDIAPIPE_OK:
        _mediapipe_ok = False
        return None
    try:
        _MP_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
        if not _MP_MODEL_PATH.exists():
            import requests
            resp = requests.get(_MP_MODEL_URL, timeout=30)
            resp.raise_for_status()
            _MP_MODEL_PATH.write_bytes(resp.content)
        # delegate=CPU is required here — the GPU/Metal delegate crashes the whole
        # process (fatal MediaPipe C++ abort, not a catchable Python exception) on
        # at least some macOS setups.
        base_options = mp_python.BaseOptions(
            model_asset_path=str(_MP_MODEL_PATH),
            delegate=mp_python.BaseOptions.Delegate.CPU,
        )
        options = mp_vision.FaceDetectorOptions(base_options=base_options)
        _mp_detector = mp_vision.FaceDetector.create_from_options(options)
        _mediapipe_ok = True
        print("[face_utils] MediaPipe BlazeFace loaded ✓")
    except Exception as exc:
        _mediapipe_ok = False
        _mp_detector = None
        print(f"[face_utils] MediaPipe unavailable ({exc})")
    return _mp_detector


def _detect_mediapipe(image: np.ndarray) -> dict:
    detector = _get_mediapipe_detector()
    if detector is None:
        return {"facesDetected": 0, "faceBoxes": [], "descriptors": [],
                "ages": [], "genders": [], "confidences": []}

    h, w = image.shape[:2]
    rgb  = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = detector.detect(mp_image)

    face_boxes, descriptors, confidences = [], [], []
    for det in result.detections:
        bbox = det.bounding_box
        x, y = max(0, bbox.origin_x), max(0, bbox.origin_y)
        bw = min(w - x, bbox.width)
        bh = min(h - y, bbox.height)
        if bw < MIN_FACE_PX or bh < MIN_FACE_PX:
            continue
        score = det.categories[0].score if det.categories else 1.0

        face_boxes.append({
            "x": x, "y": y, "w": bw, "h": bh,
            "confidence": round(score, 4),
            "x_norm": round(x / w, 6), "y_norm": round(y / h, 6),
            "w_norm": round(bw / w, 6), "h_norm": round(bh / h, 6),
        })
        descriptors.append(_compute_descriptor_dlib(rgb, x, y, bw, bh))
        confidences.append(round(score, 4))

    return {
        "facesDetected": len(face_boxes),
        "faceBoxes":     face_boxes,
        "descriptors":   descriptors,
        "ages":          [],
        "genders":       [],
        "confidences":   confidences,
    }


# ── Public API ────────────────────────────────────────────────────────────────
def detect_faces(file_path: str) -> dict:
    """
    Detect all faces and return boxes, descriptors, age, gender.

    Pipeline:
      1. Read image + fix EXIF rotation
      2. InsightFace tiled detection at 1280 px resolution
      3. NMS to merge duplicates from overlapping tiles
      4. Fall back to SSD+dlib if InsightFace is not installed

    Returns
    -------
    {
        "facesDetected": int,
        "faceBoxes":  [{x, y, w, h, confidence, x_norm, y_norm, w_norm, h_norm}, ...],
        "descriptors": [[float ...], ...],   # 512-dim (InsightFace) or 128-dim (dlib)
        "ages":        [int | None, ...],
        "genders":     ["male" | "female" | None, ...],
        "confidences": [float, ...],
    }
    """
    image = cv2.imread(file_path)
    if image is None:
        return {"facesDetected": 0, "faceBoxes": [], "descriptors": [],
                "ages": [], "genders": [], "confidences": []}

    image = _apply_exif_rotation(image, file_path)
    return _detect_insightface(image)


def detect_faces_multi(file_path: str) -> dict:
    """
    Like detect_faces(), but also runs the MediaPipe BlazeFace detector on the
    same (EXIF-rotated) image so the frontend can show both results and let the
    user pick whichever looks best for that photo. The primary result is exactly
    what detect_faces() would have returned (InsightFace, or SSD+dlib if
    InsightFace isn't installed); "mediapipe" is None if MediaPipe isn't
    installed or its model failed to load.

    Returns
    -------
    {
        "primary":   {"engine": "insightface" | "ssd_dlib" | None, **detect_faces() shape},
        "mediapipe": {"engine": "mediapipe", **detect_faces() shape} | None,
    }
    """
    empty = {"facesDetected": 0, "faceBoxes": [], "descriptors": [],
             "ages": [], "genders": [], "confidences": []}

    image = cv2.imread(file_path)
    if image is None:
        return {"primary": {"engine": None, **empty}, "mediapipe": None}

    image = _apply_exif_rotation(image, file_path)

    primary_result = _detect_insightface(image)
    primary_engine = "insightface" if _insightface_ok else "ssd_dlib"

    mp_detector = _get_mediapipe_detector()
    mediapipe_result = {"engine": "mediapipe", **_detect_mediapipe(image)} if mp_detector else None

    return {
        "primary":   {"engine": primary_engine, **primary_result},
        "mediapipe": mediapipe_result,
    }


def match_face(
    descriptor: list[float],
    known_descriptors: list[list[float]],
    threshold: float = MATCH_THRESHOLD,
) -> Optional[int]:
    if not descriptor or not known_descriptors:
        return None
    probe   = np.array(descriptor,        dtype=np.float64)
    gallery = np.array(known_descriptors, dtype=np.float64)
    dists   = np.linalg.norm(gallery - probe, axis=1)
    best    = int(np.argmin(dists))
    return best if dists[best] < threshold else None


def cluster_faces(descriptors: list[list[float]], threshold: float = MATCH_THRESHOLD) -> list[int]:
    from sklearn.cluster import DBSCAN
    valid  = [(i, d) for i, d in enumerate(descriptors) if d]
    result = [-1] * len(descriptors)
    if not valid:
        return result
    indices, vecs = zip(*valid)
    labels = DBSCAN(eps=threshold, min_samples=1, metric="euclidean").fit_predict(
        np.array(vecs, dtype=np.float64)
    )
    for i, label in zip(indices, labels):
        result[i] = int(label)
    return result

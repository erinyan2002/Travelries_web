#!/usr/bin/env bash
# Downloads face-api.js model weights (detection fallback chain + recognition)
# and the MediaPipe face detector (primary detector — see lib/mediapipeDetector.ts).
# Run `npm install` first so node_modules/@mediapipe/tasks-vision exists.
#
# Run from the project root:
#   bash _scripts/download-models.sh
#
# Total download: ~33 MB (face-api ~21 MB + MediaPipe model+wasm ~12 MB)

set -e

BASE="https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights"
DEST="./public/models"

echo "Downloading face-api.js model weights → $DEST"
echo ""

files=(
  # TinyFaceDetector  (used to confirm/align each MediaPipe-localized crop,
  # and as the last-resort fallback detector if MediaPipe fails to load)
  "tiny_face_detector_model-weights_manifest.json"
  "tiny_face_detector_model-shard1"

  # SSD MobileNetV1  (fallback detector if MediaPipe fails to load)
  "ssd_mobilenetv1_model-weights_manifest.json"
  "ssd_mobilenetv1_model-shard1"
  "ssd_mobilenetv1_model-shard2"

  # Face Landmarks 68-point  (required before computing descriptors)
  "face_landmark_68_model-weights_manifest.json"
  "face_landmark_68_model-shard1"

  # Face Recognition Net  (128-dim descriptor for person clustering)
  "face_recognition_model-weights_manifest.json"
  "face_recognition_model-shard1"
  "face_recognition_model-shard2"

  # Age & Gender Net  (unlocks age/gender estimation per face)
  "age_gender_model-weights_manifest.json"
  "age_gender_model-shard1"

  # Face Expression Net  (unlocks emotion detection: happy/sad/surprised/…)
  "face_expression_model-weights_manifest.json"
  "face_expression_model-shard1"
)

for f in "${files[@]}"; do
  printf "  %-62s" "$f"
  if [ -f "$DEST/$f" ]; then
    echo "already exists, skipping"
  else
    curl -fsSL "$BASE/$f" -o "$DEST/$f"
    echo "done"
  fi
done

echo ""
echo "Downloading MediaPipe face detector model → $DEST/mediapipe"
echo ""

mkdir -p "$DEST/mediapipe"
MP_MODEL="$DEST/mediapipe/blaze_face_short_range.tflite"
if [ -f "$MP_MODEL" ]; then
  echo "  blaze_face_short_range.tflite  already exists, skipping"
else
  curl -fsSL "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite" -o "$MP_MODEL"
  echo "  blaze_face_short_range.tflite  done"
fi

echo ""
echo "Copying MediaPipe WASM runtime → ./public/mediapipe-wasm"
echo ""

WASM_SRC="./node_modules/@mediapipe/tasks-vision/wasm"
WASM_DEST="./public/mediapipe-wasm"
if [ ! -d "$WASM_SRC" ]; then
  echo "  node_modules/@mediapipe/tasks-vision not found — run 'npm install' first" >&2
  exit 1
fi
mkdir -p "$WASM_DEST"
cp "$WASM_SRC/vision_wasm_internal.js" "$WASM_DEST/"
cp "$WASM_SRC/vision_wasm_internal.wasm" "$WASM_DEST/"
echo "  done"

echo ""
echo "All model files ready. Restart the dev server and the app will"
echo "automatically use MediaPipe for face detection (with face-api.js"
echo "for recognition/age/gender/expression), falling back to face-api's"
echo "own SSD MobileNetV1 or TinyFaceDetector if MediaPipe fails to load."

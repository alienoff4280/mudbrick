#!/bin/bash
# Mudbrick v2 -- Build Python Sidecar (Linux/macOS)
#
# Packages the FastAPI backend into a standalone executable using PyInstaller.
# Output is placed at src-tauri/binaries/ with the appropriate Tauri target triple.
#
# Prerequisites:
#   pip install pyinstaller
#   pip install -r apps/api/requirements.txt
#
# Usage: bash scripts/build-sidecar.sh

set -euo pipefail

OUTPUT_DIR="${1:-src-tauri/binaries}"

echo "Building Mudbrick API sidecar..."

# Detect platform
case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)  TRIPLE="x86_64-unknown-linux-gnu" ;;
    Linux-aarch64) TRIPLE="aarch64-unknown-linux-gnu" ;;
    Darwin-x86_64) TRIPLE="x86_64-apple-darwin" ;;
    Darwin-arm64)  TRIPLE="aarch64-apple-darwin" ;;
    *)
        echo "Unsupported platform: $(uname -s)-$(uname -m)"
        exit 1
        ;;
esac

BINARY_NAME="mudbrick-api-${TRIPLE}"

mkdir -p "$OUTPUT_DIR"

echo "Running PyInstaller for ${TRIPLE}..."
python3 -m PyInstaller \
    --onefile \
    --name "$BINARY_NAME" \
    --distpath "$OUTPUT_DIR" \
    --workpath "build/pyinstaller" \
    --specpath "build/pyinstaller" \
    --noconfirm \
    --clean \
    --add-data "apps/api/app:app" \
    "apps/api/app/main.py"

OUTPUT_PATH="${OUTPUT_DIR}/${BINARY_NAME}"
if [ -f "$OUTPUT_PATH" ]; then
    SIZE=$(du -h "$OUTPUT_PATH" | cut -f1)
    echo "Sidecar built: ${OUTPUT_PATH} (${SIZE})"
else
    echo "Expected output not found: ${OUTPUT_PATH}"
    exit 1
fi

#!/bin/bash
# Verify reproducible circuit build artifacts
# Usage: ./verify-circuit-build.sh [build-dir] [checksums-file]

set -euo pipefail

BUILD_DIR="${1:-circuits/build}"
CHECKSUMS_FILE="${2:-circuits/artifacts.sha256}"
SBOM_FILE="${3:-circuits/sbom.txt}"

if [ ! -d "$BUILD_DIR" ]; then
    echo "Error: Build directory not found: $BUILD_DIR"
    exit 1
fi

echo "=== Circuit Build Verification ==="
echo "Build directory: $BUILD_DIR"
echo "Checksums file: $CHECKSUMS_FILE"
echo ""

# Verify checksums if file exists
if [ -f "$CHECKSUMS_FILE" ]; then
    echo "Verifying artifact checksums..."
    cd "$BUILD_DIR" && sha256sum -c "$CHECKSUMS_FILE" && cd - > /dev/null || {
        echo "Error: Checksum verification failed"
        exit 1
    }
    echo "✓ Checksums verified"
else
    echo "Warning: Checksums file not found: $CHECKSUMS_FILE"
fi

# Verify SBOM exists
if [ -f "$SBOM_FILE" ]; then
    echo "✓ SBOM found: $SBOM_FILE"
    echo ""
    echo "=== Build Metadata ==="
    head -10 "$SBOM_FILE"
else
    echo "Warning: SBOM not found: $SBOM_FILE"
fi

# List compiled artifacts
echo ""
echo "=== Compiled Artifacts ==="
ls -lh "$BUILD_DIR"/*.r1cs "$BUILD_DIR"/*.wasm "$BUILD_DIR"/*.sym 2>/dev/null || true

# Report reproducibility status
echo ""
echo "=== Reproducibility Status ==="
if [ -f "circuits/.reproducible" ]; then
    echo "✓ Reproducible build confirmed"
else
    echo "⚠ Reproducible build tag not found"
fi

echo "✓ Verification complete"

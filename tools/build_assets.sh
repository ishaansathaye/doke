#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DOKE_PYTHON="${DOKE_PYTHON:-.venv/bin/python}"
"$DOKE_PYTHON" tools/download_atlas.py
"$DOKE_PYTHON" tools/prepare_atlas.py
"$DOKE_PYTHON" tools/make_lod.py
"$DOKE_PYTHON" tools/fix_normals.py
"$DOKE_PYTHON" tools/native_atlas.py
"$DOKE_PYTHON" tools/pack_fine.py
"$DOKE_PYTHON" tools/molecules.py
"$DOKE_PYTHON" tools/validate_assets.py

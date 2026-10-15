#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for asset in public/assets/brain.bin public/assets/brain-high.bin public/assets/atlas.json public/assets/native/manifest.json public/assets/fine/manifest.json public/assets/molecules/dopamine.json; do
  [ -f "$asset" ] || { echo "Missing $asset. Run bash tools/build_assets.sh first."; exit 1; }
done
cargo test -p doke-core --locked
cargo build -p doke-web --target wasm32-unknown-unknown --release --locked
DOKE_BINDGEN="${DOKE_BINDGEN:-tools/.bin/wasm-bindgen}"
if [ ! -x "$DOKE_BINDGEN" ]; then DOKE_BINDGEN=wasm-bindgen; fi
"$DOKE_BINDGEN" target/wasm32-unknown-unknown/release/doke_web.wasm --target web --out-dir public/pkg --out-name doke
python3 tools/write_content.py
python3 tools/check_content.py
python3 tools/notices.py
python3 - <<'PY'
from pathlib import Path
import gzip,json,hashlib
p=Path('public')
for f in [p/'pkg/doke_bg.wasm',p/'pkg/doke.js',p/'app.js',p/'display.js',p/'style.css',p/'content.json']:
 with (f.parent/(f.name+'.gz')).open('wb') as out:
  out.write(gzip.compress(f.read_bytes(),compresslevel=9,mtime=0))
manifest={str(f.relative_to(p)):hashlib.sha256(f.read_bytes()).hexdigest() for f in p.rglob('*') if f.is_file() and f.name!='release.json'}
(p/'release.json').write_text(json.dumps({'version':'0.3.0','files':manifest},indent=2))
PY
printf 'Built public/ for static hosting.\n'

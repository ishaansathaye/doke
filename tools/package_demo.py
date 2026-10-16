"""Produce a portable static Pages artifact, excluding oversized legacy meshes."""
from pathlib import Path
import json,shutil,hashlib
root=Path(__file__).resolve().parents[1];source=root/'public';target=root/'dist/doke'
if target.exists():shutil.rmtree(target)
for f in source.rglob('*'):
 if not f.is_file() or f.name in ['brain-high.bin','brain-high.bin.gz','release.json'] or f.suffix=='.gz':continue
 relative=f.relative_to(source);out=target/relative;out.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,out)
(target/'_headers').write_text('''/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
  X-Frame-Options: DENY
''')
files={str(f.relative_to(target)):hashlib.sha256(f.read_bytes()).hexdigest() for f in target.rglob('*') if f.is_file()}
(target/'release.json').write_text(json.dumps({'version':'0.4.0','distribution':'portable-static','files':files},indent=2))
sizes=[(f.stat().st_size,str(f.relative_to(target))) for f in target.rglob('*') if f.is_file()]
assert max(x[0] for x in sizes)<25*1024*1024,'Pages has a 25 MiB per-file limit'
assert len(sizes)<20000 and sum(x[0] for x in sizes)<1024**3
(target/'.nojekyll').touch()
report={'directory':str(target),'files':len(sizes)+1,'bytes':sum(x[0] for x in sizes),'largest':max(sizes),'oversizedLegacyAssetsExcluded':True}
(root/'test-results').mkdir(exist_ok=True);(root/'test-results/package-results.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))

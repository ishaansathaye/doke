"""Bundle dependency license notices for the distributed Rust/Wasm application."""
import json,subprocess
from pathlib import Path
meta=json.loads(subprocess.check_output(['cargo','metadata','--locked','--format-version','1','--filter-platform','wasm32-unknown-unknown']))
blocks=[]
for pkg in sorted(meta['packages'],key=lambda x:x['name']):
 if pkg['source'] is None:continue
 root=Path(pkg['manifest_path']).parent
 notices=[f for f in root.iterdir() if f.is_file() and (f.name.upper().startswith('LICENSE') or f.name.upper().startswith('COPYING') or f.name.upper().startswith('NOTICE'))]
 if pkg.get('license_file'):
  p=root/pkg['license_file']
  if p.is_file() and p not in notices:notices.append(p)
 block=f"\n{'='*72}\n{pkg['name']} {pkg['version']}\nLicense expression: {pkg.get('license')}\nRepository: {pkg.get('repository')}\n"
 for f in sorted(notices):block+=f'\n--- {f.name} ---\n'+f.read_text(errors='replace')+'\n'
 if not notices:
  extra=Path('tools/notices')/(pkg['name']+'.txt')
  assert extra.exists(),f'Missing license notice: {pkg["name"]}'
  block+='\n'+extra.read_text()+'\n'
 blocks.append(block)
p=Path('public/licenses');p.mkdir(exist_ok=True);(p/'rust-dependencies.txt').write_text('Rust dependency notices. Includes transitive packages in the locked browser dependency graph.\n'+''.join(blocks));print('Bundled notices for',len(blocks),'dependencies')

"""Fetch notices omitted from certain crate archives; retained in version control."""
from pathlib import Path
import urllib.request
p=Path('tools/notices');p.mkdir(exist_ok=True)
files={
 'codespan-reporting.txt':'https://raw.githubusercontent.com/brendanzab/codespan/v0.11.1/LICENSE',
 'hexf-parse.txt':'https://raw.githubusercontent.com/lifthrasiir/hexf/master/LICENSE',
 'naga.txt':'https://raw.githubusercontent.com/gfx-rs/wgpu/v24.0.0/LICENSE.MIT',
 'profiling.txt':'https://raw.githubusercontent.com/aclysma/profiling/master/LICENSE-MIT',
 'spirv.txt':'https://raw.githubusercontent.com/gfx-rs/rspirv/master/LICENSE'}
for name,url in files.items():
 try:
  text=urllib.request.urlopen(url).read().decode();(p/name).write_text('Source: '+url+'\n\n'+text);print(name,'OK')
 except Exception as e: print(name,e)

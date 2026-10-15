from pathlib import Path
import json,gzip,hashlib
p=Path('public/assets');out=p/'fine';out.mkdir(exist_ok=True);b=(p/'brain-high.bin').read_bytes();a=json.loads((p/'atlas.json').read_text());parts=[]
for n,start in enumerate(range(0,len(b),8*1024*1024)):
 raw=b[start:start+8*1024*1024];z=gzip.compress(raw,compresslevel=9,mtime=0);name=f'part-{n:03d}.brnz';(out/name).write_bytes(z);parts.append({'url':'assets/fine/'+name,'bytes':len(z),'decodedBytes':len(raw),'sha256':hashlib.sha256(z).hexdigest()})
(out/'manifest.json').write_text(json.dumps({'version':'allen-fine-1mm-v1','encoding':'gzip-chunks','triangles':a['highDetailTriangles'],'bytes':len(b),'compressedBytes':sum(x['bytes']for x in parts),'meshHash':hashlib.sha256(b).hexdigest(),'chunks':parts},indent=2))
print('Fine detail packed',len(parts),'parts')

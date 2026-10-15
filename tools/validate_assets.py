"""Verify mesh identity, orientation, label coverage and bounds independently of rendering."""
from pathlib import Path
import struct,json,hashlib,gzip
import numpy as np
p=Path('public/assets');a=json.loads((p/'atlas.json').read_text());report={}
labels=[i for r in a['regions'] for i in r['labels']]
assert len(labels)==len(set(labels))==132
assert len(a['excludedLabels'])==9
assert a['sourceAffine']==[[.5,0.,0.,-98.],[0.,.5,0.,-134.],[0.,0.,.5,-72.],[0.,0.,0.,1.]]
def chunked(tier):
 meta=json.loads((p/tier/'manifest.json').read_text());parts=[]
 for part in meta['chunks']:
  z=(Path('public')/part['url']).read_bytes();assert len(z)==part['bytes']<25*1024*1024
  assert hashlib.sha256(z).hexdigest()==part['sha256']
  decoded=gzip.decompress(z);assert len(decoded)==part['decodedBytes'];parts.append(decoded)
 b=b''.join(parts);assert len(b)==meta['bytes'] and hashlib.sha256(b).hexdigest()==meta['meshHash']
 return b
assert chunked('fine')==(p/'brain-high.bin').read_bytes()
for name in ['brain.bin','brain-high.bin','native']:
 b=chunked(name) if name=='native' else (p/name).read_bytes();tag,n,ni,stride=struct.unpack('<4sIII',b[:16]);assert tag==b'BRN1' and stride==32
 assert len(b)==16+n*32+ni*4
 v=np.frombuffer(b[16:16+n*32],'<f4').reshape(-1,8);f=np.frombuffer(b[16+n*32:],'<u4').reshape(-1,3)
 assert np.isfinite(v).all() and f.max()<n and np.abs(v[:,:3]).max()<2
 assert np.allclose(np.linalg.norm(v[:,3:6],axis=1),1,atol=.02)
 volumes={}
 for region in a['regions']:
  fs=f[v[f[:,0],6]==region['index']]
  if not len(fs):assert region['id']=='white-matter';continue
  assert np.all(v[fs,6]==region['index'])
  tri=v[fs,:3];vol=float(np.einsum('ij,ij->i',tri[:,0],np.cross(tri[:,1],tri[:,2])).sum()/6)
  assert vol>0,(name,region['id'],vol)
  volumes[region['id']]=vol
  assert region['leftCentroid'][0]<0 and region['rightCentroid'][0]>0
 h=hashlib.sha256(b).hexdigest()
 if name=='brain.bin':assert h==a['meshHash']
 report[name]={'sha256':h,'vertices':n,'triangles':ni//3,'positiveVolumeGroups':len(volumes),'bytes':len(b)}
for molecule in (p/'molecules').glob('*.json'):
 data=json.loads(molecule.read_text());atoms=data['atoms'];bonds=data['bonds']
 assert all(a['element'] in ['C','H','O','N'] and all(np.isfinite(a[c]) for c in ['x','y','z']) for a in atoms)
 assert all(0<=b[0]<len(atoms) and 0<=b[1]<len(atoms) and b[2] in [1,2,3] for b in bonds)
 report[molecule.name]={'cid':data['cid'],'atoms':len(atoms),'bonds':len(bonds)}
Path('test-results').mkdir(exist_ok=True);Path('test-results/asset-results.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))

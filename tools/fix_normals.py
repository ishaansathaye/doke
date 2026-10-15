"""Orient each closed teaching mesh outward and repair undefined vertex normals.

Idempotent: only negative signed-volume groups are flipped. Simplification can
leave a few vertices with canceling incident normals; use the largest incident
face normal at those vertices. Geometry and atlas labels remain unchanged.
"""
import numpy as np,struct,hashlib,json,gzip
from pathlib import Path
p=Path('public/assets');meta=json.loads((p/'atlas.json').read_text());repairs={}
for name in ['brain.bin','brain-high.bin']:
 b=(p/name).read_bytes();_,n,ni,stride=struct.unpack('<4sIII',b[:16]);v=np.frombuffer(b[16:16+n*32],'<f4').reshape(-1,8).copy();f=np.frombuffer(b[16+n*32:],'<u4').reshape(-1,3).copy()
 for region in np.unique(v[:,6]):
  mask=v[f[:,0],6]==region;tri=v[f[mask],:3];volume=np.einsum('ij,ij->i',tri[:,0],np.cross(tri[:,1],tri[:,2])).sum()/6
  if volume<0:
   v[v[:,6]==region,3:6]*=-1;ff=f[mask].copy();ff[:,[1,2]]=ff[:,[2,1]];f[mask]=ff
 bad=np.where(np.linalg.norm(v[:,3:6],axis=1)<.01)[0];repairs[name]=len(bad)
 for index in bad:
  faces=f[np.any(f==index,axis=1)];tri=v[faces,:3];normal=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);length=np.linalg.norm(normal,axis=1);j=length.argmax();assert length[j]>0;v[index,3:6]=normal[j]/length[j]
 v[:,3:6]/=np.linalg.norm(v[:,3:6],axis=1)[:,None]
 out=b[:16]+v.tobytes()+f.tobytes();(p/name).write_bytes(out);(p/(name+'.gz')).write_bytes(gzip.compress(out,compresslevel=9,mtime=0))
 meta['meshHash' if name=='brain.bin' else 'highDetailMeshHash']=hashlib.sha256(out).hexdigest()
meta['normalCorrection']='Outward winding verified by per-group signed volume; undefined vertex normals use the largest incident face normal.'
(p/'atlas.json').write_text(json.dumps(meta,indent=2));print('Undefined normals repaired:',repairs)

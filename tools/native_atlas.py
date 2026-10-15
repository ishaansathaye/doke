"""Build a native 0.5 mm detail tier, distributed as portable gzip chunks.

Uses the same explicit atlas-label groups as the overview. No subdivision or
invented detail: the source annotation is sampled at its original resolution.
"""
from pathlib import Path
import ast,json,hashlib,struct,gzip
import numpy as np,nibabel as nib,trimesh
from scipy.ndimage import gaussian_filter
from skimage.measure import marching_cubes
root=Path(__file__).resolve().parents[1];p=root/'public/assets';out=p/'native';out.mkdir(exist_ok=True)
tree=ast.parse((root/'tools/prepare_atlas.py').read_text());groups=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='groups' for t in n.targets))
a=json.loads((p/'atlas.json').read_text());img=nib.load(root/'data/raw/annotation_full.nii.gz');data=np.asarray(img.dataobj,dtype=np.int32)
vertices=[];indices=[];offset=0;records=[]
for r in a['regions']:
 if r['kind']==2:continue
 mask=np.isin(data,r['labels']);where=np.array(np.where(mask));lo=np.maximum(where.min(axis=1)-4,0);hi=np.minimum(where.max(axis=1)+5,mask.shape);sl=tuple(slice(x,y)for x,y in zip(lo,hi));field=gaussian_filter(mask[sl].astype(np.float32),.7)
 v,f,_,_=marching_cubes(field,.5,allow_degenerate=False);ras=(v+lo)*.5+img.affine[:3,3];xyz=np.column_stack((ras[:,0],ras[:,2]-15,-ras[:,1]-20))/100
 m=trimesh.Trimesh(xyz,f,process=False);trimesh.smoothing.filter_taubin(m,lamb=.5,nu=.53,iterations=3)
 original=len(m.faces);budget=600000 if r['id']=='cerebellum' else 260000
 if original>budget:m=m.simplify_quadric_decimation(face_count=budget)
 if m.volume<0:m.invert()
 normal=m.vertex_normals.copy()
 for bad in np.where(np.linalg.norm(normal,axis=1)<.01)[0]:
  face=m.faces[np.any(m.faces==bad,axis=1)];tri=m.vertices[face];ns=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);lens=np.linalg.norm(ns,axis=1);j=lens.argmax();normal[bad]=ns[j]/lens[j]
 normal/=np.linalg.norm(normal,axis=1)[:,None]
 vv=np.column_stack((m.vertices,normal,np.full(len(m.vertices),r['index']),np.full(len(m.vertices),r['kind']))).astype('<f4');vertices.append(vv);indices.append((m.faces+offset).astype('<u4').ravel());offset+=len(vv)
 records.append({'id':r['id'],'nativeSurfaceTriangles':original,'triangles':len(m.faces),'volume':float(m.volume)});print(r['id'],original,'→',len(m.faces),flush=True)
v=np.concatenate(vertices);i=np.concatenate(indices);b=struct.pack('<4sIII',b'BRN1',len(v),len(i),32)+v.tobytes()+i.tobytes();chunks=[]
for n,start in enumerate(range(0,len(b),8*1024*1024)):
 raw=b[start:start+8*1024*1024];z=gzip.compress(raw,compresslevel=9,mtime=0);name=f'part-{n:03d}.brnz';(out/name).write_bytes(z);chunks.append({'url':'assets/native/'+name,'bytes':len(z),'decodedBytes':len(raw),'sha256':hashlib.sha256(z).hexdigest()})
meta={'version':'doke-native-0.5-v1','sourceHash':a['sourceHash'],'sourceVoxelMm':.5,'processing':'native 0.5mm annotations, Gaussian sigma 0.7 voxels, three Taubin iterations; region budgets 260k faces, cerebellum 600k','encoding':'gzip-chunks','meshHash':hashlib.sha256(b).hexdigest(),'vertices':len(v),'triangles':len(i)//3,'bytes':len(b),'compressedBytes':sum(x['bytes']for x in chunks),'chunks':chunks,'regions':records}
(out/'manifest.json').write_text(json.dumps(meta,indent=2));print('NATIVE COMPLETE',len(v),len(i)//3,len(b),meta['compressedBytes'],flush=True)

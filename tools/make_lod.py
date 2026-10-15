from pathlib import Path
import json,struct,gzip,numpy as np,trimesh,hashlib
p=Path('public/assets'); meta=json.loads((p/'atlas.json').read_text());b=(p/'brain.bin').read_bytes();_,nv,ni,_=struct.unpack('<4sIII',b[:16]);vs=np.frombuffer(b[16:16+nv*32],'<f4').reshape(-1,8);ix=np.frombuffer(b[16+nv*32:],'<u4')
# Keep a high detail export independently of the initial browser pack.
(p/'brain-high.bin').write_bytes(b)
verts=[];inds=[];offset=0;start=0;ranges=[]
for r,ran in zip(meta['regions'],meta['ranges']):
 f=ix[ran['start']:ran['start']+ran['count']].reshape(-1,3);unique=np.unique(f);local=np.searchsorted(unique,f);m=trimesh.Trimesh(vs[unique,:3],local,process=False)
 for side,sign in [('leftCentroid',-1),('rightCentroid',1)]:
  half=m.vertices[m.vertices[:,0]*sign>0.01];r[side]=(half.mean(axis=0) if len(half) else m.centroid).tolist()
 # Cerebral white matter is metadata only; never sent as invisible geometry.
 if r['id']=='white-matter': r['overviewTriangles']=0; continue
 count=max(300,int(len(f)*0.18));m=m.simplify_quadric_decimation(face_count=count)
 v=np.column_stack((m.vertices,m.vertex_normals,np.full(len(m.vertices),r['index']),np.full(len(m.vertices),r['kind']))).astype('<f4')
 verts.append(v);inds.append((m.faces+offset).astype('<u4').ravel());r['overviewTriangles']=len(m.faces)
 ranges.append(dict(region=r['index'],start=start,count=len(m.faces)*3));offset+=len(v);start+=len(m.faces)*3
v=np.concatenate(verts);i=np.concatenate(inds);out=struct.pack('<4sIII',b'BRN1',len(v),len(i),32)+v.tobytes()+i.tobytes();(p/'brain.bin').write_bytes(out)
with gzip.open(p/'brain.bin.gz','wb',compresslevel=9)as f:f.write(out)
meta['highDetailTriangles']=meta['triangles'];meta['triangles']=len(i)//3;meta['vertices']=len(v);meta['ranges']=ranges;meta['meshHash']=hashlib.sha256(out).hexdigest();meta['lod']='18% quadric simplification per region; minimum 300 faces; white matter hidden mesh excluded';(p/'atlas.json').write_text(json.dumps(meta,indent=2));print(len(out),len(i)//3,(p/'brain.bin.gz').stat().st_size)

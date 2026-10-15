"""Convert the Allen 2020 volume into reproducible labeled browser meshes.

Run from project root with .venv/bin/python tools/prepare_atlas.py.
Atlas data: CC BY 4.0, Allen Institute. Runtime vertices use RAS-derived basis.
"""
from pathlib import Path
import hashlib,json,struct,gzip
import nibabel as nib
import numpy as np
from scipy.ndimage import gaussian_filter
from skimage.measure import marching_cubes
import trimesh

ROOT=Path(__file__).resolve().parents[1]
RAW=ROOT/'data/raw'; OUT=ROOT/'public/assets'
OUT.mkdir(exist_ok=True,parents=True)
img=nib.load(RAW/'annotation_full.nii.gz')
data=np.asarray(img.dataobj,dtype=np.int32)
ontology={s['id']:s for s in json.loads((RAW/'ontology.json').read_text())['msg']}
labels=set(np.unique(data).tolist())-{0}
# Stable teaching IDs. Groups are explicit unions of source anatomy, not functional parcels.
groups=[
('motor','Precentral gyrus','Movement',[12114,12126],0),
('prefrontal','Prefrontal gyri','Planning',[12115,12116,146034872,146034876,146034884,146034888],0),
('inferior-frontal','Inferior frontal gyrus','Language',[12118,12119,12127],0),
('orbitofrontal','Orbital gyri','Valuation',[12121,12122,12123,12124,12125],0),
('somatosensory','Postcentral gyrus','Touch',[12132,12138,13230],0),
('parietal','Superior parietal lobule','Spatial attention',[12133],0),
('inferior-parietal','Inferior parietal gyri','Integration',[12135,12136],0),
('precuneus','Precuneus','Internal experience',[12137],0),
('superior-temporal','Superior temporal gyrus','Sound',[12140,12145,12146,12147],0),
('middle-temporal','Middle temporal gyrus','Meaning',[12141],0),
('inferior-temporal','Inferior temporal gyrus','Object vision',[12142],0),
('fusiform','Fusiform gyrus','Visual recognition',[12143,12152,146034892],0),
('auditory','Heschl’s gyrus','Hearing',[12144],0),
('visual','Occipital cortex','Vision',[12149,12150,12151,12153,12154],0),
('insula','Insular cortex','Body awareness',[12177,12178,12179,10329,10330],0),
('anterior-cingulate','Anterior cingulate','Control & motivation',[12157,12160],0),
('posterior-cingulate','Posterior cingulate','Internal context',[12158,12159],0),
('parahippocampal','Parahippocampal gyri','Context',[12163,12164,12166],0),
('hippocampus','Hippocampus','Memory',[12171,12173,12174],1),
('amygdala','Amygdala','Salience',[10361],1),
('caudate','Caudate nucleus','Learning',[10335,10336,10337],1),
('putamen','Putamen','Action',[10338,146034754],1),
('accumbens','Nucleus accumbens','Reward',[10339],1),
('pallidum','Globus pallidus','Action control',[10343,10344],1),
('thalamus','Thalamus','Relay & regulation',[10390],1),
('hypothalamus','Hypothalamus','Homeostasis',[10467],1),
('basal-forebrain','Basal forebrain','Modulation',[10349,10350,10384],1),
('substantia-nigra','Substantia nigra','Dopamine & movement',[12251],1),
('midbrain','Midbrain','Orienting',[12181,12195,12247,12292,12305,12330,12354],1),
('cerebellum','Cerebellum','Coordination',[10658,12384,12390,10660],1),
('pons','Pons','Brainstem pathways',[12405,12416,12768],1),
('medulla','Medulla','Autonomic regulation',[12535,12538,12600,10668,12741],1),
('callosum','Corpus callosum','Between hemispheres',[10561],1),
('white-matter','Cerebral white matter','Long-range pathways',[10557],2),
('olfactory','Olfactory structures','Smell',[10307,10308,10311,13229],1),
('subthalamic','Subthalamic nucleus','Action regulation',[10466],1),
('other-deep','Other deep structures','Anatomical context',[10346,10452,10460,10463],1),
]
assigned=set(); records=[]
for index,(key,name,role,roots,kind) in enumerate(groups):
    selected=[v for v in labels if v not in assigned and any(v==r or f'/{r}/' in ontology[v]['structure_id_path'] for r in roots)]
    # White matter takes remaining forebrain white matter, excluding explicitly named callosum.
    assigned.update(selected)
    records.append(dict(index=index,id=key,name=name,role=role,kind=kind,labels=sorted(selected),atlasNames=[ontology[v]['name'] for v in sorted(selected)]))
print('Mapped',len(assigned),'labels to',len(records),'groups; excluded',[(v,ontology[v]['name']) for v in sorted(labels-assigned)],flush=True)
all_vertices=[]; all_indices=[]; ranges=[]; offset=0; start=0
# 1 mm sampling keeps gyri recognizable while controlling initial transfer.
sample=data[::2,::2,::2]
for r in records:
    if not r['labels']: raise ValueError(r['id'])
    mask=np.isin(sample,r['labels'])
    where=np.array(np.where(mask)); lo=np.maximum(where.min(axis=1)-3,0); hi=np.minimum(where.max(axis=1)+4,mask.shape)
    sl=tuple(slice(a,b) for a,b in zip(lo,hi))
    field=gaussian_filter(mask[sl].astype(np.float32),0.65)
    v,f,_,_=marching_cubes(field,0.5,allow_degenerate=False)
    # original affine is 0.5mm; subsampling gives 1mm index spacing
    ras=v+lo+img.affine[:3,3]
    # Model units are centimeters; center superior axis at 15mm and anterior at -20mm.
    xyz=np.column_stack((ras[:,0],ras[:,2]-15,-ras[:,1]-20))/100.0
    mesh=trimesh.Trimesh(xyz,f,process=False)
    trimesh.smoothing.filter_taubin(mesh,lamb=0.5,nu=0.53,iterations=5)
    normals=mesh.vertex_normals
    vertices=np.column_stack((mesh.vertices,normals,np.full(len(v),r['index']),np.full(len(v),r['kind']))).astype('<f4')
    all_vertices.append(vertices); all_indices.append((f+offset).astype('<u4').ravel())
    r['centroid']=np.mean(mesh.vertices,axis=0).tolist()
    r['bounds']=[mesh.vertices.min(axis=0).tolist(),mesh.vertices.max(axis=0).tolist()]
    r['vertices']=len(v); r['triangles']=len(f)
    ranges.append(dict(region=r['index'],start=start,count=len(f)*3))
    offset+=len(v);start+=len(f)*3
    print(r['id'],len(v),'vertices',len(f),'triangles',flush=True)
verts=np.concatenate(all_vertices); inds=np.concatenate(all_indices)
binary=struct.pack('<4sIII',b'BRN1',len(verts),len(inds),32)+verts.tobytes()+inds.tobytes()
(OUT/'brain.bin').write_bytes(binary)
with gzip.open(OUT/'brain.bin.gz','wb',compresslevel=9) as f: f.write(binary)
manifest=dict(version='allen-2020-v1-brain-1',source='https://download.alleninstitute.org/informatics-archive/allen_human_reference_atlas_3d_2020/version_1/',license='CC BY 4.0',attribution='Allen Human Reference Atlas – 3D, 2020. Ding et al. Allen Institute for Brain Science. RRID:SCR_017764. Modified: grouped labels, sampled to 1 mm, smoothed and meshed.',reference='ICBM 2009b Nonlinear Symmetric',sourceAffine=img.affine.tolist(),sourceShape=list(img.shape),sourceHash=hashlib.sha256((RAW/'annotation_full.nii.gz').read_bytes()).hexdigest(),meshHash=hashlib.sha256(binary).hexdigest(),renderTransform='x=RAS.x/100; y=(RAS.z-15)/100; z=(-RAS.y-20)/100; model units=100mm',vertices=len(verts),triangles=len(inds)//3,ranges=ranges,regions=records,excludedLabels=[dict(id=v,name=ontology[v]['name']) for v in sorted(labels-assigned)])
(OUT/'atlas.json').write_text(json.dumps(manifest,indent=2))
print('Output:',len(binary),'bytes;',len(inds)//3,'triangles',flush=True)

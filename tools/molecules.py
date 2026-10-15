"""Vendor PubChem 3D conformers. These structures are not molecular dynamics."""
import urllib.request,json,hashlib
from pathlib import Path
p=Path('public/assets/molecules');p.mkdir(exist_ok=True)
for key,cid in [('dopamine',681),('glutamate',33032),('gaba',119)]:
 url=f'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/record/JSON?record_type=3d'
 raw=urllib.request.urlopen(url).read();data=json.loads(raw)['PC_Compounds'][0];conf=data['coords'][0]['conformers'][0];ids=data['atoms']['aid'];el=data['atoms']['element'];symbols={1:'H',6:'C',7:'N',8:'O'}
 centers=[sum(conf[k])/len(ids)for k in ['x','y','z']];atoms=[dict(element=symbols.get(el[n],str(el[n])),x=conf['x'][n]-centers[0],y=conf['y'][n]-centers[1],z=conf['z'][n]-centers[2])for n in range(len(ids))];b=data['bonds'];bonds=[[ids.index(x),ids.index(y),order]for x,y,order in zip(b['aid1'],b['aid2'],b['order'])]
 result=dict(id=key,cid=cid,source=f'https://pubchem.ncbi.nlm.nih.gov/compound/{cid}',download=url,sha256=hashlib.sha256(raw).hexdigest(),note='One PubChem 3D conformer, recentered and rescaled. Atom sizes are illustrative; protonation is that of the source record, not a physiological pH calculation. Glutamate view uses L-glutamic acid.',atoms=atoms,bonds=bonds)
 (p/(key+'.json')).write_text(json.dumps(result,indent=2));print(key,len(atoms),'atoms',len(bonds),'bonds',flush=True)

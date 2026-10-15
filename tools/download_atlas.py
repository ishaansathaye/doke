"""Fetch source annotations and ontology from the Allen Institute. No MRI redistribution."""
from pathlib import Path
import urllib.request
p=Path('data/raw');p.mkdir(parents=True,exist_ok=True)
urls={
 'annotation_full.nii.gz':'https://download.alleninstitute.org/informatics-archive/allen_human_reference_atlas_3d_2020/version_1/annotation_full.nii.gz',
 'ontology.json':'https://api.brain-map.org/api/v2/data/query.json?criteria=model::Structure,rma::criteria,[graph_id$eq16],rma::options[num_rows$eqall]',
 'README.pdf':'https://download.alleninstitute.org/informatics-archive/allen_human_reference_atlas_3d_2020/version_1/README.pdf'}
for name,url in urls.items():
 if not (p/name).exists():
  print('Downloading',name);(p/name).write_bytes(urllib.request.urlopen(url).read())

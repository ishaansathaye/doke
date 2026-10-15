"""Reject unresolved references and incomplete teaching records before release."""
import json
from pathlib import Path
p=Path('public');c=json.loads((p/'content.json').read_text());a=json.loads((p/'assets/atlas.json').read_text())
r={x['id'] for x in a['regions']};sources=set(c['sources'])
assert len(r)==len(a['regions'])==37
assert len(c['activities'])==4 and len(c['chemicals'])==3
assert a['license']=='CC BY 4.0' and a['reference']=='ICBM 2009b Nonlinear Symmetric'
for key,s in c['sources'].items():
 assert all(s.get(k) for k in ['title','authors','year','url','method','species','finding','limit']),key
 assert s['url'].startswith('https://'),key
for key,entry in c['regions'].items():
 assert key in r and entry['summary'] and entry['sources'] and set(entry['sources'])<=sources,key
for region in a['regions']:
 assert region['id'] in c['regions'],region['id']
for activity in c['activities']:
 assert activity['duration']>0 and len(activity['chapters'])==4
 assert set(activity['sources'])<=sources
 for ch in activity['chapters']:
  assert ch['source'] in sources and ch['regions'] and set(ch['regions'])<=r
for chem in c['chemicals']:
 assert all(chem.get(k) for k in ['synthesis','release','receptors','clearance'])
 assert set(chem['sources'])<=sources and set(chem['regions'])<=r
print(f'Content OK: {len(r)} groups, {len(c["sources"])} sources, 4 activities, 3 chemicals.')

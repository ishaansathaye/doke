"""Vendor Google Fonts once so the deployed app makes no third-party requests."""
import pathlib,re,urllib.request
p=pathlib.Path('public/fonts');p.mkdir(exist_ok=True)
u='https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap'
s=urllib.request.urlopen(u).read().decode()
for i,url in enumerate(re.findall(r'url\((https:[^)]+)\)',s)):
 name=f'font-{i}.ttf';(p/name).write_bytes(urllib.request.urlopen(url).read());s=s.replace(url,'/fonts/'+name)
(p/'fonts.css').write_text(s)
for family,folder in [('DM-Sans','dmsans'),('IBM-Plex-Mono','ibmplexmono')]:
 (p/(family+'-OFL.txt')).write_bytes(urllib.request.urlopen(f'https://raw.githubusercontent.com/google/fonts/main/ofl/{folder}/OFL.txt').read())

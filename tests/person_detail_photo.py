"""Optional real-model regression. Supply a local path to the public pedestrian photo.
Example: python3 tests/person_detail_photo.py /tmp/security-bus-test.jpg
The photo is not bundled or fetched by the app; this is not a physical distance test.
"""
import sys,base64,json
from pathlib import Path
from playwright.sync_api import sync_playwright
from pin_helpers import unlock_app
photo='data:image/jpeg;base64,'+base64.b64encode(Path(sys.argv[1]).read_bytes()).decode()
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=b.new_page();page.goto('http://127.0.0.1:8001/camara.html#camera');unlock_app(page);page.evaluate('loadModel()');page.wait_for_function('!!state.model',timeout=90000)
 result=page.evaluate('''async photo=>{
 const img=new Image();img.src=photo;await img.decode();
 const source=document.createElement('canvas');source.width=1920;source.height=1080;
 const x=source.getContext('2d');x.fillStyle='#888';x.fillRect(0,0,1920,1080);x.drawImage(img,700,300,300,400);
 const out=[];
 for(const r of [{x:0,y:0,w:1920,h:1080},{x:600,y:220,w:600,h:600}]) {
   const c=document.createElement('canvas'),scale=512/Math.max(r.w,r.h);
   c.width=Math.round(r.w*scale);c.height=Math.round(r.h*scale);
   c.getContext('2d').drawImage(source,r.x,r.y,r.w,r.h,0,0,c.width,c.height);
   const prediction=await state.model.detect(c,{object:{minConfidence:.3}});
   const people=prediction.object.filter(p=>p.label==='person');
   out.push({accepted:people.filter(p=>p.score>=.45).length,maxConfidence:Math.max(0,...people.map(p=>p.score))});
 }
 return {general:out[0],detail:out[1]};
 }''',photo)
 assert result['detail']['accepted']>=1 and result['detail']['maxConfidence']>result['general']['maxConfidence'],result
 print('PASS actual CenterNet model on small pedestrians, general vs original-source crop:',json.dumps(result));b.close()

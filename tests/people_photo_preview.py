"""Optional genuine CenterNet + app overlay test using a local public pedestrian photo.
Usage: python3 tests/people_photo_preview.py /tmp/security-bus-test.jpg
This uses an image fixture, not an iPhone camera or a distance measurement.
"""
import base64,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from pin_helpers import unlock_app
photo='data:image/jpeg;base64,'+base64.b64encode(Path(sys.argv[1]).read_bytes()).decode()
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera'],viewport={'width':390,'height':844});page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001/camara.html#camera');unlock_app(page);page.uncheck('#person');page.click('#camera');page.wait_for_function('!!state.stream && video.videoWidth>0')
 page.evaluate('''async photo=>{const img=new Image();img.src=photo;await img.decode();const c=document.createElement('canvas');c.width=1280;c.height=720;const x=c.getContext('2d');function paint(){x.fillStyle='#555';x.fillRect(0,0,1280,720);x.drawImage(img,370,0,540,720)}paint();window.photoFixture=setInterval(paint,250);video.srcObject=c.captureStream(15);await video.play()}''',photo)
 page.check('#person');page.wait_for_function('!!state.model && state.persons.length>0 && !state.busy',timeout=90000)
 assert page.evaluate('!state.armed && !state.recording && !state.episode')
 assert page.evaluate('state.persons.every(p=>p.score>=.45)');assert 'PERSONA DETECTADA' in page.locator('#peopleStatus').inner_text()
 page.click('#navHome');page.wait_for_timeout(200);page.screenshot(path='/tmp/security-real-people-preview.png',full_page=True)
 scores=page.evaluate('state.persons.map(p=>Math.round(p.score*100))');assert not errors,errors
 print('PASS actual local CenterNet identifies photo pedestrians and draws app preview boxes before arming; no recording; confidence percentages:',scores)
 b.close()

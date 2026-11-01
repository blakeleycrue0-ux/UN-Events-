from pin_helpers import unlock_app, confirm_action
"""MP3 import/playback, PIN, continuous clips, capability and persistence checks."""
from pathlib import Path
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera'],accept_downloads=True)
 page=c.new_page();page.add_init_script("document.addEventListener('DOMContentLoaded',()=>document.querySelectorAll('details').forEach(d=>d.open=true))");errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001/camara.html#camera');unlock_app(page);page.wait_for_function('!!db')
 page.wait_for_function("!!soundBlobs.warning")
 assert page.locator('input[type=file]').count()==0
 page.click('#testSpeaker');page.click('#testSpeaker')
 page.wait_for_function("events.some(e=>e.type==='audio'&&e.message==='Reproduciendo MP3: warning')")
 page.click('#silence');assert page.evaluate('activeAudio===null')
 page.click('#unlock');unlock_app(page)
 page.reload();unlock_app(page);page.wait_for_function("!!soundBlobs.warning")
 print('PASS Bundled MP3 loading, native media play/stop and PIN lock/unlock')
 page.click('#camera');page.wait_for_function('!!state.stream')
 assert page.locator('#torch').is_disabled()
 page.evaluate("frame.captureStream=undefined;state.mask={x:0,y:0,w:.2,h:.2}")
 page.click('#record');page.wait_for_function("document.getElementById('error').textContent.includes('no permite grabar vídeo procesado')")
 assert not page.evaluate('state.recording')
 page.evaluate("delete frame.captureStream;state.mask=null")
 print('PASS unsupported torch disabled; native recorder blocked when privacy mask cannot be applied')
 page.select_option('#clip','10');page.select_option('#recordMode','continuous');page.click('#protect');confirm_action(page)
 page.wait_for_function('state.recording')
 page.wait_for_function("events.filter(e=>e.type==='grabación'&&e.message.startsWith('Iniciada')).length>=2",timeout=25000)
 page.click('#protect');confirm_action(page);page.wait_for_function('!state.recording');page.wait_for_timeout(1500);assert not page.evaluate('state.recording')
 print('PASS continuous clip rotation and disarm stops recording without restart')
 page.click('#camera');confirm_action(page);page.wait_for_function('!state.stream');assert not errors,errors
 b.close()

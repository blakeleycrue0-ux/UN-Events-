"""Exercise the actual primary protection control without injecting armed/zone/audio flags."""
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera'],viewport={'width':390,'height':844});page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001');page.wait_for_function('!!db')
 assert page.locator('#protect').is_visible()
 assert not page.locator('#brightness').is_visible()
 page.screenshot(path='/workspace/security-setup/home-v3.png',full_page=True)
 page.select_option('#alarmSource','motion');page.click('#protect');page.wait_for_function('state.armed && !protecting',timeout=30000)
 assert page.evaluate("!!state.zone && document.getElementById('autoAlarm').checked && audioReady")
 assert page.evaluate("document.getElementById('mode').value==='alarm'")
 # Send a controlled sequence through the real camera analysis, no detector-state overrides.
 page.evaluate("""async()=>{window.scene=document.createElement('canvas');scene.width=640;scene.height=480;const ctx=scene.getContext('2d');let n=0;window.movement=setInterval(()=>{ctx.fillStyle='#777';ctx.fillRect(0,0,640,480);ctx.fillStyle='white';ctx.fillRect((n++%2)*300,100,220,260)},400);video.srcObject=scene.captureStream(15);await video.play()}""")
 page.wait_for_function('state.warningPending',timeout=15000)
 page.wait_for_function('state.alarm && !!siren',timeout=30000)
 print('PASS primary button starts camera, unlocks sound, authorizes zone, arms detector and real motion triggers MP3 then siren')
 page.click('#silence');page.click('#protect');page.wait_for_function('!state.armed')
 assert not page.evaluate('state.alarm || state.warningPending')
 page.click('#navClips');assert page.locator('.evidence').get_attribute('open') is not None
 assert not errors,errors
 b.close()

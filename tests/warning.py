"""Bundled MP3: real WebAudio playback, disappearance cancellation and completion escalation."""
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera'],viewport={'width':390,'height':844});page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001');page.wait_for_function('!!soundBlobs.warning');assert page.locator('input[type=file]').count()==0
 page.click('#camera');page.wait_for_function('!!state.stream');page.select_option('#alarmSource','motion');page.evaluate("document.getElementById('fullZone').click()");page.evaluate("document.getElementById('autoAlarm').checked=true;document.getElementById('autoAlarm').dispatchEvent(new Event('change'))")
 # Controlled detector fixture, without real inference jitter. Playback is the actual bundled MP3.
 page.evaluate("""()=>{clearTimeout(loopTimer);state.motionFrames=3;state.lastMotionAt=Date.now();window.holdMotion=setInterval(()=>state.lastMotionAt=Date.now(),100);state.armed=true;state.lastAlarm=0;warnThenAlarm()}""")
 page.wait_for_function('state.warningPending && !!activeAudio');assert not page.evaluate('state.alarm || !!siren')
 page.evaluate('clearInterval(holdMotion);state.motionFrames=0;state.lastMotionAt=0;considerThreat()');assert not page.evaluate('state.warningPending || state.alarm || !!siren');print('PASS disappearance cancels warning and prevents siren')
 page.evaluate('state.motionFrames=3;state.lastMotionAt=Date.now();window.holdMotion=setInterval(()=>state.lastMotionAt=Date.now(),100);state.lastAlarm=0;warnThenAlarm()');page.wait_for_function('state.warningPending && !!activeAudio');page.wait_for_timeout(1000);assert not page.evaluate('state.alarm')
 page.wait_for_function('state.alarm && !!siren',timeout=30000);print('PASS actual 22-second MP3 ends before siren starts for persistent detection')
 page.click('#silence');assert not page.evaluate('state.alarm || state.warningPending || !!siren');page.screenshot(path='/workspace/security-setup/new-security.png',full_page=True)
 assert not errors,errors
 b.close()

"""Controlled model output on a still video verifies independent people events and crop remapping."""
from playwright.sync_api import sync_playwright
from pin_helpers import unlock_app,confirm_action
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera']);page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001/camara.html#camera');unlock_app(page);page.uncheck('#person');page.click('#camera');page.wait_for_function('!!state.stream && video.videoWidth>0')
 page.evaluate('''async()=>{const still=document.createElement('canvas');still.width=1280;still.height=720;const x=still.getContext('2d');x.fillStyle='#888';x.fillRect(0,0,1280,720);video.srcObject=still.captureStream(15);await video.play();window.fixtureCount=0;state.model={detect:async input=>{fixtureCount++;window.fixtureSize={w:input.width,h:input.height};return {object:fixtureCount===1?[]:[{label:'person',score:.9,boxRaw:[.2,.2,.1,.3]}]}}};}''')
 page.click('#protect');confirm_action(page);page.wait_for_function('state.armed && state.recording && state.aiDetail',timeout=15000)
 assert page.evaluate("!state.motionSignal.moving && state.episode.kind==='persona detectada'")
 assert page.evaluate('fixtureSize.w===512 && Math.abs(state.persons[0].x-.13)<.001 && Math.abs(state.persons[0].w-.065)<.001'), 'Crop boxes must map back to main camera'
 assert page.locator('#rec').is_visible();assert page.evaluate('!activeAudio && state.stream.getAudioTracks().length===0')
 page.click('#protect');confirm_action(page);page.wait_for_function('!state.armed && !state.recording && !state.recordFinalizing');assert not errors,errors
 print('PASS person-only recognition on still video records one silent event; 512 px detail boxes map to source coordinates')
 b.close()

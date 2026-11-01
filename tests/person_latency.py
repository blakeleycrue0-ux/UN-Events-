"""Held AI cannot record automatically; native video and manual recording remain usable."""
from playwright.sync_api import sync_playwright
from pin_helpers import unlock_app,confirm_action
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera']);page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001/camara.html#camera');unlock_app(page);page.uncheck('#person');page.click('#camera');page.wait_for_function('!!state.stream && video.videoWidth>0')
 page.evaluate('''()=>{window.activeInferences=0;window.peakInferences=0;window.inferenceCount=0;state.model={detect:()=>{activeInferences++;inferenceCount++;peakInferences=Math.max(peakInferences,activeInferences);return new Promise(resolve=>{window.releaseHeldAI=()=>{activeInferences--;resolve({object:[{label:'person',score:.99,boxRaw:[.1,.1,.2,.5]}]})}})}};}''')
 page.click('#protect');confirm_action(page);page.wait_for_function('!!window.releaseHeldAI && state.busy')
 before=page.evaluate('video.getVideoPlaybackQuality().totalVideoFrames');page.wait_for_timeout(800);assert page.evaluate('video.getVideoPlaybackQuality().totalVideoFrames')-before>=5;assert not page.evaluate('state.recording || state.episode')
 page.click('#record');page.wait_for_function('state.recording');page.wait_for_timeout(1200);page.click('#record');page.wait_for_function('!state.recording && !state.recordFinalizing');assert page.evaluate('inferenceCount===1 && peakInferences===1')
 page.uncheck('#person');page.evaluate('releaseHeldAI()');page.wait_for_function('!state.busy');assert page.evaluate('state.persons.length===0')
 page.evaluate('''()=>{state.model.detect=async()=>{activeInferences++;peakInferences=Math.max(peakInferences,activeInferences);await new Promise(r=>setTimeout(r,80));activeInferences--;return {object:[{label:'person',score:.9,boxRaw:[.2,.2,.15,.5]}]}};window.enabledAt=Date.now();}''')
 page.check('#person');page.wait_for_function("state.episode?.kind==='persona detectada' && state.recording",timeout=5000)
 elapsed=page.evaluate('Date.now()-enabledAt');assert elapsed<1200,elapsed;assert page.evaluate('peakInferences===1 && state.aiMS>=60 && state.recordStartMS>=0')
 page.click('#protect');confirm_action(page);page.wait_for_function('!state.armed && !state.recording && !state.recordFinalizing');assert not errors,errors
 print(f'PASS no automatic clip from a held AI result; live video and real manual clip continue; stale result discarded; person-only fixture classified within {elapsed} ms; single inference')
 b.close()

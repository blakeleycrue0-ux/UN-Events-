"""A held AI result must not stall motion, native video or recording. No hardware speed claim."""
from playwright.sync_api import sync_playwright
from pin_helpers import unlock_app,confirm_action
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera']);page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001/#camera');unlock_app(page);page.click('#camera');page.wait_for_function('!!state.stream && video.videoWidth>0')
 page.evaluate('''async()=>{const s=document.createElement('canvas');s.width=1280;s.height=720;const x=s.getContext('2d');window.movingFixture=setInterval(()=>{x.fillStyle='#777';x.fillRect(0,0,1280,720);x.fillStyle='#eee';x.fillRect(Math.random()*900,Math.random()*400,180,260)},90);video.srcObject=s.captureStream(15);await video.play();window.activeInferences=0;window.peakInferences=0;window.inferenceCount=0;state.model={detect:()=>{activeInferences++;inferenceCount++;peakInferences=Math.max(peakInferences,activeInferences);return new Promise(resolve=>{window.releaseHeldAI=()=>{activeInferences--;resolve({object:[{label:'person',score:.99,boxRaw:[.1,.1,.2,.5]}]})}})}};}''')
 page.click('#protect');confirm_action(page);page.wait_for_function('!!window.releaseHeldAI && state.busy',timeout=10000)
 before=page.evaluate('video.getVideoPlaybackQuality().totalVideoFrames');analysis_before=page.evaluate('state.analysisAt||0')
 page.wait_for_function('state.recording',timeout=10000);page.wait_for_timeout(700)
 assert page.evaluate('state.analysisAt')>analysis_before,'Motion must keep sampling while AI waits'
 assert page.evaluate('video.getVideoPlaybackQuality().totalVideoFrames')-before>=5
 assert page.evaluate("inferenceCount===1 && peakInferences===1 && state.episode.kind==='movimiento detectado'")
 page.uncheck('#person');page.evaluate('releaseHeldAI()');page.wait_for_function('!state.busy');assert page.evaluate('state.persons.length===0'), 'Disabled detector must discard its late result'
 page.evaluate('''()=>{state.model.detect=async()=>{activeInferences++;peakInferences=Math.max(peakInferences,activeInferences);await new Promise(r=>setTimeout(r,80));activeInferences--;return {object:[{label:'person',score:.9,boxRaw:[.2,.2,.15,.5]}]}};window.enabledAt=Date.now();}''')
 page.check('#person');page.wait_for_function("state.episode.kind==='persona detectada'",timeout=5000)
 elapsed=page.evaluate('Date.now()-enabledAt');assert elapsed<1200,elapsed
 assert page.evaluate('peakInferences===1 && state.aiMS>=60 && state.recordStartMS>=0')
 page.click('#protect');confirm_action(page);page.wait_for_function('!state.armed && !state.recording && !personRunning');assert not errors,errors
 print(f'PASS pending inference keeps motion/video/event clip running; one inference at a time; stale result discarded; synthetic 80 ms model classified within {elapsed} ms; real timing fields present')
 b.close()

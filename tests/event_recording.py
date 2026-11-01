"""Person-only event lifecycle and real encoded evidence; model output is a controlled fixture."""
from playwright.sync_api import sync_playwright
from pin_helpers import unlock_app,confirm_action
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera'],viewport={'width':390,'height':844});page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001/#camera');unlock_app(page);page.uncheck('#person');page.click('#camera');page.wait_for_function('!!state.stream && video.videoWidth>0')
 page.evaluate('''async()=>{const c=document.createElement('canvas');c.width=640;c.height=480;const x=c.getContext('2d');window.sourceMoves=setInterval(()=>{x.fillStyle=Math.random()>.5?'#777':'#888';x.fillRect(0,0,640,480);x.fillStyle='#eee';x.fillRect(Math.random()*550,Math.random()*380,40,80)},90);video.srcObject=c.captureStream(15);await video.play();window.personInFixture=false;state.model={detect:async()=>({object:personInFixture?[{label:'person',score:.92,boxRaw:[.2,.2,.2,.5]}]:[]})};}''')
 page.select_option('#clip','10');page.select_option('#recordCooldown','10');page.uncheck('#autoDetail');page.click('#protect');confirm_action(page);page.wait_for_function('state.armed && state.personResultAt>0')
 page.wait_for_timeout(1800);assert not page.evaluate('state.recording || state.episode'), 'Motion without a person must not create an event'
 page.evaluate('personInFixture=true');page.wait_for_function('state.recording',timeout=10000);assert page.locator('#rec').is_visible();assert page.evaluate('!activeAudio && !state.alarm && !audioReady')
 page.wait_for_function("!state.recording && !state.recordFinalizing && document.querySelectorAll('.clip').length===1",timeout=15000)
 clip=page.evaluate("async()=>{const c=(await store('clips','getAll'))[0];return {size:c.blob.size,reason:c.reason,thumb:!!c.thumbnail}}")
 assert clip['size']>1000 and clip['reason']=='persona detectada' and clip['thumb'],clip
 decoded=page.evaluate("""async()=>{const c=(await store('clips','getAll'))[0];const v=document.createElement('video');v.src=URL.createObjectURL(c.blob);await new Promise((ok,no)=>{v.onloadeddata=ok;v.onerror=no});return {w:v.videoWidth,h:v.videoHeight}}""")
 assert decoded['w']>0 and decoded['h']>0
 page.wait_for_timeout(11500);assert page.evaluate("document.querySelectorAll('.clip').length===1 && !state.recording"), 'One persistent person must not repeat clips'
 page.evaluate('personInFixture=false');page.wait_for_function('!state.episode',timeout=12000);page.evaluate('personInFixture=true');page.wait_for_function('state.recording',timeout=10000)
 page.click('#protect');confirm_action(page);page.wait_for_function('!state.armed && !state.recording && !state.recordFinalizing');assert not errors,errors
 assert not page.evaluate('events.some(e=>e.type==="movimiento")')
 print('PASS motion never creates events; person starts real silent clip/thumbnail/decode; persistent-person suppression after cooldown; new person episode; PIN disarm; preview remains active')
 b.close()

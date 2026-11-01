"""Real frame analysis -> event recorder -> IndexedDB; people use controlled model output here."""
from playwright.sync_api import sync_playwright
from pin_helpers import unlock_app,confirm_action
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera'],viewport={'width':390,'height':844});page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001/#camera');unlock_app(page);page.uncheck('#person');page.click('#camera');page.wait_for_function('!!state.stream && video.videoWidth>0')
 # Replace only the video input; analysis, event lifecycle, encoder and storage stay real.
 page.evaluate("""async()=>{window.scene=document.createElement('canvas');scene.width=640;scene.height=480;window.sceneKind='still';window.xpos=450;const x=scene.getContext('2d');window.fixture=setInterval(()=>{x.fillStyle=sceneKind==='light'?(Math.random()>.5?'#999':'#777'):'#777';x.fillRect(0,0,640,480);if(sceneKind==='motion'){x.fillStyle='#eee';x.fillRect(xpos+Math.random()*70,Math.random()*260,14,76)}},90);video.srcObject=scene.captureStream(15);await video.play()}""")
 page.wait_for_timeout(1600);assert not page.evaluate('state.previous || state.recording || state.episode'), 'Disarmed must not analyze'
 page.uncheck('#lowPower') if page.locator('#lowPower').is_visible() else page.locator('summary',has_text='Imagen y bajo consumo').click()
 if page.locator('#lowPower').is_checked():page.uncheck('#lowPower')
 page.select_option('#analysisInterval','250');page.select_option('#motionConfirm','0.5');page.select_option('#clip','10');page.select_option('#recordCooldown','10')
 # Draw a left-side ROI with actual pointer interaction. Right-side motion must be ignored.
 page.click('#zone');rect=page.locator('#overlay').bounding_box();page.mouse.move(rect['x']+rect['width']*.03,rect['y']+rect['height']*.05);page.mouse.down();page.mouse.move(rect['x']+rect['width']*.47,rect['y']+rect['height']*.95);page.mouse.up();page.click('#zoneApply');page.wait_for_function('state.zone && state.zone.w<.6')
 page.click('#protect');confirm_action(page);page.wait_for_function('state.armed')
 page.evaluate("sceneKind='light'");page.wait_for_timeout(2200);assert not page.evaluate('state.episode || state.recording'), 'Uniform lighting must not trigger'
 page.evaluate("sceneKind='motion'");page.wait_for_timeout(2400);assert not page.evaluate('state.episode || state.recording'), 'Outside ROI must not trigger'
 page.evaluate('xpos=30');page.wait_for_function('state.recording',timeout=12000)
 assert page.locator('#rec').is_visible();assert page.evaluate('!activeAudio && !state.alarm && !audioReady'), 'Silent mode must not unlock/play audio'
 # Person classification supplied as a model fixture, not a claim of real scene recognition accuracy.
 page.evaluate("state.model={detect:async()=>({object:[{label:'person',score:.92,boxRaw:[.12,.2,.15,.45]}]})}");page.uncheck('#autoDetail');page.check('#person');page.wait_for_function("state.episode?.kind==='persona detectada'",timeout=10000)
 page.wait_for_function("!state.recording && !state.recordFinalizing && document.querySelectorAll('.clip').length===1",timeout=15000)
 clip=page.evaluate("async()=>{const c=(await store('clips','getAll'))[0];return {size:c.blob.size,reason:c.reason,thumb:!!c.thumbnail}}")
 assert clip['size']>1000 and clip['reason']=='persona detectada' and clip['thumb'],clip
 # Metadata comes from actual encoded content.
 result=page.evaluate("""async()=>{const c=(await store('clips','getAll'))[0];const v=document.createElement('video');v.src=URL.createObjectURL(c.blob);await new Promise((ok,no)=>{v.onloadeddata=ok;v.onerror=no});return {w:v.videoWidth,h:v.videoHeight}}""")
 assert result['w']>0 and result['h']>0,result
 page.wait_for_timeout(11500);assert page.evaluate("document.querySelectorAll('.clip').length===1 && !state.recording"), 'Persistent episode must not repeat after cooldown'
 # End person presence and motion, then a fresh episode is allowed after quiet reset.
 page.evaluate("state.model.detect=async()=>({object:[]});sceneKind='still'");page.wait_for_function('!state.episode',timeout=12000)
 page.evaluate("sceneKind='motion'");page.wait_for_function('state.recording',timeout=12000)
 page.click('#protect');confirm_action(page);page.wait_for_function('!state.armed && !state.recording && !state.recordFinalizing')
 page.screenshot(path='/tmp/security-camera-events.png',full_page=True)
 saved=page.evaluate("JSON.parse(localStorage.getItem('security-settings'))");assert saved['motionConfirm']=='0.5' and saved['recordCooldown']=='10' and saved['zone']['w']<.6
 page.reload();unlock_app(page);assert not page.evaluate('state.armed');assert page.locator('#motionConfirm').input_value()=='0.5'
 assert not errors,errors
 print('PASS disarmed analysis idle; ROI excludes motion; uniform-light compensation; motion confirmation; real event clip/thumbnail/decode; person enrichment; silent audio; persistent-event suppression; fresh episode; settings reload')
 b.close()

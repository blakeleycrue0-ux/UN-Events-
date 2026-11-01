"""Capability and failure branches in Chromium; not Safari hardware certification."""
from playwright.sync_api import sync_playwright
from pin_helpers import empty_people_model,unlock_app,confirm_action
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context();c.add_init_script('window.MediaRecorder=undefined');page=c.new_page();page.goto('http://127.0.0.1:8001/camara.html#camera');unlock_app(page)
 assert page.locator('#record').is_disabled();assert page.locator('#recordMode').input_value()=='manual';assert page.locator('#recordMode option[value=event]').evaluate('o=>o.disabled');c.close()
 c=b.new_context(permissions=['camera']);c.add_init_script('HTMLCanvasElement.prototype.captureStream=undefined');page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('http://127.0.0.1:8001/camara.html#camera');unlock_app(page);empty_people_model(page);page.click('#camera');page.wait_for_function('!!state.stream && video.videoWidth>0')
 page.get_by_text('Audio y respuesta',exact=True).click();assert page.locator('#torch').is_disabled();assert 'no expone torch' in page.locator('#torchInfo').inner_text()
 page.click('#record');page.wait_for_function('state.recording');assert page.evaluate('recorder.stream.getAudioTracks().length===0');page.wait_for_timeout(1400);page.click('#record');page.wait_for_function("document.querySelectorAll('.clip').length===1")
 page.evaluate('state.mask={x:0,y:0,w:.2,h:.2}');page.click('#record');page.wait_for_function("document.getElementById('error').textContent.includes('máscara/zoom')")
 assert not page.evaluate('state.recording');assert page.locator('#rec').is_hidden();assert not errors,errors;c.close()
 c=b.new_context(permissions=['camera']);page=c.new_page();page.goto('http://127.0.0.1:8001/camara.html#camera');unlock_app(page)
 page.select_option('#surveillanceMode','alarm');page.get_by_text('Audio y respuesta',exact=True).click();page.check('#autoAlarm')
 page.evaluate("()=>{HTMLAudioElement.prototype.play=()=>Promise.reject(new DOMException('Audio blocked by fixture','NotAllowedError'))}")
 page.uncheck('#person');page.click('#protect');confirm_action(page);page.wait_for_function('state.armed && !protecting')
 assert not page.evaluate('audioReady');assert 'NotAllowedError' in page.locator('#error').inner_text();assert page.evaluate("document.getElementById('mode').value==='alarm'")
 page.click('#protect');confirm_action(page);page.wait_for_function('!state.armed')
 page.select_option('#surveillanceMode','silent');page.evaluate('()=>{state.model={detect:()=>new Promise(resolve=>{window.releaseInference=resolve})}}');page.check('#person');page.click('#protect');confirm_action(page);page.wait_for_function('!!window.releaseInference',timeout=15000)
 page.get_by_text('Imagen y bajo consumo',exact=True).click();page.click('#restart');confirm_action(page);page.wait_for_function('!!state.stream && !state.armed && video.readyState>=2')
 page.evaluate("()=>{state.model.detect=async()=>({object:[]});releaseInference({object:[{label:'person',score:.99,boxRaw:[0,0,1,1]}]})}");page.wait_for_timeout(300);assert page.evaluate('state.persons.length===0 && !state.recording && !state.busy'), 'Stale inference must not survive camera restart'
 page.evaluate('()=>{state.stream.getVideoTracks()[0].onended()}');page.wait_for_function('!state.stream');assert 'desconectado' in page.locator('#error').inner_text();c.close()
 c=b.new_context();page=c.new_page();page.goto('http://127.0.0.1:8001/camara.html#camera');unlock_app(page);empty_people_model(page);page.evaluate("()=>{navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Denied by fixture','NotAllowedError'))}");page.click('#camera');page.wait_for_function("document.getElementById('error').textContent.includes('NotAllowedError')");assert not page.evaluate('state.stream || state.recording');assert page.locator('#live').inner_text()=='SIN CÁMARA';c.close()
 print('PASS unavailable recorder disables automatic video; native-track fallback encodes without microphone; unsupported torch disabled; privacy mask refuses unsafe fallback; blocked audio does not prevent arming; camera denial reported; stale inference discarded after restart and track loss stops camera')
 b.close()

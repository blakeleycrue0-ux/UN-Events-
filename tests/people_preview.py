"""Person boxes work before arming; motion and old settings cannot create events."""
from playwright.sync_api import sync_playwright
from pin_helpers import unlock_app,confirm_action
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera'],viewport={'width':390,'height':844});c.add_init_script('localStorage.setItem("security-settings",JSON.stringify({motion:true,person:false,alarmSource:"motion",recordMode:"manual"}))');page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001/camara.html#camera');unlock_app(page)
 assert not page.evaluate('document.getElementById("motion").checked');assert page.locator('#person').is_checked();assert page.locator('#motion').is_hidden();assert page.locator('#sensitivity').is_hidden()
 page.evaluate('()=>{window.showPerson=true;state.model={detect:async()=>({object:showPerson?[{label:"person",score:.96,boxRaw:[.2,.2,.25,.5]}]:[]})}}')
 page.click('#camera');page.wait_for_function('state.persons.length>0 && state.personResultAt>0',timeout=10000)
 assert page.evaluate('!state.armed && !state.recording && !state.episode && !state.alarm');assert 'PERSONA DETECTADA' in page.locator('#peopleStatus').inner_text()
 assert page.evaluate('(()=>{const v=viewRect(),p=state.persons[0],d=ctx.getImageData(Math.round(v.x+p.x*v.w),Math.round(v.y+p.y*v.h),1,1).data;return d[1]>d[0] && d[1]>d[2] && d[3]>0})()'), 'Person output must draw green pixels on the overlay'
 page.click('#navHome');page.wait_for_timeout(400);assert page.locator('#homeLiveHost #peopleStatus').is_visible();assert page.locator('#homeLiveHost #overlay').is_visible();assert page.evaluate('!state.recording')
 page.screenshot(path='/tmp/security-people-boxes-preview.png',full_page=True)
 page.click('#homeProtect');confirm_action(page);page.wait_for_function('state.armed && state.recording',timeout=10000);assert page.evaluate("state.episode.kind==='persona detectada'")
 page.click('#homeProtect');confirm_action(page);page.wait_for_function('!state.armed && !state.recording && !state.recordFinalizing')
 # A raw movement event is ignored, even if a legacy caller tries it.
 page.evaluate('()=>{showPerson=false;state.persons=[];state.personResultAt=0;detected("movimiento")}');assert not page.evaluate('state.episode || state.recording')
 page.evaluate('()=>{state.model.detect=async()=>{throw Error("Injected person inference failure")}}');page.wait_for_function('!!state.peopleError',timeout=10000)
 assert page.locator('#retryPeople').is_visible();assert 'ERROR DE DETECCIÓN' in page.locator('#peopleStatus').inner_text();assert not page.evaluate('document.getElementById("motion").checked || state.recording')
 page.evaluate('()=>{state.model.detect=async()=>({object:[]})}');page.click('#retryPeople');page.wait_for_function('!state.peopleError && !state.busy && state.personResultAt>0');page.wait_for_function('document.getElementById("peopleStatus").textContent==="BUSCANDO PERSONAS"');assert 'BUSCANDO PERSONAS' in page.locator('#peopleStatus').inner_text()
 assert not errors,errors
 print('PASS migrated person-only settings; preview detection before arming; real green overlay in Home/camera; no preview recordings; person-triggered real clip; motion rejected; honest AI error and retry')
 b.close()

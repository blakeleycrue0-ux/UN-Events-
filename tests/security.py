"""Required entry PIN and authorization for state-changing surveillance actions."""
from playwright.sync_api import sync_playwright
from pin_helpers import enter_pin,unlock_app,confirm_action
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera'],viewport={'width':390,'height':844});page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001')
 page.wait_for_selector('#pinEntry:visible');assert not page.locator('#openCamera').is_visible()
 assert page.get_by_role('button',name='Cancelar',exact=True).is_disabled()
 page.screenshot(path='/workspace/security-setup/pin-entry-glass.png',full_page=True)
 enter_pin(page);page.wait_for_function("document.querySelector('.pin-card h2')?.textContent==='Repite tu PIN'");enter_pin(page,'654321')
 page.wait_for_function("document.querySelector('.pin-card h2')?.textContent==='Crea tu PIN'")
 assert page.evaluate("!localStorage.getItem('security-pin')")
 unlock_app(page);assert page.locator('#openCamera').is_visible()
 page.reload();page.wait_for_selector('#pinEntry:visible');enter_pin(page,'000000');page.wait_for_function("document.querySelector('.pin-card p')?.textContent.includes('incorrecto')");assert not page.evaluate('securityUnlocked');unlock_app(page)
 page.click('#openCamera');page.wait_for_selector('#cameraPage:visible');page.select_option('#alarmSource','motion');page.click('#protect');page.wait_for_selector('#pinEntry:visible');assert not page.evaluate('state.armed || !!state.stream')
 page.get_by_role('button',name='Cancelar',exact=True).click();assert not page.evaluate('state.armed')
 page.click('#protect');confirm_action(page);page.wait_for_function('state.armed && !protecting',timeout=30000)
 page.screenshot(path='/workspace/security-setup/camera-glass.png',full_page=True)
 page.click('#unlock');page.wait_for_selector('#pinEntry:visible');page.click('#pinSilence');assert page.evaluate('state.armed');unlock_app(page)
 page.click('#protect');enter_pin(page,'000000');page.wait_for_function("document.querySelector('.pin-card p')?.textContent.includes('incorrecto')");assert page.evaluate('state.armed');page.get_by_role('button',name='Cancelar',exact=True).click();assert page.evaluate('state.armed')
 page.click('#silence');assert page.evaluate('state.armed')
 page.click('#protect');confirm_action(page);page.wait_for_function('!state.armed')
 for id in ['brightness','contrast','gamma','sensitivity','confidence','aiInterval','mode','nightToggle','arm']:assert not page.locator('#'+id).is_visible(),id
 page.click('#unlock');unlock_app(page);assert not page.evaluate('state.armed')
 page.click('#navSettings');page.click('#pin');enter_pin(page);page.wait_for_function("document.querySelector('.pin-card h2')?.textContent==='Crea tu PIN'")
 page.get_by_role('button',name='Cancelar',exact=True).click();page.wait_for_function('!pinPromptOpen')
 page.click('#pin');enter_pin(page);page.wait_for_function("document.querySelector('.pin-card h2')?.textContent==='Crea tu PIN'");enter_pin(page,'654321');page.wait_for_function("document.querySelector('.pin-card h2')?.textContent==='Repite tu PIN'");enter_pin(page,'654321');page.wait_for_function('!pinPromptOpen')
 page.reload();page.wait_for_selector('#pinEntry:visible');enter_pin(page);page.wait_for_function("document.querySelector('.pin-card p')?.textContent.includes('incorrecto')");enter_pin(page,'654321');page.wait_for_function('securityUnlocked')
 assert not errors,errors
 print('PASS confirmed PIN creation, entry/reload lock, wrong PIN rejection, cancel-safe arm/disarm, correct authorization and immediate non-disarming silence')
 b.close()

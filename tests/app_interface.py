"""New app navigation and actual local profile persistence; no mock account success."""
from playwright.sync_api import sync_playwright
from pin_helpers import unlock_app,confirm_action
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera'],viewport={'width':390,'height':844});page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001');unlock_app(page)
 page.wait_for_selector('#welcomePage:visible');page.screenshot(path='/workspace/security-setup/app-welcome.png',full_page=True)
 page.click('#welcomeLocal');page.wait_for_selector('#landingPage:visible');assert not page.evaluate('!!state.stream')
 page.click('#navSettings');page.wait_for_selector('#profilePage:visible');page.click('#editProfile');page.fill('#profileNameInput','Alex');page.fill('#profileHomeInput','Casa Mallorca');page.fill('#profileCameraInput','Puerta principal');page.get_by_role('button',name='Guardar perfil',exact=True).click()
 page.wait_for_selector('#profileSheet',state='hidden');assert page.locator('#profileDisplayName').inner_text()=='Alex'
 page.screenshot(path='/workspace/security-setup/app-profile.png',full_page=True)
 page.click('#accountOpen');page.wait_for_selector('#accountPage:visible');page.screenshot(path='/workspace/security-setup/app-login.png',full_page=True);page.fill('#supabaseEmail','test@example.com');page.fill('#supabasePassword','not-a-real-password');page.click('#supabaseLogin');page.wait_for_function("document.getElementById('supabaseStatus').textContent.includes('aún no está conectado')");assert not page.evaluate('!!cloudUser')
 page.click('#accountLocal');page.wait_for_selector('#landingPage:visible');assert page.locator('#homeTitle').inner_text()=='Casa Mallorca';page.screenshot(path='/workspace/security-setup/app-home.png',full_page=True)
 page.click('#navCameras');page.wait_for_selector('#camerasPage:visible');assert 'Puerta principal' in page.locator('#cameraList').inner_text();assert 'Accede a tu cuenta' in page.locator('#cloudCameraCards').inner_text()
 page.click('#addFromCameras');page.wait_for_selector('#addSheet:visible');page.click('#useThisPhone');page.wait_for_selector('#cameraPage:visible');page.click('#protect');confirm_action(page);page.wait_for_function('state.armed && !protecting',timeout=30000)
 page.screenshot(path='/workspace/security-setup/app-camera.png',full_page=True)
 page.click('#record');page.wait_for_function('state.recording');page.wait_for_timeout(1800);page.click('#record');page.wait_for_function("document.querySelectorAll('.clip').length===1")
 page.click('#navClips');page.wait_for_selector('#activityPage:visible');page.get_by_role('button',name='Eliminar',exact=True).click();page.wait_for_selector('#pinEntry:visible');page.get_by_role('button',name='Cancelar',exact=True).click();assert page.locator('.clip').count()==1
 page.get_by_role('button',name='Eliminar',exact=True).click();confirm_action(page);page.wait_for_function("document.querySelectorAll('.clip').length===0")
 page.click('#navHome');page.wait_for_selector('#landingPage:visible');assert page.evaluate('state.armed && !!state.stream')
 page.wait_for_selector('#homePreview:visible',timeout=7000)
 page.evaluate('state.mask={x:0,y:0,w:.3,h:.3};previewAt=0;updateDevicePreview()');page.wait_for_timeout(150)
 assert page.locator('#homePreview').evaluate("async img=>{await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);return Array.from(x.getImageData(5,5,1,1).data).slice(0,3).every(v=>v<10)}")
 page.evaluate('state.mask=null')
 page.click('#homeClips');page.wait_for_selector('#activityPage:visible');page.click('#showEvents');assert page.locator('#eventsGroup').is_visible()
 page.reload();unlock_app(page);page.click('#navSettings');assert page.locator('#profileDisplayName').inner_text()=='Alex'
 assert not errors,errors
 print('PASS app onboarding, local profile save/reload, real login rejection without service, camera list, add-device sheet, PIN-protected arming and activity navigation')
 b.close()

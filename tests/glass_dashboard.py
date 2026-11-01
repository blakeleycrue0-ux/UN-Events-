"""Reference-inspired dashboard with real local controls and a single camera stream."""
from playwright.sync_api import sync_playwright
from pin_helpers import empty_people_model,unlock_app,confirm_action
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera'],viewport={'width':390,'height':844});c.add_init_script('''window.cameraRequests=0;const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=(...args)=>{cameraRequests++;return gum(...args)}''')
 page=c.new_page();errors=[];requests=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url));page.goto('http://127.0.0.1:8001')
 page.wait_for_selector('#pinEntry:visible');assert page.locator('.pin-brand').inner_text()=='SECURITY CAM';page.screenshot(path='/tmp/security-glass-pin.png');unlock_app(page);empty_people_model(page);page.click('#welcomeLocal')
 assert page.locator('.app-navigation button').count()==5;assert page.locator('#homeStartCamera').is_visible();assert page.locator('#accountPage').count()==0
 page.screenshot(path='/tmp/security-glass-home-idle.png',full_page=True)
 page.click('#homeStartCamera');page.wait_for_function('!!state.stream && video.videoWidth>0');page.wait_for_function('!homeActionBusy');page.wait_for_timeout(800)
 assert page.evaluate('!state.armed && !state.recording && cameraRequests===1');assert page.locator('#homeCameraCount').inner_text()=='1 activa'
 stream=page.evaluate('state.stream.id');before=page.evaluate('video.getVideoPlaybackQuality().totalVideoFrames');page.wait_for_timeout(700);assert page.evaluate('video.getVideoPlaybackQuality().totalVideoFrames')>before
 assert page.locator('#homeLiveHost #video').is_visible();page.screenshot(path='/tmp/security-glass-home-live.png',full_page=True)
 page.click('#navCameras');page.locator('#cameraList button').click();page.wait_for_selector('#cameraPage:visible');assert page.locator('#cameraLiveHost #video').is_visible()
 page.uncheck('#person');page.select_option('#recordMode','manual');page.click('#navHome');assert page.evaluate('state.stream.id')==stream;assert page.evaluate('cameraRequests===1')
 with page.expect_download() as photo_download:page.click('#photo')
 assert photo_download.value.suggested_filename.endswith('.jpg')
 with open(photo_download.value.path(),'rb') as picture:assert picture.read(2)==bytes([255,216])
 page.click('#record');page.wait_for_function('state.recording');assert page.locator('#rec').is_visible();page.wait_for_timeout(1300);page.click('#record');page.wait_for_function('!state.recording && !state.recordFinalizing && state.clipSummary?.length===1')
 page.wait_for_selector('#recentActivity img');assert page.evaluate("events.some(e=>!!e.clipId && state.clipSummary.some(c=>c.id===e.clipId))")
 page.fill('#globalSearch','manual');page.wait_for_selector('#searchResults:visible');page.locator('#searchResults button').filter(has_text='clip guardado').first.click();page.wait_for_selector('#activityPage:visible');assert page.locator('.clip.search-highlight').count()==1
 page.click('#navEvents');assert page.locator('#eventsGroup').is_visible();assert 'active' in page.locator('#navEvents').get_attribute('class');assert 'active' not in (page.locator('#navClips').get_attribute('class') or '')
 page.click('#navHome');page.click('#homeProtect');page.wait_for_selector('#pinEntry:visible');page.get_by_role('button',name='Cancelar',exact=True).click();page.wait_for_function('!homeActionBusy');assert not page.evaluate('state.armed')
 page.click('#homeProtect');confirm_action(page);page.wait_for_function('state.armed && !homeActionBusy');assert page.evaluate('cameraRequests===1');page.click('#homeProtect');confirm_action(page);page.wait_for_function('!state.armed && !homeActionBusy')
 page.click('#homeStorage');assert page.locator('#activityPage').is_visible();page.click('#navHome')
 # Test the CSS expansion fallback used when Safari has no element fullscreen API.
 page.evaluate('()=>{document.getElementById("stage").requestFullscreen=undefined}');page.click('#fullscreen');assert page.evaluate('document.body.classList.contains("video-expanded")');page.wait_for_timeout(100);assert page.evaluate('(()=>{const r=document.getElementById("stage").getBoundingClientRect();return Math.abs(r.width-innerWidth)<2 && Math.abs(r.height-innerHeight)<2})()');page.click('#exitExpanded');assert not page.evaluate('document.body.classList.contains("video-expanded")')
 page.click('#cameraPower');confirm_action(page);page.wait_for_function('!state.stream && !homeActionBusy');assert page.locator('#homeStartCamera').is_visible();assert page.locator('#homeCameraCount').inner_text()=='0 activas'
 page.fill('#globalSearch','sin-coincidencia-xyz');page.wait_for_selector('#searchResults:visible');assert 'No hay resultados' in page.locator('#searchResults').inner_text();page.fill('#globalSearch','camara');page.locator('#searchResults button').first.click();assert page.locator('#cameraPage').is_visible();assert not page.evaluate('state.stream')
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'No mobile horizontal overflow'
 assert not any('supabase' in r for r in requests);assert not errors,errors
 desktop=b.new_context(viewport={'width':1280,'height':900});d=desktop.new_page();d.goto('http://127.0.0.1:8001');unlock_app(d);d.click('#welcomeLocal');d.screenshot(path='/tmp/security-glass-desktop.png',full_page=True);assert d.evaluate('document.documentElement.scrollWidth<=innerWidth')
 print('PASS glass PIN; honest idle/live status; one native stream shared across Home/camera; actual JPEG download, real home clip and exact event thumbnail; local search and navigation; PIN arm/disarm; storage route; Safari-style fullscreen fallback; stop camera; mobile/desktop layout; no account/network calls')
 b.close()

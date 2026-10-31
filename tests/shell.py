from pin_helpers import unlock_app, confirm_action
"""Home navigation preserves local surveillance; the viewer never starts a camera."""
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera'],viewport={'width':390,'height':844});page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001');unlock_app(page);assert page.locator('#landingPage').is_visible();assert not page.evaluate('!!state.stream');page.screenshot(path='/workspace/security-setup/glass-home-mobile.png',full_page=True)
 page.click('#openViewer');assert page.locator('#remotePage').is_visible();assert not page.evaluate('!!state.stream')
 page.click('#connectRemote');assert 'WSS' in page.locator('#remoteStatus').inner_text() or 'URL' in page.locator('#remoteStatus').inner_text()
 page.click('#backHome');page.click('#openCamera');page.wait_for_selector('#cameraPage:visible');page.locator('.extra-tools').evaluate('d=>d.open=true');page.click('#camera');page.wait_for_function('!!state.stream && video.videoWidth>0')
 page.click('#backHome');assert page.locator('#landingPage').is_visible();assert page.evaluate("!!state.stream && document.getElementById('captureDock').contains(video)")
 before=page.evaluate('video.currentTime');page.wait_for_timeout(1200);assert page.evaluate('video.currentTime')>before
 page.click('#homeClips');assert page.locator('#cameraPage').is_visible();assert page.locator('.evidence').get_attribute('open') is not None;assert page.evaluate("document.getElementById('stage').contains(video)")
 assert not errors,errors
 print('PASS home and viewer start without camera; navigation preserves the active source; local evidence route works')
 b.close()

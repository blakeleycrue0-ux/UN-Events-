from pin_helpers import unlock_app, confirm_action
"""Native live preview must continue when AI inference is blocked; compact mobile UX."""
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera'],viewport={'width':390,'height':844});page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001/#camera');unlock_app(page);page.wait_for_function('!!db')
 assert page.locator('.settings').get_attribute('open') is None
 assert page.locator('#protect').is_visible()
 page.locator('.extra-tools').evaluate('d=>d.open=true');page.click('#camera');page.wait_for_function('!!state.stream && video.videoWidth>0');page.wait_for_timeout(700)
 assert page.locator('#video').evaluate("v=>getComputedStyle(v).opacity")=='1'
 assert page.evaluate('ctx.getImageData(overlay.width/2,overlay.height/2,1,1).data[3]')==0
 # A pending inference suspends the analysis loop, but never the native media element.
 page.evaluate("""()=>{state.model={detect:()=>new Promise(r=>window.releaseAI=r)};document.getElementById('person').checked=true;lastAI=0;}""")
 page.wait_for_function('!!window.releaseAI');before=page.evaluate('video.getVideoPlaybackQuality().totalVideoFrames');page.wait_for_timeout(1300);after=page.evaluate('video.getVideoPlaybackQuality().totalVideoFrames');assert after-before>=5,(before,after)
 assert page.evaluate('state.busy')
 page.evaluate("releaseAI({object:[]});document.getElementById('person').checked=false")
 print('PASS native preview advances while AI is blocked; overlay has no frozen camera image')
 page.locator('#nightToggle').evaluate('e=>e.click()');assert 'ON' in page.locator('#nightToggle').inner_text()
 assert '160%' in page.locator('#video').evaluate('v=>v.style.filter')
 page.wait_for_timeout(600);page.screenshot(path='/workspace/security-setup/live-simple.png')
 page.locator('#nightToggle').evaluate('e=>e.click()');assert 'OFF' in page.locator('#nightToggle').inner_text()
 assert 'brightness(100%)' in page.locator('#video').evaluate('v=>v.style.filter')
 page.reload();unlock_app(page);assert 'AUTO' in page.locator('#nightToggle').text_content()
 print('PASS internal night filters work; automatic defaults restored; settings collapsed')
 assert not errors,errors
 b.close()

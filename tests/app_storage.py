"""Quota failure produces a real encoded pending clip, accessible via Activity."""
from playwright.sync_api import sync_playwright
from pin_helpers import unlock_app
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera'],accept_downloads=True);page=c.new_page();page.goto('http://127.0.0.1:8001/#camera');unlock_app(page);page.click('#camera');page.wait_for_function('!!state.stream && video.videoWidth>0')
 page.evaluate("()=>{window.realStore=store;store=(name,method,value)=>name==='clips'&&method==='put'?Promise.reject(Error('Injected storage failure')):realStore(name,method,value)}")
 page.click('#record');page.wait_for_function('state.recording');page.wait_for_timeout(1500);page.click('#record');page.wait_for_function('state.storageFailed')
 assert page.locator('#rec').is_hidden();page.click('#navClips');page.wait_for_selector('#activityPage:visible');assert page.locator('.pending-evidence').is_visible()
 page.evaluate('()=>{store=realStore}');page.evaluate('renderClips()');page.wait_for_timeout(200);assert page.locator('.pending-evidence').is_visible()
 print('PASS failed real clip save turns REC off and retains emergency download in Activity across evidence refresh')
 b.close()

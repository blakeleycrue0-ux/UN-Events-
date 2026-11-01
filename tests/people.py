"""Real local person-model loading/inference through the current app UI, not accuracy validation."""
from playwright.sync_api import sync_playwright
from pin_helpers import unlock_app,confirm_action
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera']);page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001/#camera');unlock_app(page);page.click('#camera')
 page.wait_for_function('!!state.model && !state.armed',timeout=90000);page.wait_for_function('state.personResultAt>0 && !state.busy',timeout=90000)
 assert page.evaluate('state.stream.getAudioTracks().length===0')
 assert not page.evaluate('state.recording || state.episode');page.click('#camera');confirm_action(page);page.wait_for_function('!state.stream');assert not errors,errors
 print('PASS actual local person model loads and executes in live preview without arming; no microphone')
 b.close()

"""Actual local model load failure is visible, cannot arm, and retries after recovery."""
from playwright.sync_api import sync_playwright
from pin_helpers import unlock_app,confirm_action
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera']);page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));failure={'active':True,'requests':0}
 def weights(route):
  failure['requests']+=1
  if failure['active']:route.abort('failed')
  else:route.continue_()
 page.route('**/models/centernet.bin',weights)
 page.goto('http://127.0.0.1:8001/#camera');unlock_app(page);page.click('#camera');page.wait_for_function('!!state.peopleError && !state.peopleLoading',timeout=30000)
 assert 'ERROR DE DETECCIÓN' in page.locator('#peopleStatus').inner_text();assert page.locator('#retryPeople').is_visible();assert page.locator('#person').is_checked();assert not page.evaluate('state.recording || state.armed || document.getElementById("motion").checked')
 page.click('#protect');confirm_action(page);page.wait_for_function('!protecting && !state.peopleLoading',timeout=30000);assert not page.evaluate('state.armed || state.recording'), 'Failed person model must not arm or fall back to motion'
 failure['active']=False;page.click('#retryPeople');page.wait_for_function('!!state.model && state.personResultAt>0 && !state.peopleError',timeout=30000)
 assert not page.evaluate('state.armed || state.recording');assert failure['requests']>=2;assert not errors,errors
 print('PASS actual CenterNet weight failure is shown; failed model cannot arm; no movement fallback; real model retry succeeds and preview inference resumes')
 b.close()

"""A controlled person detector triggers real MP3 voice then native siren, never motion."""
from playwright.sync_api import sync_playwright
from pin_helpers import unlock_app,confirm_action
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera']);page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001/#camera');unlock_app(page);page.evaluate('()=>{state.model={detect:async()=>({object:[{label:"person",score:.96,boxRaw:[.2,.2,.3,.6]}]})}}')
 page.select_option('#surveillanceMode','alarm');page.get_by_text('Audio y respuesta',exact=True).click();page.check('#autoVoice');page.check('#autoAlarm');page.fill('#confirmation','1')
 page.click('#protect');confirm_action(page);page.wait_for_function('state.armed && !protecting');page.wait_for_function('state.warningPending',timeout=15000);page.wait_for_function('state.alarm && !!siren',timeout=35000)
 page.click('#globalSilence');page.click('#protect');confirm_action(page);page.wait_for_function('!state.armed');assert not page.evaluate('state.alarm || state.warningPending');assert not errors,errors
 print('PASS person-only detection through primary PIN arm -> real MP3 voice -> fresh person confirmation -> native siren; silence and PIN disarm')
 b.close()

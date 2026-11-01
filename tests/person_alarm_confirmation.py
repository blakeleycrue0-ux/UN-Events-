"""Cached boxes must not activate a siren without a fresh person-model confirmation."""
from playwright.sync_api import sync_playwright
from pin_helpers import unlock_app,confirm_action
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera']);page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001/#camera');unlock_app(page);page.uncheck('#motion');page.uncheck('#autoDetail')
 page.evaluate('()=>{window.personHere=true;state.model={detect:async()=>({object:personHere?[{label:"person",score:.9,boxRaw:[.3,.2,.2,.6]}]:[]})}}')
 page.select_option('#surveillanceMode','alarm');page.get_by_text('Audio y respuesta',exact=True).click();page.check('#autoAlarm');page.select_option('#alarmSource','person');page.fill('#confirmation','1')
 page.click('#protect');confirm_action(page);page.wait_for_function('state.persons.length>0 && state.episode');page.evaluate('personHere=false')
 page.wait_for_function("events.some(e=>e.message.includes('comprobación actual sin detección'))",timeout=12000)
 assert not page.evaluate('state.alarm || !!siren');assert page.evaluate('state.recording'), 'Evidence recording continues after a cancelled siren'
 page.wait_for_function('!state.episode',timeout=12000);page.evaluate('personHere=true');page.wait_for_function('state.alarm && !!siren',timeout=15000)
 page.click('#globalSilence');page.click('#protect');confirm_action(page);page.wait_for_function('!state.armed');assert not errors,errors
 print('PASS cached person observation cancels siren on fresh negative inference; fresh positive inference starts actual multimedia siren; clips remain independent')
 b.close()

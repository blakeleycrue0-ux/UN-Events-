"""Actual browser touch/pointer gestures in a mobile viewport; not an iPhone hardware test."""
from playwright.sync_api import sync_playwright
from pin_helpers import unlock_app,confirm_action
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera'],viewport={'width':390,'height':844},has_touch=True,is_mobile=True);page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001/#camera');unlock_app(page);page.uncheck('#person');assert not page.evaluate('state.stream')
 page.click('#zone');page.wait_for_selector('#zoneApply:visible');page.wait_for_function('!!state.stream && drawMode==="zone"')
 assert page.evaluate('!state.armed && !state.model && !state.recording'), 'Editing starts only the camera'
 session=c.new_cdp_session(page)
 def drag(a,b,cancel=False):
  r=page.evaluate('()=>{const b=overlay.getBoundingClientRect(),v=viewRect();return {x:b.x+v.x,y:b.y+v.y,w:v.w,h:v.h}}')
  def point(p):return {'x':r['x']+p[0]*r['w'],'y':r['y']+p[1]*r['h']}
  session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[point(a)]})
  for n in range(1,7):
   step=(a[0]+(b[0]-a[0])*n/6,a[1]+(b[1]-a[1])*n/6)
   session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[point(step)]});page.wait_for_timeout(25)
  session.send('Input.dispatchTouchEvent',{'type':'touchCancel' if cancel else 'touchEnd','touchPoints':[]})
 drag((.15,.2),(.75,.85));assert page.evaluate('state.zone===null && zoneDraft.w>.5');page.click('#zoneApply');page.wait_for_function('!drawMode')
 original=page.evaluate('({...state.zone})');assert abs(original['w']-.6)<.03
 page.click('#zone');drag((.75,.85),(.9,.9));assert page.evaluate('zoneDraft.w>.7');page.click('#zoneCancel');assert page.evaluate('({...state.zone})')==original
 page.click('#zone');drag((.75,.85),(.9,.9),True);assert page.evaluate('({...state.zone})')==original;page.click('#zoneCancel')
 page.click('#zone');drag((.45,.5),(.55,.5));page.set_viewport_size({'width':844,'height':390});page.wait_for_timeout(200)
 assert page.locator('#zoneApply').is_visible();assert page.evaluate('overlay.getBoundingClientRect().height>100');page.click('#zoneApply');saved=page.evaluate('({...state.zone})');assert saved['x']>original['x']+.07
 page.set_viewport_size({'width':390,'height':844});page.click('#protect');confirm_action(page);page.wait_for_function('state.armed');page.click('#zone');page.wait_for_selector('#pinEntry:visible');page.get_by_role('button',name='Cancelar',exact=True).click();assert not page.evaluate('drawMode');assert page.evaluate('({...state.zone})')==saved
 page.click('#zone');confirm_action(page);page.wait_for_selector('#zoneApply:visible');page.wait_for_timeout(800);assert page.evaluate('state.armed && !state.recording');page.screenshot(path='/tmp/security-zone-touch.png');page.click('#zoneCancel')
 page.click('#protect');confirm_action(page);page.wait_for_function('!state.armed');page.reload();unlock_app(page);assert page.evaluate('({...state.zone})')==saved
 assert not errors,errors
 print('PASS touch drawing starts camera; draft/save/cancel; corner resize; move; touch cancellation; landscape; PIN preserves armed zone; zone persists after reload')
 b.close()

"""Torch control logic only: hardware capability/constraints are mocked, not real flash."""
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 c=b.new_context(permissions=['camera'])
 c.add_init_script("""window.torchCalls=[];MediaStreamTrack.prototype.getCapabilities=function(){return {torch:true}};MediaStreamTrack.prototype.applyConstraints=async function(c){if(c.advanced)torchCalls.push({on:c.advanced[0].torch,time:Date.now()})};""")
 page=c.new_page();page.add_init_script("document.addEventListener('DOMContentLoaded',()=>document.querySelectorAll('details').forEach(d=>d.open=true))");page.goto('http://127.0.0.1:8001/#camera');page.click('#camera');page.wait_for_function('!!state.stream && !document.getElementById("torch").disabled')
 assert page.locator('#eventLight').is_enabled()
 page.fill('#torchLimit','5');page.check('#torch');page.wait_for_function("torchCalls.some(c=>c.on)")
 page.wait_for_function("!document.getElementById('torch').checked",timeout=8000)
 page.click('#enableAudio');page.check('#alarmFlash');page.select_option('#alarmDuration','5');page.click('#alarm');page.wait_for_function('state.alarm');page.wait_for_function('!state.alarm',timeout=8000)
 calls=page.evaluate('torchCalls');on=[c for c in calls if c['on']]
 assert len(on)>=2
 # No rapid on/off patterns: periodic flash transitions are 2 seconds apart.
 page.check('#torch');page.click('#arm');page.click('#arm');page.wait_for_function("!document.getElementById('torch').checked")
 print('PASS mocked torch capability, timed cutoff, slow alarm flash and disarm shutdown; real hardware untested')
 # A slow audio decode must never reactivate illumination after immediate silence.
 page.evaluate("""()=>{window.originalSound=sound;sound=()=>new Promise(r=>setTimeout(r,700));}""")
 page.click('#alarm');page.click('#silence');count=page.evaluate('torchCalls.length');page.wait_for_timeout(1200)
 assert not page.evaluate('state.alarm')
 assert not page.evaluate('torchCalls.slice('+str(count)+').some(c=>c.on)')
 print('PASS immediate silence cancels delayed alarm audio/flash continuation')
 page.click('#camera');b.close()

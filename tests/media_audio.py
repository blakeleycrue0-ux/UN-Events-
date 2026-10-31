from pin_helpers import unlock_app, confirm_action
"""Real media playback; cannot establish physical speaker output or iPhone mute behavior."""
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 c=b.new_context();c.add_init_script("Object.defineProperty(navigator,'audioSession',{value:{type:'auto'}})")
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001/#camera');unlock_app(page);page.click('#testSpeaker')
 page.wait_for_function("!!activeAudio && !mediaAudio.paused && mediaAudio.currentTime>.3")
 assert page.evaluate("mediaAudio instanceof HTMLAudioElement && !mediaAudio.muted && mediaAudio.volume>0 && navigator.audioSession.type==='playback'")
 page.click('#silence');assert page.evaluate('mediaAudio.paused && activeAudio===null')
 page.evaluate("()=>{window.originalPlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=()=>Promise.reject(new DOMException('Injected autoplay rejection','NotAllowedError'))}")
 page.click('#testSpeaker');page.wait_for_function('!audioReady');assert not page.evaluate('state.alarm || !!siren')
 assert 'bloqueó' in page.locator('#error').inner_text() or 'NotAllowedError' in page.locator('#error').inner_text()
 page.evaluate('()=>{HTMLMediaElement.prototype.play=originalPlay}')
 page.click('#testSpeaker');page.wait_for_function('!!activeAudio');page.evaluate('mediaAudio.pause()');page.wait_for_function('!audioReady && !activeAudio')
 assert not errors,errors
 print('PASS native unmuted media advances; playback session requested; immediate silence; rejected play and interrupted playback are reported')
 b.close()

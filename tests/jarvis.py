"""Jarvis home page: real face models load in the browser; recognition, voice
(ElevenLabs via Supabase, served by a fixture) and a misbehaving speech
recognizer are exercised with controlled inputs. No real face photo is used."""
import json, pathlib
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:8001/'
MP3 = (pathlib.Path(__file__).parent / 'fixtures' / 'tone.mp3').read_bytes()
INIT = """
window.said=[];
document.addEventListener('DOMContentLoaded',()=>{const say=document.getElementById('say');if(!say)return;
  new MutationObserver(()=>said.push(say.textContent)).observe(say,{subtree:true,childList:true,characterData:true});});
// A scriptable recognizer: each test sets window.recScript before tapping.
window.recScript={results:[],end:true,error:null};
window.webkitSpeechRecognition=class{
  start(){window.recStarted=(window.recStarted||0)+1;const s=window.recScript;let d=50;
    for(const [text,fin] of s.results){setTimeout(()=>this.onresult&&this.onresult({results:Object.assign([[{transcript:text}]],{0:Object.assign([{transcript:text}],{isFinal:fin})})}),d);d+=60}
    if(s.error)setTimeout(()=>this.onerror&&this.onerror({error:s.error}),d);
    if(s.end)setTimeout(()=>this.onend&&this.onend(),d+30);}
  stop(){} abort(){}
};
window.SpeechRecognition=window.webkitSpeechRecognition;
"""
FAKE = """(vec)=>{
  window.nextFace=vec;
  jarvis.detector={detect:async()=>window.nextFace?[{embedding:window.nextFace,score:0.95}]:[],
    similarity:(a,b)=>{let d=0,x=0,y=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];x+=a[i]*a[i];y+=b[i]*b[i]}return d/Math.sqrt(x*y)}};
}"""
A = [1, 0, 0, 0]
B = [0, 1, 0, 0]
voice = []

def tap_and_wait(page, script, expect):
    page.evaluate('s=>{window.recScript=s; said.length=0}', script)
    page.click('#bubble', force=True)
    page.wait_for_function('s=>said.some(t=>t.includes(s))', arg=expect, timeout=8000)
    page.wait_for_function("document.body.dataset.state==='idle' && !jarvis.listening", timeout=8000)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
    c = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera'])
    page = c.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script(INIT)
    def tts(route):
        req = route.request
        cors = {'Access-Control-Allow-Origin': 'http://127.0.0.1:8001', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS'}
        if req.method == 'OPTIONS': return route.fulfill(status=204, headers=cors)
        voice.append({'key': req.headers.get('x-jarvis-key'), 'text': json.loads(req.post_data)['text']})
        if req.headers.get('x-jarvis-key') != 'mi-clave-secreta':
            return route.fulfill(status=401, headers={**cors, 'Content-Type': 'application/json'}, body='{"error":"Wrong Jarvis key"}')
        route.fulfill(status=200, headers={**cors, 'Content-Type': 'audio/mpeg'}, body=MP3)
    page.route('https://*.supabase.co/functions/v1/jarvis-voice', tts)
    page.goto(URL)
    assert page.evaluate("document.body.dataset.state") == 'off'
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path='/tmp/jarvis-off.png')

    # First tap wakes Jarvis: real face models (blazeface, facemesh, faceres) load on the live camera.
    page.click('#bubble', force=True)
    page.wait_for_function('jarvis.started', timeout=90000)
    page.wait_for_function("document.body.dataset.state==='idle'")
    page.wait_for_function("document.getElementById('faceState').textContent==='Sin cara registrada'", timeout=30000)
    assert page.locator('#eye').is_visible()
    assert page.evaluate("jarvis.stream.getAudioTracks().length===0")
    assert 'clave de voz' in page.locator('#say').inner_text() and not voice

    # Voice: wrong key is reported, right key plays ElevenLabs audio.
    page.click('#openSettings'); page.fill('#voiceKey', 'otra'); page.click('#testVoice')
    page.wait_for_function("document.getElementById('voiceInfo').textContent.includes('no coincide')")
    page.fill('#voiceKey', 'mi-clave-secreta'); page.click('#testVoice')
    page.wait_for_function("document.getElementById('voiceInfo').textContent==='Voz funcionando.'", timeout=10000)
    assert voice[-1] == {'key': 'mi-clave-secreta', 'text': 'Hola, Crew. Así sueno ahora.'}, voice[-1]
    page.click('#closeSettings')

    # Listening never hangs: normal answer, recognizer that stalls, silence, refused microphone.
    tap_and_wait(page, {'results': [['qué', False], ['qué hora es', True]], 'end': True}, 'Son las')
    assert voice[-1]['text'].startswith('Son las')
    page.evaluate("jarvis.listenLimits={silenceMS:400,noSpeechMS:900,maxMS:3000}")
    page.evaluate('s=>{window.recScript=s; said.length=0}', {'results': [['hola', False]], 'end': False})
    page.click('#bubble', force=True)
    page.wait_for_function("document.getElementById('heard').textContent.includes('hola')", timeout=5000)
    page.wait_for_function("said.some(t=>/Buen(os|as)/.test(t))", timeout=5000)
    page.wait_for_function("!jarvis.listening")
    tap_and_wait(page, {'results': [], 'end': False}, 'No te he oído')
    tap_and_wait(page, {'results': [], 'end': False, 'error': 'not-allowed'}, 'permiso para el micrófono')
    # Tapping while it speaks or listens stops cleanly.
    page.evaluate('s=>{window.recScript=s}', {'results': [], 'end': False})
    page.click('#bubble', force=True); page.wait_for_function('jarvis.listening'); page.click('#bubble', force=True)
    page.wait_for_function("!jarvis.listening && document.body.dataset.state==='idle'")

    # Commands.
    h = lambda t: page.evaluate('t=>jarvis.handle(t)', t)
    assert h('qué día es hoy').startswith('Hoy es')
    assert 'Todavía no puedo controlar las luces' in h('Jarvis, enciende la luz')
    assert 'la Play' in h('enciende la play')
    assert 'el aire acondicionado' in h('apaga el aire')
    assert 'qué puedes hacer' in h('blablabla')
    assert 'te aviso en 1 segundo' in h('pon un temporizador de 1 segundo')
    page.wait_for_function("said.some(s=>s.includes('se acabó el tiempo'))", timeout=6000)
    assert 'te aviso en 5 minutos' in h('pon una alarma de cinco minutos')

    # Face enrolment and recognition with a controlled detector.
    page.click('#openSettings'); page.fill('#name', 'Crew'); page.dispatch_event('#name', 'change')
    page.evaluate(FAKE, A)
    page.click('#enroll'); assert page.locator('#preview').is_visible()
    page.wait_for_function('jarvis.faces.length===5', timeout=10000)
    page.wait_for_function("said.some(s=>s.includes('Ya te reconozco'))")
    page.screenshot(path='/tmp/jarvis-settings.png')
    page.click('#closeSettings')
    page.evaluate('said.length=0; jarvis.lastSeen=0')
    page.wait_for_function("said.some(s=>/^Buen(os|as) [a-z]+, Crew\./.test(s))", timeout=6000)
    page.wait_for_function("document.body.dataset.state==='idle'", timeout=8000)
    n = page.evaluate('said.length'); page.wait_for_timeout(2200)
    assert page.evaluate('said.length') == n, 'No repeated greeting while you stay in the room'
    page.evaluate('v=>{window.nextFace=v; said.length=0; jarvis.lastSeen=0}', B)
    page.wait_for_function("document.getElementById('faceState').textContent==='Persona desconocida'")
    page.wait_for_timeout(1200); assert page.evaluate('said.length') == 0, 'A stranger is never greeted'
    page.evaluate('()=>{window.nextFace=null}')
    page.wait_for_function("document.getElementById('faceState').textContent==='Nadie a la vista'")
    page.evaluate("document.getElementById('say').textContent='Buenas noches, Crew. ¿En qué te ayudo?'")
    page.screenshot(path='/tmp/jarvis-home.png')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')

    # Typed fallback.
    page.click('#openSettings'); page.check('#showType'); page.click('#closeSettings')
    page.fill('#typeInput', 'cuéntame un chiste'); page.press('#typeInput', 'Enter')
    page.wait_for_function("document.getElementById('heard').textContent.includes('chiste')")

    # Persistence and forgetting.
    page.reload(); page.click('#openSettings')
    assert page.locator('#name').input_value() == 'Crew' and page.locator('#voiceKey').input_value() == 'mi-clave-secreta'
    assert 'Registrada' in page.locator('#faceInfo').inner_text()
    page.click('#forget'); assert page.evaluate("JSON.parse(localStorage.getItem('jarvis-faces')).length") == 0

    # Old invitation links still reach the hidden camera app, even in an open tab.
    page.goto(URL + '#invite=' + 'a' * 64)
    page.wait_for_url('**/camara.html**')
    assert not errors, errors
    print('PASS Jarvis: real face models on live camera without microphone; ElevenLabs voice via private key (wrong key reported); listening always recovers (final, stalled, silent, refused, cancelled); commands and timers; local face enrolment, one greeting per arrival, strangers ignored; settings persist; invite links redirect')
    b.close()

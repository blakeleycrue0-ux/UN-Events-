"""Jarvis home page: real face models load in the browser; conversation (Claude),
voice (ElevenLabs) and the speech recognizer are fixtures, including a Safari-like
recognizer that stalls. No real face photo is used."""
import json, pathlib
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:8001/'
MP3 = (pathlib.Path(__file__).parent / 'fixtures' / 'tone.mp3').read_bytes()
INIT = """
window.said=[];
document.addEventListener('DOMContentLoaded',()=>{const say=document.getElementById('say');if(!say)return;
  new MutationObserver(()=>said.push(say.textContent)).observe(say,{subtree:true,childList:true,characterData:true});});
// Scriptable recognizer. Each start() takes the next script from recQueue,
// otherwise behaves like an idle iPhone: hears nothing and ends after a moment.
window.recQueue=[];window.recLog=[];
window.webkitSpeechRecognition=class{
  start(){const s=window.recQueue.shift()||{results:[],end:true,endDelay:300};
    recLog.push({lang:this.lang,continuous:this.continuous,script:!!s.results.length});
    let d=40;
    for(const [text,fin] of s.results){setTimeout(()=>this.onresult&&this.onresult({results:Object.assign([[{transcript:text}]],{0:Object.assign([{transcript:text}],{isFinal:fin})})}),d);d+=50}
    if(s.error)setTimeout(()=>this.onerror&&this.onerror({error:s.error}),d);
    if(s.end)setTimeout(()=>this.onend&&this.onend(),d+(s.endDelay||20));}
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
voice, brain = [], []
CORS = {'Access-Control-Allow-Origin': 'http://127.0.0.1:8001', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS'}

def tts(route):
    req = route.request
    if req.method == 'OPTIONS': return route.fulfill(status=204, headers=CORS)
    body = json.loads(req.post_data)
    voice.append({'key': req.headers.get('x-jarvis-key'), **body})
    if req.headers.get('x-jarvis-key') != 'mi-clave-secreta':
        return route.fulfill(status=401, headers={**CORS, 'Content-Type': 'application/json'}, body='{"error":"Wrong Jarvis key"}')
    route.fulfill(status=200, headers={**CORS, 'Content-Type': 'audio/mpeg'}, body=MP3)

def think(route):
    req = route.request
    if req.method == 'OPTIONS': return route.fulfill(status=204, headers=CORS)
    body = json.loads(req.post_data); brain.append(body)
    last = body['messages'][-1]['content']
    if last == 'blorp':
        return route.fulfill(status=502, headers={**CORS, 'Content-Type': 'application/json'}, body='{"error":"Claude key rejected"}')
    route.fulfill(status=200, headers={**CORS, 'Content-Type': 'application/json'}, body=json.dumps({'reply': 'Brain says: ' + last}))

def wait_said(page, pattern, timeout=8000):
    page.wait_for_function('p=>said.some(t=>new RegExp(p).test(t))', arg=pattern, timeout=timeout)

def calm(page):
    # Idle, and (if always-listening) back in the background session, past any follow-up window.
    settled = "!jarvis.speaking && document.body.dataset.state==='idle' && !(jarvis.listening && jarvis.listenMode!=='wake')"
    page.wait_for_function(settled, timeout=10000)
    page.wait_for_timeout(500)
    page.wait_for_function(settled + " && (!jarvis.settings.always || jarvis.listenMode==='wake')", timeout=10000)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
    c = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera'])
    page = c.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script(INIT)
    page.route('https://*.supabase.co/functions/v1/jarvis-voice', tts)
    page.route('https://*.supabase.co/functions/v1/jarvis-brain', think)
    page.goto(URL)
    assert page.evaluate("document.body.dataset.state") == 'off'
    assert page.locator('#say').inner_text() == 'Tap the bubble to start'
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path='/tmp/jarvis-off.png')

    # First tap wakes Jarvis: real face models (blazeface, facemesh, faceres) load on the live camera.
    page.click('#bubble', force=True)
    page.wait_for_function('jarvis.started', timeout=90000)
    page.wait_for_function("document.getElementById('faceState').textContent==='Sin cara registrada'", timeout=30000)
    assert page.locator('#eye').is_visible() and page.evaluate("jarvis.stream.getAudioTracks().length===0")
    assert 'Jarvis key' in page.locator('#say').inner_text() and not voice and not brain
    # Always-listening starts on its own, in Spanish recognition, without the user tapping.
    page.wait_for_function("recLog.length>=2 && jarvis.listenMode==='wake'", timeout=8000)
    assert page.evaluate("recLog[0].lang") == 'es-ES' and page.evaluate("recLog[0].continuous") is True
    page.evaluate("jarvis.listenLimits={silenceMS:400,noSpeechMS:900,maxMS:3000,followMS:900,wakeMS:1500}")

    # Voice: wrong key is reported, right key plays ElevenLabs audio in English.
    page.click('#openSettings'); page.fill('#voiceKey', 'otra'); page.click('#testVoice')
    page.wait_for_function("document.getElementById('voiceInfo').textContent.includes('no coincide')")
    page.fill('#voiceKey', 'mi-clave-secreta'); page.click('#testVoice')
    page.wait_for_function("document.getElementById('voiceInfo').textContent==='Voz funcionando.'", timeout=10000)
    assert voice[-1] == {'key': 'mi-clave-secreta', 'text': 'Hello, Crew. This is how I sound now.', 'lang': 'en'}, voice[-1]
    page.click('#closeSettings')
    calm(page)

    # Microphone diagnostics show what the recognizer does.
    page.click('#openSettings'); page.evaluate("recQueue.push({results:[['probando',true]],end:true})"); page.click('#micTest')
    page.wait_for_function("document.getElementById('micLog').textContent.includes('soporte: sí') && document.getElementById('micLog').textContent.includes('probando')")
    page.click('#closeSettings'); calm(page)

    # Tap-to-talk conversation with Claude, then a follow-up without repeating "Jarvis".
    # The tap reuses the running background session (no microphone restart).
    page.evaluate("recQueue.push({results:[['what is the meaning of life',true]],end:true},{results:[['and why',true]],end:true})")
    page.evaluate("said.length=0"); page.click('#bubble', force=True)
    wait_said(page, '^Brain says: what is the meaning of life$')
    wait_said(page, '^Brain says: and why$')
    assert [m['role'] for m in brain[-1]['messages']] == ['user', 'assistant', 'user'], brain[-1]
    assert brain[-1]['lang'] == 'en' and brain[-1]['name'] == 'Crew' and brain[-1]['now']
    for _ in range(50):
        if voice and voice[-1]['text'] == 'Brain says: and why': break
        page.wait_for_timeout(100)
    assert voice[-1]['text'] == 'Brain says: and why' and voice[-1]['lang'] == 'en'
    calm(page)

    # Background listening: only phrases with "Jarvis" are answered.
    n = len(brain); page.evaluate("said.length=0")
    page.evaluate("recQueue.push({results:[['so I was telling my dad',false]],end:false})")
    page.wait_for_function("recLog.filter(r=>r.script).length>=3", timeout=8000); page.wait_for_timeout(1500)
    assert len(brain) == n and page.evaluate('said.length') == 0, 'Ignores speech without the wake word'
    page.evaluate("recQueue.push({results:[['oye Jarvis what are you up to',false]],end:false})")
    wait_said(page, '^Brain says: what are you up to$')
    calm(page)
    # "Jarvis" alone gets an acknowledgement and then listens for the request.
    page.evaluate("said.length=0; recQueue.push({results:[['Jarvis',false]],end:false},{results:[['tell me something cool',true]],end:true})")
    wait_said(page, "^(Yes\\?|At your service\\.|I'm listening\\.)$")
    wait_said(page, '^Brain says: tell me something cool$')
    calm(page)

    # Things the phone itself does are answered instantly, without Claude.
    n = len(brain); page.evaluate("jarvis.settings.always=false; said.length=0; recQueue.push({results:[['turn on the lights',true]],end:true})")
    page.click('#bubble', force=True)
    wait_said(page, "can't control the lights yet"); assert len(brain) == n
    calm(page)
    # Claude failure: a clear message.
    page.evaluate("said.length=0; recQueue.push({results:[['blorp',true]],end:true})"); page.click('#bubble', force=True)
    wait_said(page, "brain's key was rejected"); calm(page)
    # Safari stalls: interim text with no final/end still gets answered; silence recovers.
    page.evaluate("said.length=0; recQueue.push({results:[['hello there',false]],end:false})"); page.click('#bubble', force=True)
    wait_said(page, '^Brain says: hello there$'); calm(page)
    page.evaluate("said.length=0; recQueue.push({results:[],end:false})"); page.click('#bubble', force=True)
    wait_said(page, "didn't catch that"); calm(page)
    page.evaluate("said.length=0; recQueue.push({results:[],end:false,error:'not-allowed'})"); page.click('#bubble', force=True)
    wait_said(page, 'need the microphone'); calm(page)
    # If iPhone refuses background listening, Jarvis falls back to tap-to-talk.
    page.click('#openSettings'); page.uncheck('#always'); page.check('#always'); page.evaluate("recQueue.push({results:[],end:false,error:'not-allowed'})"); page.click('#closeSettings')
    page.wait_for_function("jarvis.wakeBlocked===true && jarvis.settings.always===false", timeout=8000)

    # Local commands in both languages.
    h = lambda t: page.evaluate('t=>jarvis.handle(t)', t)
    assert h("what's the time").startswith("It's")
    assert "I'll remind you in 1 second" in h('set a timer for 1 second')
    wait_said(page, "time's up", 6000)
    page.click('#openSettings'); page.select_option('#lang', 'es'); page.click('#closeSettings')
    assert h('qué hora es').startswith('Son las')
    assert 'te aviso en 5 minutos' in h('pon una alarma de cinco minutos')
    assert 'Todavía no puedo controlar el aire acondicionado' in h('apaga el aire')
    page.click('#openSettings'); page.select_option('#lang', 'en'); page.click('#closeSettings')

    # Face enrolment and recognition with a controlled detector.
    page.click('#openSettings'); page.fill('#name', 'Crew'); page.dispatch_event('#name', 'change')
    page.evaluate(FAKE, A)
    page.click('#enroll'); assert page.locator('#preview').is_visible()
    page.wait_for_function('jarvis.faces.length===5', timeout=10000)
    wait_said(page, "recognise you now")
    page.screenshot(path='/tmp/jarvis-settings.png')
    page.click('#closeSettings'); calm(page)
    page.evaluate('said.length=0; jarvis.lastSeen=0')
    wait_said(page, '^Good (morning|afternoon|evening), Crew\\.')
    calm(page)
    n = page.evaluate('said.length'); page.wait_for_timeout(2200)
    assert page.evaluate('said.length') == n, 'No repeated greeting while you stay in the room'
    page.evaluate('v=>{window.nextFace=v; said.length=0; jarvis.lastSeen=0}', B)
    page.wait_for_function("document.getElementById('faceState').textContent==='Persona desconocida'")
    page.wait_for_timeout(1200); assert page.evaluate('said.length') == 0, 'A stranger is never greeted'
    page.evaluate('()=>{window.nextFace=null}')
    page.evaluate("document.getElementById('say').textContent='Good evening, Crew. How can I help?'")
    page.screenshot(path='/tmp/jarvis-home.png')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')

    # Typed fallback.
    page.click('#openSettings'); page.check('#showType'); page.click('#closeSettings')
    page.fill('#typeInput', 'tell me a joke'); page.press('#typeInput', 'Enter')
    wait_said(page, '^Brain says: tell me a joke$')

    # Persistence and forgetting.
    page.reload(); page.click('#openSettings')
    assert page.locator('#name').input_value() == 'Crew' and page.locator('#voiceKey').input_value() == 'mi-clave-secreta'
    assert page.locator('#lang').input_value() == 'en' and page.locator('#hear').input_value() == 'es-ES'
    assert 'Registrada' in page.locator('#faceInfo').inner_text()
    page.click('#forget'); assert page.evaluate("JSON.parse(localStorage.getItem('jarvis-faces')).length") == 0

    # Old invitation links still reach the hidden camera app, even in an open tab.
    page.goto(URL + '#invite=' + 'a' * 64)
    page.wait_for_url('**/camara.html**')
    assert not errors, errors
    print('PASS Jarvis: real face models without microphone; English ElevenLabs voice via private key; Claude conversation with history and hands-free follow-up; background listening answers only "Jarvis"; local actions skip Claude; Claude errors explained; Safari stalls, silence and refusals recover (tap fallback); bilingual commands; face greeting once, strangers ignored; settings persist; invite links redirect')
    b.close()

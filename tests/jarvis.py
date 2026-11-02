"""Jarvis home page: real face models load in the browser; conversation (Claude),
voice (ElevenLabs) and the speech recognizer are fixtures, including a Safari-like
recognizer that stalls. No real face photo is used."""
import json, pathlib, re
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
if(!localStorage.getItem('jarvis-settings'))localStorage.setItem('jarvis-settings',JSON.stringify({engine:'native',always:true,v:2}));
// Cloud hearing: tests feed utterances through capQueue unless realCapture is set.
window.capQueue=[];
document.addEventListener('DOMContentLoaded',()=>{if(!window.jarvis||window.realCapture)return;
  window.realCaptureFn=jarvis.captureUtterance;
  jarvis.captureUtterance=async()=>{await new Promise(r=>setTimeout(r,80));const t=capQueue.shift();return t==null?null:new Blob([t],{type:'audio/ogg'})};});
"""
FAKE = """(vec)=>{
  window.nextFace=vec;
  jarvis.detector={detect:async()=>window.nextFace?[{embedding:window.nextFace,score:0.95}]:[],
    similarity:(a,b)=>{let d=0,x=0,y=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];x+=a[i]*a[i];y+=b[i]*b[i]}return d/Math.sqrt(x*y)}};
}"""
A = [1, 0, 0, 0]
B = [0, 1, 0, 0]
C = [0, 0, 1, 0]
D = [0, 0, 0, 1]
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

def hear(route):
    req = route.request
    if req.method == 'OPTIONS': return route.fulfill(status=204, headers=CORS)
    kind = req.headers.get('content-type', '')
    text = req.post_data_buffer.decode() if kind == 'audio/ogg' else ('real clip ' + kind if kind.startswith('audio/') and len(req.post_data_buffer) > 200 else '')
    heard.append({'type': kind, 'size': len(req.post_data_buffer), 'key': req.headers.get('x-jarvis-key')})
    route.fulfill(status=200, headers={**CORS, 'Content-Type': 'application/json'}, body=json.dumps({'text': text}))
heard = []

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
    c = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera', 'microphone'])
    page = c.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script(INIT)
    page.route('https://*.supabase.co/functions/v1/jarvis-voice', tts)
    page.route('https://*.supabase.co/functions/v1/jarvis-brain', think)
    page.route('https://*.supabase.co/functions/v1/jarvis-hear', hear)
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

    # Faces: you, Mum and Dad, each with their own greeting (controlled detector).
    page.click('#openSettings'); page.fill('#name', 'Crew'); page.dispatch_event('#name', 'change')
    assert 'no conozco a nadie' in page.locator('#people').inner_text()
    page.evaluate(FAKE, A)
    page.click('.add-person summary')
    page.select_option('#personRole', 'me'); page.click('#addPerson'); assert page.locator('#preview').is_visible()
    page.wait_for_function("jarvis.people.find(p=>p.role==='me')?.samples.length===5", timeout=10000)
    wait_said(page, "recognise you now")
    assert page.evaluate("document.querySelector('#personRole option[value=me]').disabled"), page.evaluate("[document.querySelector('#personRole option[value=me]').disabled, jarvis.people.map(p=>p.role)]")
    page.evaluate('v=>{window.nextFace=v}', B)
    page.select_option('#personRole', 'mom'); page.fill('#personName', 'Mamá'); page.click('#addPerson')
    page.wait_for_function("jarvis.people.find(p=>p.role==='mom')?.samples.length===5", timeout=10000)
    wait_said(page, "Nice to meet you, Mamá")
    page.evaluate('v=>{window.nextFace=v}', C)
    page.select_option('#personRole', 'dad'); page.fill('#personName', 'Papá'); page.fill('#personGreeting', 'Hello Dad, the air conditioning is off, I promise.'); page.click('#addPerson')
    page.wait_for_function("jarvis.people.find(p=>p.role==='dad')?.samples.length===5", timeout=10000)
    assert page.locator('#people').inner_text().count('cara registrada') == 3
    page.screenshot(path='/tmp/jarvis-settings.png', full_page=True)
    page.click('#closeSettings'); calm(page)
    def arrive(vec, pattern, lang):
        page.evaluate('v=>{window.nextFace=v; said.length=0; for (const k in jarvis.seen) jarvis.seen[k]=0}', vec)
        wait_said(page, pattern)
        for _ in range(50):
            if voice and re.search(pattern, voice[-1]['text']): break
            page.wait_for_timeout(100)
        assert re.search(pattern, voice[-1]['text']) and voice[-1]['lang'] == lang, voice[-1]
        calm(page)
    arrive(A, '^Good (morning|afternoon|evening), Crew\\.', 'en')
    n = page.evaluate('said.length'); page.wait_for_timeout(2200)
    assert page.evaluate('said.length') == n, 'No repeated greeting while you stay in the room'
    arrive(B, 'Mum', 'en')
    assert page.locator('#faceState').inner_text() == 'Mamá'
    arrive(C, '^Hello Dad, the air conditioning is off, I promise\\.$', 'en')
    page.evaluate('v=>{window.nextFace=v; said.length=0}', D)
    page.wait_for_function("document.getElementById('faceState').textContent==='Persona desconocida'")
    page.wait_for_timeout(1200); assert page.evaluate('said.length') == 0, 'A stranger is never greeted'
    page.evaluate('()=>{window.nextFace=null}')
    page.evaluate("document.getElementById('say').textContent='Good evening, Crew. How can I help?'")
    page.screenshot(path='/tmp/jarvis-home.png')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')

    # Door framing: zoom 3x and drag the box; the face model then sees only that enlarged part.
    page.click('#openSettings'); page.click('#frameToggle')
    assert page.locator('#frameSlot video').is_visible()
    page.evaluate("()=>{const z=document.getElementById('zoom');z.value='3';z.dispatchEvent(new Event('input'))}")
    assert page.locator('#frameBox').is_visible() and page.locator('#zoomValue').inner_text() == '3.0×'
    box = page.locator('#frameSlot').bounding_box()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2); page.mouse.down()
    page.mouse.move(box['x'] + box['width'] / 2 - 40, box['y'] + box['height'] / 2 + 20, steps=4); page.mouse.up()
    crop = page.evaluate("JSON.parse(localStorage.getItem('jarvis-settings')).crop")
    assert crop['zoom'] == 3 and crop['cx'] > 0.5 and crop['cy'] > 0.5, crop  # mirrored front camera: drag left moves right in the image
    assert 'zona analizada' in page.locator('#frameInfo').inner_text()
    page.screenshot(path='/tmp/jarvis-frame.png')
    page.click('#frameToggle'); page.click('#closeSettings')
    page.evaluate("()=>{window.inputs=[];const d=jarvis.detector;jarvis.detector={...d,detect:(i)=>{inputs.push([i.width||i.videoWidth,i.height||i.videoHeight,i.tagName]);return d.detect(i)}}}")
    page.wait_for_function("inputs.length>=2", timeout=8000)
    w, h, tag = page.evaluate("inputs[inputs.length-1]"); vw, vh = page.evaluate("[document.getElementById('video').videoWidth, document.getElementById('video').videoHeight]")
    assert tag == 'CANVAS' and abs(w - min(1280, vw / 3)) <= 2, (w, h, vw, vh)
    page.click('#openSettings'); page.click('#frameToggle'); page.click('#frameReset'); page.click('#frameToggle'); page.click('#closeSettings')
    page.evaluate("inputs.length=0"); page.wait_for_function("inputs.length>=1", timeout=8000)
    assert page.evaluate("inputs[inputs.length-1][2]") == 'VIDEO'
    calm(page)

    # Hearing by recording + ElevenLabs (works on iPhone with the camera on).
    page.click('#openSettings'); page.select_option('#engine', 'cloud'); page.uncheck('#always'); page.click('#closeSettings')
    page.wait_for_function("!jarvis.listening", timeout=5000)
    page.evaluate("said.length=0; capQueue.push('what is the plan for today', null)")
    page.click('#bubble', force=True)
    wait_said(page, '^Brain says: what is the plan for today$')
    assert heard[-1]['type'] == 'audio/ogg' and heard[-1]['key'] == 'mi-clave-secreta'
    calm(page)
    page.evaluate("said.length=0; capQueue.push(null)"); page.click('#bubble', force=True)
    wait_said(page, "didn't catch that"); calm(page)
    # The real recorder and voice detector on Chromium's fake microphone (a beeping tone).
    page.evaluate("jarvis.listenLimits={silenceMS:400,noSpeechMS:3000,maxMS:4000,followMS:400,wakeMS:1500}; jarvis.captureUtterance=window.realCaptureFn; said.length=0")
    page.click('#bubble', force=True)
    wait_said(page, '^Brain says: real clip audio/', 15000)
    assert heard[-1]['size'] > 200, heard[-1]
    page.wait_for_function("jarvis.micLog.some(l=>l.includes('voz detectada'))")
    calm(page)

    # Typed fallback.
    page.click('#openSettings'); page.check('#showType'); page.click('#closeSettings')
    page.fill('#typeInput', 'tell me a joke'); page.press('#typeInput', 'Enter')
    wait_said(page, '^Brain says: tell me a joke$')

    # Persistence and forgetting.
    page.reload(); page.click('#openSettings')
    assert page.locator('#name').input_value() == 'Crew' and page.locator('#voiceKey').input_value() == 'mi-clave-secreta'
    assert page.locator('#lang').input_value() == 'en' and page.locator('#hear').input_value() == 'es-ES'
    assert page.locator('#people').inner_text().count('cara registrada') == 3 and page.locator('#engine').input_value() == 'cloud'
    page.locator('#people .person', has_text='Papá').get_by_role('button', name='Borrar').click()
    assert page.evaluate("JSON.parse(localStorage.getItem('jarvis-people')).map(p=>p.role)") == ['me', 'mom']

    # A face registered with the previous version is kept as yours.
    old = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
    old.add_init_script("localStorage.setItem('jarvis-faces', JSON.stringify([[1,0,0,0]]))")
    old.add_init_script("if(!sessionStorage.getItem('x')){sessionStorage.setItem('x','1');localStorage.setItem('jarvis-settings',JSON.stringify({always:true,engine:'native',key:'k'}))}")
    old.goto(URL); old.click('#openSettings')
    assert 'cara registrada' in old.locator('#people').inner_text()
    # Settings saved by older versions: background Safari listening (the "ding") is switched off once.
    assert old.evaluate("[jarvis.settings.always, jarvis.settings.engine, JSON.parse(localStorage.getItem('jarvis-settings')).v]") == [False, 'cloud', 2]
    assert not old.locator('#always').is_checked()
    old.click('#closeSettings'); old.click('#openSettings'); old.check('#always'); old.reload()
    assert old.evaluate("jarvis.settings.always") is True, 'Turning it back on later is respected'

    # Old invitation links still reach the hidden camera app, even in an open tab.
    page.goto(URL + '#invite=' + 'a' * 64)
    page.wait_for_url('**/camara.html**')
    assert not errors, errors
    print('PASS Jarvis: family faces (you, Mum, Dad) with their own English greetings, strangers ignored, old face kept; hearing by recording + speech-to-text including the real recorder; real face models without microphone; English ElevenLabs voice via private key; Claude conversation with history and hands-free follow-up; background listening answers only "Jarvis"; local actions skip Claude; Claude errors explained; Safari stalls, silence and refusals recover (tap fallback); bilingual commands; face greeting once, strangers ignored; settings persist; invite links redirect')
    b.close()

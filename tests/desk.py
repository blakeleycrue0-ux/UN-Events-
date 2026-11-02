"""Jarvis desk (Chromebook). External services are fixtures: home channel
(Supabase Realtime), Claude brain, ElevenLabs voice, Open-Meteo, Chrome's
speech recognizer, the hand detector and the Chromebook extension bridge."""
import json, pathlib, re, time
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:8001/'
MP3 = (pathlib.Path(__file__).parent / 'fixtures' / 'tone.mp3').read_bytes()
CORS = {'Access-Control-Allow-Origin': 'http://127.0.0.1:8001', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS'}
INIT = """Object.defineProperty(window,'caches',{value:undefined,configurable:true});

window.said=[];
document.addEventListener('DOMContentLoaded',()=>{const say=document.getElementById('say');if(!say)return;
  new MutationObserver(()=>said.push(say.textContent)).observe(say,{subtree:true,childList:true,characterData:true});});
if(!localStorage.getItem('jarvis-settings'))localStorage.setItem('jarvis-settings',JSON.stringify({key:'mi-clave-secreta',name:'Crew',quietFrom:3,quietTo:3}));
window.recQueue=[];window.recLog=[];
window.webkitSpeechRecognition=class{
  start(){const s=window.recQueue.shift()||{results:[],end:true,endDelay:400};
    recLog.push({lang:this.lang,script:!!s.results.length});let d=40;
    for(const [text,fin] of s.results){setTimeout(()=>this.onresult&&this.onresult({results:Object.assign([[{transcript:text}]],{0:Object.assign([{transcript:text}],{isFinal:fin})})}),d);d+=50}
    if(s.error)setTimeout(()=>this.onerror&&this.onerror({error:s.error}),d);
    if(s.end)setTimeout(()=>this.onend&&this.onend(),d+(s.endDelay||20));}
  stop(){} abort(){}
};
window.SpeechRecognition=window.webkitSpeechRecognition;
// Fake Chromebook extension answering the bridge.
window.extCalls=[];
window.extMsgs=[];
window.addEventListener('message',e=>{if(e.data?.source!=='jarvis-desk')return;extCalls.push(e.data.action);extMsgs.push(e.data);
  window.postMessage({source:'jarvis-extension',id:e.data.id,ok:true},'*')});
// Fake hand detector fed from handQueue.
window.handQueue=[];
document.addEventListener('DOMContentLoaded',()=>{if(window.desk)desk.createHandDetector=async()=>({detect:async()=>{const h=handQueue.shift();return h===undefined||h===null?null:h}})});
"""
voice, brain, sockets = [], [], []
brain_replies = {}

def tts(route):
    req = route.request
    if req.method == 'OPTIONS': return route.fulfill(status=204, headers=CORS)
    voice.append(json.loads(req.post_data))
    route.fulfill(status=200, headers={**CORS, 'Content-Type': 'audio/mpeg'}, body=MP3)

def think(route):
    req = route.request
    if req.method == 'OPTIONS': return route.fulfill(status=204, headers=CORS)
    body = json.loads(req.post_data); brain.append(body)
    last = body['messages'][-1]['content']
    reply = {'reply': 'Brain says: ' + last, 'actions': []}
    for key, value in brain_replies.items():
        if key in last: reply = value
    route.fulfill(status=200, headers={**CORS, 'Content-Type': 'application/json'}, body=json.dumps(reply))

def weather(route):
    route.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'},
                  body=json.dumps({'hourly': {'time': [time.strftime('%Y-%m-%dT%H:00', time.localtime(time.time() + 3600 * h)) for h in range(-1, 8)], 'temperature_2m': [20, 21, 22, 22, 21, 19, 18, 17, 16], 'weather_code': [1, 1, 2, 3, 61, 61, 3, 0, 0]}, 'current': {'temperature_2m': 21.4, 'weather_code': 1}, 'daily': {'temperature_2m_max': [24], 'temperature_2m_min': [15], 'precipitation_probability_max': [10]}}))

def realtime(ws):
    entry = {'ws': ws, 'topic': None}; sockets.append(entry)
    def receive(raw):
        m = json.loads(raw)
        if m['event'] == 'phx_join':
            entry['topic'] = m['topic']
            ws.send(json.dumps({'topic': m['topic'], 'event': 'phx_reply', 'ref': m['ref'], 'payload': {'status': 'ok', 'response': {}}}))
    ws.on_message(receive)

def home(event):
    for s in sockets:
        if s['topic']:
            s['ws'].send(json.dumps({'topic': s['topic'], 'event': 'broadcast', 'ref': None, 'payload': {'event': 'command', 'type': 'broadcast', 'payload': {**event, 'at': int(time.time() * 1000)}}}))

def wait_said(page, pattern, timeout=8000):
    page.wait_for_function('p=>said.some(t=>new RegExp(p).test(t))', arg=pattern, timeout=timeout)

def calm(page):
    page.wait_for_function("!desk.voice.speaking && document.body.dataset.state==='idle' && desk.ears.mode!=='direct' && desk.ears.mode!=='follow'", timeout=12000)
    page.wait_for_timeout(400)

def wait_voice(page, pattern):
    for _ in range(80):
        if voice and re.search(pattern, voice[-1]['text']): return voice[-1]
        page.wait_for_timeout(100)
    raise AssertionError(f'voice never said {pattern!r}: {voice[-3:]}')

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
    c = b.new_context(viewport={'width': 1366, 'height': 768}, permissions=['camera', 'microphone'])
    page = c.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script(INIT)
    page.route('https://*.supabase.co/functions/v1/jarvis-voice', tts)
    page.route('https://*.supabase.co/functions/v1/jarvis-brain', think)
    page.route('https://api.open-meteo.com/**', weather)
    page.route_web_socket('wss://*.supabase.co/**', realtime)

    # First visit: choose what this device is.
    page.goto(URL)
    assert page.locator('#chooser').is_visible()
    page.screenshot(path='/tmp/desk-chooser.png')
    page.click('#asDesk')
    assert page.locator('#wake').is_visible() and page.evaluate("localStorage.getItem('jarvis-role')") == '"desk"'
    page.screenshot(path='/tmp/desk-wake.png')

    # Wake up: greeting spoken, home channel joined, weather loaded, background listening.
    page.click('#wake')
    wait_voice(page, '(?i)online')
    page.wait_for_function("document.getElementById('wxTemp').textContent==='21°'", timeout=8000)
    assert page.locator('#wxHours li').count() == 5 and page.locator('#wxHours li svg').count() == 5
    assert 'Calvià' in page.locator('#wxCity').inner_text()
    page.wait_for_function("recLog.length>=1", timeout=8000)
    for _ in range(50):
        if sockets and sockets[0]['topic']: break
        page.wait_for_timeout(100)
    import hashlib
    assert sockets[0]['topic'] == 'realtime:jarvis-pc-' + hashlib.sha256(b'jarvis-pc:mi-clave-secreta').hexdigest()[:40]
    calm(page)

    # "Jarvis …" in the background goes to Claude with memory and live context; then a follow-up without the name.
    page.evaluate("recQueue.push({results:[['Jarvis what is the meaning of life',false]],end:false},{results:[['and why',true]],end:true})")
    wait_voice(page, '^Brain says: what is the meaning of life$')
    wait_voice(page, '^Brain says: and why$')
    assert [m['role'] for m in brain[-1]['messages']] == ['user', 'assistant', 'user']
    assert 'Calvià: 21°C' in brain[-1]['context'] and brain[-1]['lang'] == 'en' and brain[-1]['memory'] == []
    calm(page)
    n = len(brain)
    page.evaluate("recQueue.push({results:[['so I told my friend',false]],end:false})"); page.wait_for_timeout(3500)
    assert len(brain) == n, 'speech without "Jarvis" is ignored'

    # Space bar: direct question. Claude plays music and remembers things.
    brain_replies['play some lofi'] = {'reply': 'Playing lofi beats on YouTube.', 'actions': ['play']}
    brain_replies['exam'] = {'reply': "Noted, good luck.", 'actions': ['remember'], 'remember': ['Crew has a maths exam on Friday.']}
    page.evaluate("recQueue.push({results:[['play some lofi',true]],end:true})"); page.keyboard.press('Space')
    wait_voice(page, 'Playing lofi')
    page.wait_for_function("document.getElementById('musicNow').textContent.includes('lofi')")
    calm(page)
    page.evaluate("recQueue.push({results:[['I have a maths exam on Friday',true]],end:true})"); page.keyboard.press('Space')
    page.wait_for_function("document.getElementById('memory').textContent.includes('maths exam')", timeout=8000)
    assert page.evaluate("JSON.parse(localStorage.getItem('jarvis-memory'))") == ['Crew has a maths exam on Friday.']
    calm(page)
    page.evaluate("recQueue.push({results:[['what do you know about me',true]],end:true})"); page.keyboard.press('Space')
    wait_voice(page, 'what do you know')
    assert brain[-1]['memory'] == ['Crew has a maths exam on Friday.']
    calm(page)

    # Timers are local and instant.
    page.evaluate("recQueue.push({results:[['set a timer for 2 seconds',true]],end:true})"); page.keyboard.press('Space')
    wait_voice(page, 'Timer set for 2 seconds')
    page.wait_for_function("!document.getElementById('timersCard').hidden")
    wait_voice(page, "time's up")
    calm(page)

    # Browser agent: progress card, a spoken question, the spoken answer goes back to the extension.
    post = lambda m: page.evaluate("m=>window.postMessage({source:'jarvis-extension',agent:m},'*')", m)
    post({'kind': 'start', 'task': 'Check Teams for homework'})
    page.wait_for_function("!document.getElementById('agentCard').hidden && document.getElementById('agentTask').textContent.includes('Teams')")
    post({'kind': 'step', 'step': 2, 'say': 'Opening Teams'})
    page.wait_for_function("document.getElementById('agentSay').textContent==='Opening Teams' && document.getElementById('agentStep').textContent==='step 2'")
    post({'kind': 'ask', 'id': 7, 'question': 'Shall I press Hand in?'})
    wait_voice(page, 'Shall I press Hand in')
    page.evaluate("recQueue.push({results:[['yes go ahead',true]],end:true})")
    page.wait_for_function("extMsgs.some(m=>m.action==='agent-answer'&&m.ask===7&&m.text==='yes go ahead')", timeout=8000)
    calm(page)
    post({'kind': 'done', 'ok': True, 'summary': 'Handed in your maths homework.'})
    wait_voice(page, 'Handed in your maths homework')
    page.wait_for_function("document.getElementById('agentCard').classList.contains('done')")
    page.screenshot(path='/tmp/desk-agent.png')
    calm(page)
    # A reminder that comes due is spoken on the desk.
    home({'action': 'remind', 'text': 'Time to study maths, Crew.', 'lang': 'en'})
    wait_voice(page, 'Time to study maths'); calm(page)

    # The door: the wall camera's events.
    home({'action': 'wall', 'camera': True})
    page.wait_for_function("document.getElementById('wallDot').classList.contains('on')")
    home({'action': 'arrival', 'person': {'name': 'Mamá', 'role': 'mom', 'greeting': ''}})
    v = wait_voice(page, 'Mum'); assert v['lang'] == 'en'
    page.wait_for_function("document.getElementById('arrivals').textContent.includes('Mamá')")
    calm(page)
    home({'action': 'arrival', 'person': {'name': 'Papá', 'role': 'dad', 'greeting': 'Hello Dad, the AC is off.'}})
    wait_voice(page, '^Hello Dad, the AC is off\\.$'); calm(page)
    home({'action': 'unknown', 'count': 1})
    wait_voice(page, "don't recognise"); calm(page)
    # You: a briefing from Claude the first time today, a short welcome back later.
    brain_replies['first time today'] = {'reply': 'Morning, Crew. 21 degrees and sunny. Maths exam on Friday.', 'actions': []}
    home({'action': 'arrival', 'person': {'name': 'Crew', 'role': 'me', 'greeting': ''}})
    wait_voice(page, 'Morning, Crew')
    assert brain[-1]['messages'][-1]['content'].startswith('[Event] Crew just walked into the room') and len(brain[-1]['messages']) == 1
    calm(page)
    home({'action': 'arrival', 'person': {'name': 'Crew', 'role': 'me', 'greeting': ''}})
    n_brain = len(brain)
    wait_voice(page, 'Crew'); calm(page)
    assert len(brain) == n_brain, 'repeat arrivals greet instantly, without Claude'
    assert not any(m['content'].startswith('[Event]') for m in page.evaluate("desk.history")), 'sensor events stay out of the conversation'
    # Night mode: arrivals are logged silently.
    page.evaluate("()=>{const h=new Date().getHours();desk.settings.quietFrom=h;desk.settings.quietTo=(h+1)%24}")
    n = len(voice); home({'action': 'arrival', 'person': {'name': 'Mamá', 'role': 'mom', 'greeting': ''}})
    page.wait_for_function("document.querySelectorAll('#arrivals li.arrival').length===5", timeout=5000); page.wait_for_timeout(1200)
    assert len(voice) == n and page.locator('#quiet').is_visible()
    page.evaluate("()=>{desk.settings.quietFrom=3;desk.settings.quietTo=3}")

    # Hand gestures → Chromebook extension (instant, local).
    page.wait_for_function("desk.handsOn===true", timeout=8000)
    page.evaluate("extCalls.length=0; for(let i=0;i<12;i++) handQueue.push({pose:'palm',x:0.5,y:0.5})")
    page.wait_for_function("extCalls.includes('pause')", timeout=5000)
    page.evaluate("handQueue.length=0"); page.wait_for_timeout(1700)
    page.evaluate("for(const x of [0.2,0.3,0.42,0.55,0.62]) handQueue.push({pose:'palm',x,y:0.5})")
    page.wait_for_function("extCalls.includes('next')", timeout=5000)
    page.wait_for_timeout(1700)
    page.evaluate("for(let i=0;i<10;i++) handQueue.push({pose:'thumbUp',x:0.5,y:0.5})")
    page.wait_for_function("extCalls.includes('louder')", timeout=5000)
    page.wait_for_timeout(1700)
    page.evaluate("recQueue.length=0; recQueue.push({results:[['Jarvis no hace falta',true]],end:true}); for(let i=0;i<10;i++) handQueue.push({pose:'point',x:0.5,y:0.5})")
    page.wait_for_function("desk.gestures.includes('talk')", timeout=5000)
    wait_voice(page, 'no hace falta'); calm(page)
    assert page.evaluate("document.getElementById('extDot').classList.contains('on')")
    page.click('#mNext'); page.wait_for_function("extCalls.filter(x=>x==='next').length>=2")

    page.evaluate("document.getElementById('say').textContent='Good evening, Crew. 21 degrees and clear in Calvià.'")
    page.screenshot(path='/tmp/desk-live.png')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight')
    page.click('#openSettings'); page.wait_for_timeout(400); page.screenshot(path='/tmp/desk-settings.png')
    assert 'maths exam' in page.locator('#memoryList').inner_text()
    page.locator('#memoryList button').first.click()
    assert page.evaluate("JSON.parse(localStorage.getItem('jarvis-memory'))") == []
    page.click('#closeSettings')

    # Reload: role remembered, wake screen straight away.
    page.reload(); assert page.locator('#wake').is_visible() and page.locator('#chooser').is_hidden()
    # Old invitation links still reach the camera app.
    page.goto(URL + '#invite=' + 'a' * 64); page.wait_for_url('**/camara.html**')
    # A device that chose "wall" goes to the wall page.
    page.goto(URL); page.evaluate("localStorage.setItem('jarvis-role','\"wall\"')"); page.goto(URL); page.wait_for_url('**/pared.html')
    assert not errors, errors
    print('PASS Jarvis desk: device chooser; wake greeting; home channel on the key-derived topic; weather; "Jarvis…" background listening with follow-up; Space to talk; music card; long-term memory sent to Claude and editable; local timers; door events (Mum, Dad custom, stranger, your daily briefing then welcome back, silent at night); hand gestures (pause, swipe next, louder, point to talk) through the extension bridge; fits 1366×768')
    b.close()

"""Jarvis wall camera (phone): real face models load; recognition uses a
controlled detector (no real face photo); the wall only reports events and
never speaks or calls the brain."""
import json
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:8001/'
CORS = {'Access-Control-Allow-Origin': 'http://127.0.0.1:8001', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS'}
INIT = """
if(!localStorage.getItem('jarvis-settings'))localStorage.setItem('jarvis-settings',JSON.stringify({key:'mi-clave-secreta',name:'Crew'}));
"""
FAKE = """(vec)=>{
  window.nextFace=vec; window.inputs=[];
  wall.detector={detect:async(i)=>{inputs.push([i.width||i.videoWidth,i.tagName]);return window.nextFace?[{embedding:window.nextFace,score:0.95,box:[0.4,0.3,0.2,0.3]}]:[]},
    similarity:(a,b)=>{let d=0,x=0,y=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];x+=a[i]*a[i];y+=b[i]*b[i]}return d/Math.sqrt(x*y)}};
}"""
A, B, C, D = [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]
events, forbidden = [], []

def event(route):
    req = route.request
    if req.method == 'OPTIONS': return route.fulfill(status=204, headers=CORS)
    body = json.loads(req.post_data); ok = req.headers.get('x-jarvis-key') == 'mi-clave-secreta'
    events.append({**body, 'ok': ok})
    route.fulfill(status=200 if ok else 401, headers={**CORS, 'Content-Type': 'application/json'}, body='{"ok":true}' if ok else '{"error":"Wrong Jarvis key"}')

def never(route):
    forbidden.append(route.request.url); route.fulfill(status=500, headers=CORS, body='{}')

def wait_event(page, kind, n=1, timeout=6000):
    for _ in range(timeout // 100):
        got = [e for e in events if e['kind'] == kind]
        if len(got) >= n: return got[-1]
        page.wait_for_timeout(100)
    raise AssertionError(f'no {kind} event: {events}')

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
    c = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera'])
    page = c.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script(INIT)
    page.route('https://*.supabase.co/functions/v1/jarvis-event', event)
    for name in ['jarvis-voice', 'jarvis-brain', 'jarvis-hear']:
        page.route(f'https://*.supabase.co/functions/v1/{name}', never)

    # The phone picks "Pared" on first visit.
    page.goto(URL); page.click('#asWall'); page.wait_for_url('**/pared.html')
    assert page.evaluate("localStorage.getItem('jarvis-role')") == '"wall"'
    page.screenshot(path='/tmp/pared-start.png')

    # Start: real face models on the live camera; tells the desk it is online.
    page.click('#wallStart')
    page.wait_for_function('wall.started', timeout=90000)
    page.wait_for_function("document.getElementById('wallState').textContent==='Vigilando la puerta'")
    assert wait_event(page, 'status')['camera'] is True
    assert page.evaluate("wall.stream.getAudioTracks().length===0")
    page.wait_for_function("document.getElementById('faceState').textContent==='Sin caras registradas'", timeout=20000)

    # Register you and Mum (tap the black screen to open settings).
    page.click('#wall', position={'x': 50, 'y': 100})
    page.evaluate(FAKE, A)
    page.click('.add-person summary'); page.select_option('#personRole', 'me'); page.click('#addPerson')
    page.wait_for_function("wall.people.find(p=>p.role==='me')?.samples.length===5", timeout=10000)
    page.evaluate('v=>{window.nextFace=v}', B)
    page.select_option('#personRole', 'mom'); page.fill('#personName', 'Mamá'); page.click('#addPerson')
    page.wait_for_function("wall.people.find(p=>p.role==='mom')?.samples.length===5", timeout=10000)
    page.evaluate('v=>{window.nextFace=v}', C)
    page.select_option('#personRole', 'dad'); page.fill('#personName', 'Papá'); page.fill('#personGreeting', 'Hello Dad, the AC is off.'); page.click('#addPerson')
    page.wait_for_function("wall.people.find(p=>p.role==='dad')?.samples.length===5", timeout=10000)
    assert page.locator('#people').inner_text().count('cara registrada') == 3
    # Enrolling no longer blocks the greeting: Dad is welcomed straight away.
    assert wait_event(page, 'arrival')['person']['name'] == 'Papá'
    page.evaluate('()=>{window.nextFace=null}'); page.wait_for_timeout(400); events.clear()
    page.screenshot(path='/tmp/pared-settings.png', full_page=True)

    # Door framing: zoom and drag, saved; the face model sees only the enlarged crop.
    page.click('#frameToggle')
    page.evaluate("()=>{const z=document.getElementById('zoom');z.value='3';z.dispatchEvent(new Event('input'))}")
    page.locator('#frameSlot').scroll_into_view_if_needed()
    box = page.locator('#frameSlot').bounding_box()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2); page.mouse.down()
    page.mouse.move(box['x'] + box['width'] / 2 - 40, box['y'] + box['height'] / 2 + 20, steps=4); page.mouse.up()
    crop = page.evaluate("JSON.parse(localStorage.getItem('jarvis-settings')).crop")
    assert crop['zoom'] == 3 and crop['cx'] > 0.5 and crop['cy'] > 0.5, crop
    page.click('#frameToggle')

    # Link test from settings, then close.
    page.click('#testLink'); page.wait_for_function("document.getElementById('linkInfo').textContent.startsWith('Enviado')")
    assert wait_event(page, 'test')['person'] == {'name': 'Crew', 'role': 'me'}
    page.click('#closeSettings')
    page.wait_for_function("inputs.length>1 && inputs[inputs.length-1][1]==='CANVAS'")
    w, vw = page.evaluate("[inputs[inputs.length-1][0], document.getElementById('video').videoWidth]")
    assert abs(w - min(960, vw / 3)) <= 2, (w, vw)

    # Arrivals → events for the desk; no repeats while someone stays; strangers rate-limited.
    page.evaluate('v=>{window.nextFace=v; for (const k in wall.seen) wall.seen[k]=0}', A)
    assert wait_event(page, 'arrival')['person'] == {'name': 'Crew', 'role': 'me', 'greeting': ''}
    # Live preview pops up with a green, named box around the face.
    page.wait_for_function("document.querySelector('#preview.spot .face-box.known span')?.textContent==='Crew'", timeout=3000)
    page.screenshot(path='/tmp/pared-box.png')
    page.wait_for_timeout(2500); assert len([e for e in events if e['kind'] == 'arrival']) == 1, 'no repeat while you stay'
    page.evaluate('v=>{window.nextFace=v; for (const k in wall.seen) wall.seen[k]=0}', B)
    assert wait_event(page, 'arrival', 2)['person'] == {'name': 'Mamá', 'role': 'mom', 'greeting': ''}
    page.evaluate('v=>{window.nextFace=v; for (const k in wall.seen) wall.seen[k]=0}', C)
    assert wait_event(page, 'arrival', 3)['person']['greeting'] == 'Hello Dad, the AC is off.'
    page.evaluate('v=>{window.nextFace=v; wall.lastUnknown=0}', D)
    assert wait_event(page, 'unknown')['count'] == 1
    page.wait_for_timeout(2500); assert len([e for e in events if e['kind'] == 'unknown']) == 1, 'strangers reported at most every 2 minutes'
    assert 'Papá' in page.locator('#wallSeen').inner_text()
    page.evaluate('()=>{window.nextFace=null}')
    page.screenshot(path='/tmp/pared-live.png')
    assert page.evaluate("document.getElementById('wallFace').style.transform.startsWith('translate')"), 'clock drifts against burn-in'
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')

    # Wrong key is reported on screen.
    page.click('#wall', position={'x': 50, 'y': 100}); page.fill('#voiceKey', 'otra'); page.dispatch_event('#voiceKey', 'change')
    page.click('#testLink'); page.wait_for_function("document.getElementById('linkInfo').textContent.startsWith('No ha llegado')")
    page.click('#closeSettings')
    assert not forbidden, f'the wall must never talk: {forbidden}'

    # A phone that registered a face with the very first version keeps it as yours.
    old = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
    old.add_init_script("localStorage.setItem('jarvis-faces', JSON.stringify([[1,0,0,0]]))")
    old.goto(URL + 'pared.html'); old.click('#wall', position={'x': 50, 'y': 100})
    assert 'cara registrada' in old.locator('#people').inner_text()
    assert not errors, errors
    print('PASS Jarvis wall: phone chooses "Pared"; real face models on camera without microphone; you/Mum/Dad enrolment; door framing crop; arrivals relayed once per visit with custom greetings; strangers rate-limited; online status; link test and wrong-key message; burn-in drift; never calls voice/brain/hearing; first-version face kept')
    b.close()

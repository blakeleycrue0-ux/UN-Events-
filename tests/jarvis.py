"""Jarvis home page: real face models load in the browser; recognition logic is
checked with a controlled detector (no real face photo in the fixtures)."""
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:8001/'
SPOKEN = "window.spoken=[];speechSynthesis.speak=u=>{window.spoken.push(u.text);setTimeout(()=>u.onend&&u.onend(),20)};"
FAKE = """(vec)=>{
  window.nextFace=vec;
  jarvis.detector={detect:async()=>window.nextFace?[{embedding:window.nextFace,score:0.95}]:[],
    similarity:(a,b)=>{let d=0,x=0,y=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];x+=a[i]*a[i];y+=b[i]*b[i]}return d/Math.sqrt(x*y)}};
}"""
A = [1, 0, 0, 0]
B = [0, 1, 0, 0]

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
    c = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera'])
    page = c.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script(SPOKEN)
    page.goto(URL)
    assert page.locator('#orb').get_attribute('data-state') == 'off'
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    # Real models: blazeface + facemesh + faceres load and run on the fake camera.
    page.click('#start')
    page.wait_for_function('jarvis.started', timeout=90000)
    page.wait_for_function("document.getElementById('faceState').textContent.includes('Registra tu cara')", timeout=30000)
    assert page.locator('#talk').is_visible() and page.locator('#start').is_hidden()
    assert any('Iniciando' in s for s in page.evaluate('spoken'))
    assert page.evaluate("jarvis.stream.getAudioTracks().length===0")

    # Commands.
    h = lambda t: page.evaluate('t=>jarvis.handle(t)', t)
    assert h('¿Qué hora es?').startswith('Son las')
    assert h('qué día es hoy').startswith('Hoy es')
    assert 'Todavía no puedo controlar las luces' in h('Jarvis, enciende la luz')
    assert 'la Play' in h('enciende la play')
    assert 'el aire acondicionado' in h('apaga el aire')
    assert 'qué puedes hacer' in h('blablabla')
    assert 'Puedo decirte la hora' in h('qué puedes hacer')
    assert h('buenos días').startswith(('Buenos días', 'Buenas tardes', 'Buenas noches'))
    assert 'te aviso en 1 segundo' in h('pon un temporizador de 1 segundo')
    page.wait_for_function("spoken.some(s=>s.includes('se acabó el tiempo'))", timeout=5000)
    assert 'te aviso en 5 minutos' in h('pon una alarma de cinco minutos')

    # Name, enrolment and recognition with a controlled detector.
    page.click('#openSettings'); page.fill('#name', 'Crew'); page.dispatch_event('#name', 'change')
    page.evaluate(FAKE, A)
    page.click('#enroll')
    page.wait_for_function('jarvis.faces.length===5', timeout=10000)
    page.wait_for_function("spoken.some(s=>s.includes('Ya te reconozco'))")
    assert page.evaluate("JSON.parse(localStorage.getItem('jarvis-faces')).length")==5
    page.click('#closeSettings')
    page.evaluate('spoken.length=0; jarvis.lastSeen=0')
    page.wait_for_function("spoken.some(s=>s.includes(', Crew.'))", timeout=5000)
    assert 'Crew' in page.locator('#faceState').inner_text()
    n = page.evaluate('spoken.length'); page.wait_for_timeout(1600)
    assert page.evaluate('spoken.length') == n, 'No repeated greeting while you stay in the room'
    page.evaluate('v=>{window.nextFace=v; spoken.length=0; jarvis.lastSeen=0}', B)
    page.wait_for_function("document.getElementById('faceState').textContent==='Persona desconocida'")
    page.wait_for_timeout(1000); assert page.evaluate('spoken.length') == 0, 'A stranger is never greeted'
    page.evaluate('()=>{window.nextFace=null}')
    page.wait_for_function("document.getElementById('faceState').textContent==='Nadie a la vista'")

    # Typed fallback answers too.
    page.evaluate("document.getElementById('typeForm').hidden=false")
    page.fill('#typeInput', 'cuéntame un chiste'); page.click('#typeForm button')
    page.wait_for_function("document.getElementById('heard').textContent.includes('chiste')")
    page.screenshot(path='/tmp/jarvis-home.png')

    # Persistence and forgetting.
    page.reload(); page.click('#openSettings')
    assert page.locator('#name').input_value() == 'Crew'
    assert 'registrada' in page.locator('#faceInfo').inner_text()
    page.click('#forget'); assert page.evaluate("JSON.parse(localStorage.getItem('jarvis-faces')).length") == 0

    # Old invitation links still reach the hidden camera app.
    page.goto(URL + '#invite=' + 'a' * 64)
    page.wait_for_url('**/camara.html**')
    assert not errors, errors
    print('PASS Jarvis: real face models load on live camera without microphone; time/date/timers/jokes/device placeholders; local face enrolment, greeting once per arrival, strangers ignored; settings persist; old invite links redirect to /camara')
    b.close()

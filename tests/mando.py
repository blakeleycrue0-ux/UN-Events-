"""Jarvis remote (your phone): arms/disarms guard mode over the private channel,
shows the desk's state and log, and alerts on entry/alarm."""
import json, time
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:8001/'
channel = {'ws': None, 'topic': None, 'sent': []}

def realtime(ws):
    channel['ws'] = ws
    def receive(raw):
        m = json.loads(raw)
        if m['event'] == 'phx_join':
            channel['topic'] = m['topic']
            ws.send(json.dumps({'topic': m['topic'], 'event': 'phx_reply', 'ref': m['ref'], 'payload': {'status': 'ok', 'response': {}}}))
        if m['event'] == 'broadcast':
            channel['sent'].append(m['payload']['payload'])
    ws.on_message(receive)

def desk_says(payload):
    channel['ws'].send(json.dumps({'topic': channel['topic'], 'event': 'broadcast', 'ref': None, 'payload': {'event': 'command', 'type': 'broadcast', 'payload': payload}}))

def wait_sent(page, pred):
    for _ in range(60):
        if any(pred(x) for x in channel['sent']): return
        page.wait_for_timeout(100)
    raise AssertionError(channel['sent'])

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = b.new_context(viewport={'width': 390, 'height': 844}).new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route_web_socket('wss://*.supabase.co/**', realtime)
    watch_calls = []
    def jarvis_call(route):
        body = json.loads(route.request.post_data or '{}')
        watch_calls.append(body)
        out = {'photos': [{'url': 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', 'who': 'Mamá', 'reason': 'alarm', 'at': '2026-11-02T18:00:00Z'}]} if body.get('action') == 'photos' else {'ok': True}
        if body.get('action') == 'feed': out = {'feed': [{'id': 'f1', 'created_at': '2026-11-03T16:00:00Z', 'source': 'teams', 'title': 'Nota de Matemáticas', 'body': 'Un 8,5', 'level': 'call', 'called': True, 'url': ''}]}
        if body.get('action') == 'watch-config': out = {'teams': True, 'school': False, 'instagramOn': True, 'instagram': 'cdcalvia', 'callsPerDay': 6, 'quietFrom': '23:00', 'quietTo': '07:30', 'rules': '', 'callsReady': False, 'geminiReady': True, 'quiet': False, **(body.get('set') or {})}
        if body.get('action') == 'call-test': out = {'called': False, 'reason': 'Twilio not set up'}
        route.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}, body=json.dumps(out))
    page.route('https://*.supabase.co/functions/v1/jarvis-call', jarvis_call)
    # The chooser offers the remote; the phone then remembers it.
    page.goto(URL); page.click('#asRemote'); page.wait_for_url('**/mando*')
    assert page.locator('#setup').is_visible()
    page.fill('#key', 'mi-clave-secreta'); page.click('#saveKey')
    wait_sent(page, lambda x: x.get('action') == 'guard-ask')
    assert page.locator('#leave').is_disabled(), 'no buttons until the desk answers'
    now = int(time.time() * 1000)
    desk_says({'action': 'guard-state', 'on': False, 'armAt': 0, 'alarm': False, 'intruder': '', 'log': [{'at': now, 'text': 'Desactivada · has vuelto'}]})
    page.wait_for_function("document.body.dataset.state==='off'")
    assert 'has vuelto' in page.locator('#log').inner_text()
    page.click('#leave'); wait_sent(page, lambda x: x == {'action': 'guard', 'on': True})
    desk_says({'action': 'guard-state', 'on': True, 'armAt': now + 60000, 'alarm': False, 'intruder': '', 'log': []})
    page.wait_for_function("document.body.dataset.state==='pending'")
    desk_says({'action': 'guard-state', 'on': True, 'armAt': now - 1, 'alarm': False, 'intruder': 'Mamá', 'log': [{'at': now, 'text': 'Ha entrado: Mamá'}], 'alert': 'entry'})
    page.wait_for_function("document.body.dataset.state==='armed' && !document.getElementById('alert').hidden")
    assert 'Mamá' in page.locator('#alert').inner_text() and page.evaluate('mando.alerts') == 1
    desk_says({'action': 'guard-state', 'on': True, 'armAt': now - 1, 'alarm': True, 'intruder': 'Mamá', 'log': [], 'alert': 'alarm'})
    page.wait_for_function("document.body.dataset.state==='alarm'")
    page.screenshot(path='/tmp/mando-alarm.png')
    page.click('#silence'); wait_sent(page, lambda x: x == {'action': 'guard-silence'})
    assert page.locator('#talk').count() == 0, 'no talk button on the remote'
    page.click('#home'); wait_sent(page, lambda x: x == {'action': 'guard', 'on': False})
    # Door photos and "find my phone".
    page.wait_for_function("!document.getElementById('photosBox').hidden && document.querySelectorAll('#photos figure.alarm').length===1")
    assert 'Mamá' in page.locator('#photos').inner_text()
    desk_says({'action': 'ring'}); page.wait_for_function("!document.getElementById('ringing').hidden")
    page.click('#found'); assert page.locator('#ringing').is_hidden()
    # Live feed: what Jarvis is watching, from the database and live from the channel.
    page.wait_for_function("document.querySelectorAll('#feed li.item').length===1")
    assert '📞 Nota de Matemáticas' in page.locator('#feed').inner_text()
    desk_says({'action': 'feed', 'item': {'id': 'f2', 'source': 'instagram', 'title': 'El club ha publicado', 'body': 'Partido el sábado a las 10', 'level': 'notify', 'url': 'https://www.instagram.com/p/ABC/'}})
    page.wait_for_function("document.querySelector('#feed li.item').textContent.includes('El club ha publicado')")
    # Watch settings from the phone.
    page.click('#watchOpen'); page.wait_for_function("document.getElementById('wInstagram').value==='cdcalvia'")
    assert 'Twilio' in page.locator('#watchStatus').inner_text()
    page.fill('#wInstagram', '@cd.calvia'); page.fill('#wRules', 'Llámame si escribe mi madre'); page.click('#wSave')
    page.wait_for_function("document.getElementById('watchStatus').textContent.includes('Guardado')")
    saved = [c for c in watch_calls if c.get('action') == 'watch-config' and c.get('set')][-1]['set']
    assert saved['instagram'] == '@cd.calvia' and saved['rules'] == 'Llámame si escribe mi madre' and saved['school'] is False
    page.click('#wTest'); page.wait_for_function("document.getElementById('watchStatus').textContent.includes('No se pudo llamar')")
    page.click('#wClose')
    # Next visit to the home page goes straight to the remote.
    page.goto(URL); page.wait_for_url('**/mando*')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors, errors
    print('PASS Jarvis remote: chooser link, key setup, asks the desk for state, arm/disarm/silence messages, no talk button, live feed and watch settings, pending/armed/alarm views with log and alert, remembers its role')
    b.close()

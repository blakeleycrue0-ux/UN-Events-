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
    page.click('#home'); wait_sent(page, lambda x: x == {'action': 'guard', 'on': False})
    # Next visit to the home page goes straight to the remote.
    page.goto(URL); page.wait_for_url('**/mando*')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors, errors
    print('PASS Jarvis remote: chooser link, key setup, asks the desk for state, arm/disarm/silence messages, pending/armed/alarm views with log and alert, remembers its role')
    b.close()

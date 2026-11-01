"""Real bundled SDK + mocked HTTP responses; no live Supabase project or WebRTC transport."""
import base64,json,time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
from pin_helpers import unlock_app
UID='11111111-1111-4111-8111-111111111111'
def b64(obj):return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
now=int(time.time());token=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':UID,'aud':'authenticated','role':'authenticated','exp':now+3600,'iat':now,'iss':'https://fixture.supabase.co/auth/v1'})+'.'+b64('test-signature-not-real')
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);c=b.new_context();page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 failures={'deny':True}
 def fake(route):
  request=route.request;path=urlparse(request.url).path
  headers={'X-Supabase-Api-Version':'2024-01-01','Access-Control-Expose-Headers':'X-Supabase-Api-Version','Content-Type':'application/json','Access-Control-Allow-Origin':'http://127.0.0.1:8001','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS,DELETE,PATCH'}
  if request.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
  if path=='/auth/v1/token' and failures['deny']:
   route.fulfill(status=400,headers=headers,body=json.dumps({'code':'invalid_credentials','message':'Invalid login credentials'}));return
  if path=='/auth/v1/token':data={'access_token':token,'refresh_token':'test-refresh-not-real','expires_in':3600,'expires_at':now+3600,'token_type':'bearer','user':{'id':UID,'aud':'authenticated','role':'authenticated','email':'test@example.com','app_metadata':{},'user_metadata':{}}};status=200
  elif path=='/rest/v1/remote_memberships':data={'enabled':True};status=200
  elif path=='/rest/v1/remote_cameras':data=[];status=200
  elif path=='/functions/v1/ice-config':data={'error':'Authenticated TURN relay is not configured'};status=428
  elif path=='/auth/v1/logout':route.fulfill(status=204,headers=headers);return
  else:raise AssertionError('Unexpected mock request '+path)
  route.fulfill(status=status,headers=headers,body=json.dumps(data))
 page.route('https://fixture.supabase.co/**',fake)
 page.goto('http://127.0.0.1:8001/#account');unlock_app(page)
 assert page.evaluate("!window.createSecuritySupabase")
 page.locator('#supabaseSetup').evaluate('d=>d.open=true');page.fill('#supabaseUrl','https://fixture.supabase.co');page.fill('#supabasePublicKey','sb_secret_do-not-use-private-keys');page.click('#supabaseLogin')
 assert 'solo una clave pública' in page.locator('#supabaseStatus').inner_text();assert page.evaluate('!window.createSecuritySupabase')
 page.fill('#supabasePublicKey','sb_publishable_fixture_public_key_only_123456');page.fill('#supabaseEmail','test@example.com');page.fill('#supabasePassword','test-only-password-not-real');page.click('#supabaseLogin');page.wait_for_function("document.getElementById('supabaseStatus').textContent.includes('Email o contraseña incorrectos')");assert not page.evaluate('!!cloudUser')
 failures['deny']=False;page.fill('#supabasePassword','test-only-password-not-real');page.click('#supabaseLogin');page.wait_for_function('!!cloudUser',timeout=15000)
 assert page.locator('#supabasePassword').input_value()==''
 assert page.evaluate("!Object.values(localStorage).some(v=>v.includes('test-only-password-not-real')||v.includes('test-refresh-not-real'))")
 page.wait_for_selector('#landingPage:visible');page.click('#openViewer');page.wait_for_selector('#remotePage:visible');page.click('#connectRemote');page.wait_for_function("document.getElementById('remoteStatus').textContent.includes('TURN')")
 assert page.evaluate('!remoteActive && !remotePeer && !state.stream')
 page.click('#navSettings');page.click('#accountOpen');page.wait_for_selector('#accountPage:visible');page.click('#supabaseLogout');page.wait_for_function('!cloudUser');assert page.locator('#supabaseLoginFields').is_visible()
 assert not errors,errors
 print('PASS actual local SDK loads only on cloud login; rejects private keys; memory-only login; missing TURN blocks remote connection honestly; logout works')
 b.close()

"""Actual bundled Supabase SDK, two isolated browsers, controlled HTTP/Realtime service.
Real getUserMedia/WebRTC negotiation; no claim of working external TURN transport.
SQL authorization is tested independently against PostgreSQL in pairing_rls.test.mjs.
"""
import base64,json,time,uuid
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
from pin_helpers import unlock_app,confirm_action,empty_people_model

VIEWER='11111111-1111-4111-8111-111111111111'
HOST='22222222-2222-4222-8222-222222222222'
links={};events=[];sockets=[];flags={'schema':False,'relay':False}
now=int(time.time())
def b64(obj):return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
def auth(uid):
 token=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':uid,'aud':'authenticated','role':'authenticated','exp':now+3600,'iat':now,'iss':'https://fixture.supabase.co/auth/v1'})+'.'+b64('public-test-signature')
 return {'access_token':token,'refresh_token':'test-only-refresh-'+uid,'expires_in':3600,'expires_at':now+3600,'token_type':'bearer','user':{'id':uid,'aud':'authenticated','role':'authenticated','is_anonymous':True,'app_metadata':{},'user_metadata':{}}}
def setup(page,uid):
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script("window.cameraRequests=0;const old=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=(constraints)=>{window.cameraRequests++;return old(constraints)}")
 def route(r):
  req=r.request;path=urlparse(req.url).path
  headers={'X-Supabase-Api-Version':'2024-01-01','Access-Control-Expose-Headers':'X-Supabase-Api-Version','Content-Type':'application/json','Access-Control-Allow-Origin':'http://127.0.0.1:8001','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}
  if req.method=='OPTIONS':r.fulfill(status=204,headers=headers);return
  data={};code=200
  body=json.loads(req.post_data or '{}')
  if path in ['/auth/v1/signup','/auth/v1/token']:data=auth(uid)
  elif path=='/auth/v1/user':data=auth(uid)['user']
  elif path=='/rest/v1/camera_links':
   if not flags['schema']:code=404;data={'code':'PGRST205','message':'Missing table'}
   else:data=[{k:v for k,v in l.items() if k!='invite_hash'} for l in links.values() if not l['revoked'] and uid in [l['viewer_id'],l['camera_id']]]
  elif path=='/rest/v1/rpc/pair_camera_create':
   linkid=str(uuid.uuid4());links[linkid]={'id':linkid,'viewer_id':uid,'camera_id':None,'name':body['camera_name'],'invite_hash':body['token_hash'],'invite_expires':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(now+600)),'revoked':False,'lease':None,'last_seen':None,'created_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(now))};data=linkid
  elif path=='/rest/v1/rpc/pair_camera_claim':
   found=next((l for l in links.values() if l['invite_hash']==body['token_hash'] and not l['revoked'] and l['camera_id'] is None and l['viewer_id']!=uid),None)
   if not found:code=400;data={'message':'Invitation expired, used, invalid or opened on its originating device'}
   else:found['camera_id']=uid;found['invite_hash']=None;data=found['id']
  elif path=='/rest/v1/rpc/pair_camera_publish':
   l=links[body['link_id']];data=l['camera_id']==uid and not l['revoked']
   if data:l['lease']=body['session_id'] if body['sharing'] else None;l['last_seen']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()) if body['sharing'] else None
  elif path=='/rest/v1/rpc/pair_camera_revoke':
   l=links[body['link_id']];data=uid in [l['camera_id'],l['viewer_id']]
   if data:l['revoked']=True;l['lease']=None;l['invite_hash']=None
  elif path=='/functions/v1/ice-config':
   if flags['relay']:data={'iceServers':[{'urls':['turn:127.0.0.1:3478?transport=udp'],'username':'fixture-only','credential':'fixture-only'}],'expiresAt':int(time.time())+3600}
   else:code=428;data={'error':'Authenticated TURN relay is not configured'}
  else:raise AssertionError('Unexpected HTTP request '+path)
  events.append((uid,path,body));r.fulfill(status=code,headers=headers,body=json.dumps(data))
 page.route('https://*.supabase.co/**',route)
 def websocket(ws):
  entry={'ws':ws,'topic':None};sockets.append(entry)
  def receive(raw):
   if isinstance(raw,bytes):
    assert raw[0]==3
    sizes=raw[1:6];offset=7;parts=[]
    for n in sizes:parts.append(raw[offset:offset+n].decode());offset+=n
    joinref,ref,topic,event,metadata=parts
    payload={'event':event,'payload':json.loads(raw[offset:]),'type':'broadcast'};kind='broadcast'
   else:joinref,ref,topic,kind,payload=json.loads(raw)
   if kind=='phx_join':entry['topic']=topic
   if kind in ['phx_join','phx_leave','heartbeat','broadcast']:
    ws.send(json.dumps([joinref,ref,topic,'phx_reply',{'status':'ok','response':{'postgres_changes':[]} if kind=='phx_join' else {}}]))
   if kind=='broadcast':
    events.append((uid,'signal',payload['payload']['type']))
    for other in sockets:
     if other is not entry and other['topic']==topic:other['ws'].send(json.dumps([None,None,topic,'broadcast',payload]))
  ws.on_message(receive)
 page.route_web_socket('wss://*.supabase.co/**',websocket)
 return errors

with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 viewer=b.new_context(viewport={'width':390,'height':844},permissions=['clipboard-write','clipboard-read']);v=viewer.new_page();ve=setup(v,VIEWER)
 v.goto('http://127.0.0.1:8001/#home');unlock_app(v)
 assert v.evaluate('!window.createSecuritySupabase && cameraRequests===0')
 v.click('#openAdd');v.click('#useOtherPhone');v.wait_for_function("document.getElementById('pairStatus').textContent.includes('Falta instalar')")
 flags['schema']=True;v.click('#refreshPairs');v.wait_for_function('!document.getElementById("createInvite").disabled')
 v.click('#createInvite');confirm_action(v);v.wait_for_selector('#inviteResult:visible')
 invitation=v.locator('#inviteLink').input_value();raw=invitation.split('#invite=')[1];assert len(raw)==64
 assert next(iter(links.values()))['invite_hash']!=raw
 assert v.evaluate('cameraRequests===0 && !state.stream')
 v.click('#copyInvite');assert v.evaluate('navigator.clipboard.readText()')==invitation
 camera=b.new_context(viewport={'width':390,'height':844},permissions=['camera']);h=camera.new_page();he=setup(h,HOST)
 h.goto(invitation);assert raw not in h.url;unlock_app(h);h.wait_for_selector('#acceptInvitePanel:visible')
 assert h.evaluate('cameraRequests===0 && !state.stream')
 h.click('#acceptInvite');confirm_action(h);h.wait_for_function("document.getElementById('pairStatus').textContent.includes('iPhone vinculado')")
 assert next(iter(links.values()))['camera_id']==HOST
 assert h.evaluate('cameraRequests===0 && !state.stream')
 h.get_by_role('button',name='Activar cámara y compartir',exact=True).click();confirm_action(h)
 h.wait_for_function("document.getElementById('pairStatus').textContent.includes('Falta configurar el relay')")
 assert h.evaluate('cameraRequests===0 && !state.stream');assert h.locator('#pairedVideoPanel').is_hidden()
 # Once the relay is configured, actual SDK private-channel subscription and
 # actual browser SDP offer/answer are exercised. The TURN endpoint is a fixture.
 flags['relay']=True;empty_people_model(h)
 h.get_by_role('button',name='Activar cámara y compartir',exact=True).click();confirm_action(h)
 h.wait_for_function("document.getElementById('pairStatus').textContent.includes('Cámara compartida')",timeout=20000)
 assert h.evaluate('cameraRequests===1 && !!state.stream')
 v.click('#refreshPairs');v.wait_for_selector('button:has-text("Ver directo"):enabled')
 v.get_by_role('button',name='Ver directo',exact=True).click();confirm_action(v)
 v.wait_for_function("document.getElementById('pairStatus').textContent.includes('Esperando fotogramas')",timeout=20000)
 for _ in range(100):
  v.wait_for_timeout(100)
  if any(e[1]=='signal' and e[2]=='answer' for e in events):break
 assert any(e[1]=='signal' and e[2]=='offer' for e in events),events
 assert any(e[1]=='signal' and e[2]=='answer' for e in events),events
 assert v.evaluate('cameraRequests===0 && !state.stream')
 assert v.locator('#pairedLive').inner_text()!='LIVE' # Never invent arriving video.
 # Remote control over the same private channel: viewer PIN locally, camera executes.
 v.wait_for_selector('#remoteControls:visible')
 v.wait_for_function("document.getElementById('remoteState').textContent.includes('DESARMADA')",timeout=10000)
 assert h.locator('#remoteControls').is_hidden()
 v.select_option('#remoteMode','silent');v.click('#remoteArm');confirm_action(v)
 h.wait_for_function('state.armed && document.getElementById("mode").value==="silent"',timeout=20000)
 v.wait_for_function("document.getElementById('remoteState').textContent.includes('ARMADA · Silenciosa')",timeout=10000)
 v.wait_for_function("document.getElementById('pairStatus').textContent.includes('Armado en modo Silenciosa')")
 v.select_option('#remoteMode','deter');v.click('#remoteArm');confirm_action(v)
 h.wait_for_function('state.armed && document.getElementById("mode").value==="deter"',timeout=10000)
 h.evaluate('state.alarm=true');v.wait_for_function("document.getElementById('remoteState').textContent.includes('ALARMA SONANDO')",timeout=10000)
 v.click('#remoteSilence');h.wait_for_function('!state.alarm && state.armed',timeout=10000)
 v.wait_for_function("document.getElementById('pairStatus').textContent.includes('silenciado')")
 v.click('#remoteDisarm');confirm_action(v);h.wait_for_function('!state.armed',timeout=10000)
 v.wait_for_function("document.getElementById('remoteState').textContent.includes('DESARMADA')",timeout=10000)
 assert any(e[1]=='signal' and e[2]=='command' for e in events) and any(e[1]=='signal' and e[2]=='result' for e in events)
 assert v.evaluate('!state.armed && cameraRequests===0')
 v.screenshot(path='/tmp/security-camera-invitation.png',full_page=True)
 h.click('#unlock');h.wait_for_selector('#pinEntry:visible')
 v.wait_for_timeout(200);assert next(iter(links.values()))['lease'] is None
 assert h.locator('#pairedVideoPanel').is_hidden()
 unlock_app(h)
 # Reloaded device keeps its installation identity; accepting a used link fails.
 h.goto(invitation);h.reload();unlock_app(h);h.wait_for_selector('#acceptInvitePanel:visible')
 h.click('#acceptInvite');confirm_action(h);h.wait_for_function("document.getElementById('pairStatus').textContent.includes('ya se usó')")
 v.get_by_role('button',name='Desvincular',exact=True).click();confirm_action(v)
 v.wait_for_function("document.getElementById('pairStatus').textContent.includes('Vínculo revocado')")
 assert next(iter(links.values()))['revoked']
 assert not ve and not he,(ve,he)
 assert all(raw not in json.dumps(e) for e in events),'Raw invitation must never be sent to Supabase'
 assert v.evaluate('document.documentElement.scrollWidth<=innerWidth')
 print('PASS actual SDK + isolated installations: PIN invitation, hash-only requests, explicit acceptance, persistent device identity, missing schema/TURN errors, camera-only capture, private channel and real SDP negotiation, no fake LIVE, lock disconnects, replay fails, revoke works. External media transport is not validated.')
 b.close()

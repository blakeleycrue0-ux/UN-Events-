import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {transform} from 'esbuild';
const source=await fs.readFile(new URL('../supabase/functions/jarvis-call/index.ts',import.meta.url),'utf8');
const {code}=await transform(source,{loader:'ts',target:'es2022'});
const BASE='https://fixture.supabase.co/functions/v1/jarvis-call';
const ENV={APP_ORIGINS:'https://app.example.com',JARVIS_KEY:'clave-larga-de-prueba',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service'};
function setup({env={},due=[]}={}){
 const out=[];
 const fetch=async(url,opts={})=>{url=String(url);out.push({url,opts,body:opts.body});
  if(url.includes('/rest/v1/rpc/jarvis_cron_check'))return Response.json(JSON.parse(opts.body).token==='cron-secret-1234567890');
  if(url.includes('/rest/v1/jarvis_state')&&opts.method!=='PATCH')return Response.json([{name:'Crew',memory:['Maths exam Friday'],guard_pin:'1234'}]);
  if(url.includes('/rest/v1/jarvis_reminders?done=eq.false&order='))return Response.json([{id:'0b6f2c1e-1111-4222-8333-944455556666',due_at:'2026-11-03T07:00:00Z',text:'Exam',via:'chromebook'}]);
  if(url.includes('/rest/v1/jarvis_reminders?done=eq.false'))return Response.json(due);
  if(url.includes('/rest/v1/jarvis_reminders?id='))return Response.json([{id:1}]);
  if(url.includes('api.resend.com'))return Response.json({id:'e1'});
  return Response.json({});};
 let handler;const e={...ENV,...env};
 new Function('Deno','fetch',code)({env:{get:n=>e[n]},serve:h=>handler=h},fetch);
 return {handler,out};
}
const desk=(body,{key='clave-larga-de-prueba',origin='https://app.example.com'}={})=>new Request(BASE,{method:'POST',headers:{origin,'x-jarvis-key':key,'content-type':'application/json'},body:JSON.stringify(body)});
const cron=(token)=>new Request(BASE+'?step=cron',{method:'POST',headers:{'x-jarvis-cron':token}});

test('a new desk gets its memory back with the Jarvis key, from the app only',async()=>{
 assert.deepEqual(await (await setup().handler(desk({action:'state'}))).json(),{name:'Crew',memory:['Maths exam Friday'],guardPin:'1234'});
 assert.equal((await setup().handler(desk({action:'state'},{key:'nope'}))).status,401);
 assert.equal((await setup().handler(desk({action:'state'},{origin:'https://evil.com'}))).status,403);
 assert.equal((await setup().handler(new Request(BASE,{method:'POST',headers:{'x-jarvis-key':'clave-larga-de-prueba'},body:'{"action":"state"}'}))).status,403);
 assert.equal((await setup().handler(desk({action:'call'}))).status,400);
});
test('cron needs the Vault secret; due reminders are spoken on the desk or emailed, each once',async()=>{
 assert.equal((await setup().handler(cron('wrong-secret-xxxxxxxx'))).status,403);
 assert.equal((await setup().handler(cron('short'))).status,403);
 const s=setup({due:[{id:1,text:'Study maths, Crew.',via:'chromebook',lang:'en'},{id:2,text:'Old phone reminder',via:'call',lang:'es'}]});
 assert.deepEqual(await (await s.handler(cron('cron-secret-1234567890'))).json(),{delivered:['desk','desk']});
 const b=s.out.filter(o=>o.url.endsWith('/realtime/v1/api/broadcast')).map(o=>JSON.parse(o.body).messages[0].payload);
 assert.deepEqual(b.map(p=>[p.action,p.text,p.lang]),[['remind','Study maths, Crew.','en'],['remind','Old phone reminder','es']]);
 const claim=s.out.find(o=>o.url.includes('jarvis_reminders?id=eq.1&done=eq.false'));assert.equal(claim.opts.method,'PATCH');
 const mail=setup({env:{RESEND_API_KEY:'re_x',JARVIS_EMAIL_TO:'me@example.com'},due:[{id:3,text:'Bins',via:'email',lang:'en'}]});
 assert.deepEqual(await (await mail.handler(cron('cron-secret-1234567890'))).json(),{delivered:['email']});
 const nomail=setup({due:[{id:3,text:'Bins',via:'email',lang:'en'}]});
 assert.deepEqual(await (await nomail.handler(cron('cron-secret-1234567890'))).json(),{delivered:['desk']},'no email set up: said on the desk');
});

test('the desk lists the reminders really saved, and can delete one',async()=>{
 const s=setup();
 assert.deepEqual(await (await s.handler(desk({action:'reminders'}))).json(),{reminders:[{id:'0b6f2c1e-1111-4222-8333-944455556666',due_at:'2026-11-03T07:00:00Z',text:'Exam',via:'chromebook'}]});
 assert.equal((await s.handler(desk({action:'reminders'},{key:'nope'}))).status,401);
 const f=await s.handler(desk({action:'forget',id:'0b6f2c1e-1111-4222-8333-944455556666'}));assert.equal(f.status,200);
 const del=s.out.find(o=>o.opts.method==='DELETE');assert.match(del.url,/jarvis_reminders\?id=eq\.0b6f2c1e-1111-4222-8333-944455556666&done=eq\.false$/);
 assert.equal((await setup().handler(desk({action:'forget',id:'x;drop'}))).status,400);
});

test('the guard code is saved privately in the database, 4 digits only',async()=>{
 const s=setup();assert.equal((await s.handler(desk({action:'pin',pin:'2803'}))).status,200);
 const p=s.out.find(o=>o.opts.method==='PATCH'&&o.url.includes('jarvis_state'));assert.deepEqual(JSON.parse(p.body),{guard_pin:'2803'});
 assert.equal((await setup().handler(desk({action:'pin',pin:'12a4'}))).status,400);
 assert.equal((await setup().handler(desk({action:'pin',pin:'2803'},{key:'nope'}))).status,401);
});

// ---------- Web Push ----------
const {subtle}=globalThis.crypto;
const pushCode=code+';return {encryptPush};';
function pushSetup({subs=[],vapid=null,status=201}={}){
 const out=[];
 const fetch=async(url,opts={})=>{url=String(url);out.push({url,opts});
  if(url.includes('/rest/v1/rpc/jarvis_vapid'))return Response.json(vapid);
  if(url.includes('/rest/v1/jarvis_push?select'))return Response.json(subs);
  if(url.includes('/rest/v1/'))return Response.json([]);
  return new Response('',{status});};
 let handler;const e={...ENV};
 const api=new Function('Deno','fetch',pushCode)({env:{get:n=>e[n]},serve:h=>handler=h},fetch);
 return {handler,out,api};
}
const b64u=(b)=>Buffer.from(b).toString('base64url');
async function hk(salt,ikm,info,n){const k=await subtle.importKey('raw',ikm,'HKDF',false,['deriveBits']);return new Uint8Array(await subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},k,n*8))}
test('push payloads are aes128gcm-encrypted so only the phone can read them (RFC 8291 round trip)',async()=>{
 const ua=await subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const uaPub=new Uint8Array(await subtle.exportKey('raw',ua.publicKey)),auth=crypto.getRandomValues(new Uint8Array(16));
 const {api}=pushSetup();
 const body=await api.encryptPush(new TextEncoder().encode('{"title":"Alarma"}'),uaPub,auth);
 const salt=body.slice(0,16),rs=new DataView(body.buffer,body.byteOffset).getUint32(16),idlen=body[20],asPub=body.slice(21,21+idlen),ct=body.slice(21+idlen);
 assert.equal(rs,4096);assert.equal(idlen,65);
 const as=await subtle.importKey('raw',asPub,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const shared=new Uint8Array(await subtle.deriveBits({name:'ECDH',public:as},ua.privateKey,256));
 const te=new TextEncoder(),cat=(...a)=>Buffer.concat(a.map(x=>Buffer.from(x)));
 const ikm=await hk(auth,shared,cat(te.encode('WebPush: info\0'),uaPub,asPub),32);
 const cek=await hk(salt,ikm,te.encode('Content-Encoding: aes128gcm\0'),16),nonce=await hk(salt,ikm,te.encode('Content-Encoding: nonce\0'),12);
 const plain=new Uint8Array(await subtle.decrypt({name:'AES-GCM',iv:nonce},await subtle.importKey('raw',cek,'AES-GCM',false,['decrypt']),ct));
 assert.equal(plain.at(-1),2,'last-record delimiter');assert.equal(new TextDecoder().decode(plain.slice(0,-1)),'{"title":"Alarma"}');
});
test('notify signs with VAPID, sends to each phone and forgets dead ones; subscriptions are validated',async()=>{
 const pair=await subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const jwk=await subtle.exportKey('jwk',pair.privateKey);
 const ua=await subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const p256dh=b64u(new Uint8Array(await subtle.exportKey('raw',ua.publicKey))),auth=b64u(crypto.getRandomValues(new Uint8Array(16)));
 const subs=[{endpoint:'https://web.push.apple.com/abc',p256dh,auth},{endpoint:'https://web.push.apple.com/dead',p256dh,auth}];
 const s=pushSetup({subs,vapid:{kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y,d:jwk.d}});
 const r=await s.handler(desk({action:'notify',title:'¡Alarma!',body:'Mamá no ha puesto el código'}));
 assert.equal(r.status,200);
 const sent=s.out.filter(o=>o.url.startsWith('https://web.push.apple.com/'));assert.equal(sent.length,2);
 const h=sent[0].opts.headers;assert.equal(h['Content-Encoding'],'aes128gcm');assert.equal(h.Urgency,'high');
 const [,tok,k]=/^vapid t=([^,]+), k=(.+)$/.exec(h.Authorization);const [hd,pl,sig]=tok.split('.');
 assert.equal(JSON.parse(Buffer.from(pl,'base64url')).aud,'https://web.push.apple.com');
 assert.ok(await subtle.verify({name:'ECDSA',hash:'SHA-256'},pair.publicKey,Buffer.from(sig,'base64url'),new TextEncoder().encode(hd+'.'+pl)),'valid ES256 signature');
 assert.equal(Buffer.from(k,'base64url').length,65);
 // A 410 from the push service removes that phone.
 const dead=pushSetup({subs:[subs[1]],vapid:{kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y,d:jwk.d}},);
 const d2=pushSetup({subs:[subs[1]],vapid:{kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y,d:jwk.d},status:410});
 await d2.handler(desk({action:'notify',title:'x'}));assert.ok(d2.out.some(o=>o.opts.method==='DELETE'&&o.url.includes('jarvis_push?endpoint=eq.')));
 void dead;
 // Subscribing: only well-formed push subscriptions are stored.
 const ok=await s.handler(desk({action:'subscribe',subscription:{endpoint:'https://web.push.apple.com/xyz123',keys:{p256dh,auth}}}));assert.equal(ok.status,200);
 assert.equal((await s.handler(desk({action:'subscribe',subscription:{endpoint:'http://evil',keys:{p256dh,auth}}}))).status,400);
 assert.equal((await s.handler(desk({action:'notify',title:'x'},{key:'nope'}))).status,401);
});

test('door photos: JPEG saved in the private bucket, listed with short-lived links, phone notified',async()=>{
 const out=[];
 const fetch=async(url,opts={})=>{url=String(url);out.push({url,opts});
  if(url.includes('/storage/v1/object/sign/'))return Response.json({signedURL:'/object/sign/jarvis-photos/a.jpg?token=t'});
  if(url.includes('/storage/v1/object/'))return Response.json({Key:'ok'});
  if(url.includes('/rest/v1/jarvis_photos?order='))return Response.json([{path:'2026-11-02/a.jpg',who:'Mamá',reason:'alarm',created_at:'2026-11-02T18:00:00Z'}]);
  if(url.includes('/rest/v1/jarvis_photos?created_at=lt'))return Response.json([{id:'x1',path:'2026-10-20/old.jpg'}]);
  if(url.includes('/rest/v1/rpc/jarvis_vapid'))return Response.json(null);
  return Response.json([]);};
 let handler;const e={...ENV};
 new Function('Deno','fetch',code)({env:{get:n=>e[n]},serve:h=>handler=h},fetch);
 const img='data:image/jpeg;base64,'+Buffer.alloc(3000,7).toString('base64');
 const r=await handler(desk({action:'photo',img,who:'Mamá',reason:'alarm'}));assert.equal(r.status,200);
 const up=out.find(o=>o.opts.method==='POST'&&/storage\/v1\/object\/jarvis-photos\//.test(o.url));
 assert.ok(up&&up.opts.headers['Content-Type']==='image/jpeg'&&up.opts.body.length===3000);
 assert.ok(out.some(o=>o.opts.method==='DELETE'&&o.url.endsWith('/storage/v1/object/jarvis-photos/2026-10-20/old.jpg')),'week-old photos removed');
 assert.equal((await handler(desk({action:'photo',img:'data:image/png;base64,AAAA'}))).status,400);
 const list=await (await handler(desk({action:'photos'}))).json();
 assert.deepEqual(list.photos,[{url:'https://fixture.supabase.co/storage/v1/object/sign/jarvis-photos/a.jpg?token=t',who:'Mamá',reason:'alarm',at:'2026-11-02T18:00:00Z'}]);
 assert.equal((await handler(desk({action:'photos'},{key:'nope'}))).status,401);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import {transform} from 'esbuild';
const source=await fs.readFile(new URL('../supabase/functions/jarvis-call/index.ts',import.meta.url),'utf8');
const stripped=source.replace('import Anthropic from "npm:@anthropic-ai/sdk";','');
assert.notEqual(stripped,source);
const {code}=await transform(stripped,{loader:'ts',target:'es2022'});
const BASE='https://fixture.supabase.co/functions/v1/jarvis-call';
const ENV={APP_ORIGINS:'https://app.example.com',JARVIS_KEY:'clave-larga-de-prueba',ANTHROPIC_API_KEY:'sk-ant',ELEVENLABS_API_KEY:'xi',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service',
 TWILIO_ACCOUNT_SID:'AC123',TWILIO_AUTH_TOKEN:'twilio-token',TWILIO_FROM:'+34900000000',JARVIS_PHONE_TO:'+34600000000'};
function setup({env={},reply=()=>({stop_reason:'end_turn',content:[{type:'text',text:'Of course, Crew.'}]}),db={}}={}){
 const out=[],claude=[];
 class APIError extends Error{}
 class Anthropic{constructor(){this.beta={messages:{create:async(p)=>{claude.push(p);return reply(p)}}}}}
 Anthropic.APIError=APIError;
 const fetch=async(url,opts={})=>{url=String(url);out.push({url,opts,body:opts.body});
  if(url.includes('/rest/v1/rpc/jarvis_cron_check'))return Response.json(JSON.parse(opts.body).token==='cron-secret-1234567890');
  if(url.includes('/rest/v1/jarvis_state'))return Response.json([{name:'Crew',lang:'en',hear:'es-ES',memory:['Maths exam Friday']}]);
  if(url.includes('/rest/v1/jarvis_reminders?done=eq.false'))return Response.json(db.due||[]);
  if(url.includes('/rest/v1/jarvis_reminders?id='))return Response.json([{id:1}]);
  if(url.includes('/rest/v1/jarvis_calls?sid=eq.')&&opts.method!=='PATCH')return Response.json(db.call?[db.call]:[]);
  if(url.includes('/rest/v1/'))return Response.json([]);
  if(url.includes('api.twilio.com')&&url.endsWith('Calls.json'))return Response.json({sid:'CA1'},{status:201});
  if(url.includes('api.elevenlabs.io'))return new Response('mp3',{headers:{'Content-Type':'audio/mpeg'}});
  return Response.json({});};
 let handler;const e={...ENV,...env};
 new Function('Deno','Anthropic','fetch',code)({env:{get:n=>e[n]},serve:h=>handler=h},Anthropic,fetch);
 return {handler,out,claude};
}
const sign=(url,params)=>createHmac('sha1','twilio-token').update(url+Object.keys(params).sort().map(k=>k+params[k]).join('')).digest('base64');
const twilio=(search,params,good=true)=>new Request('http://internal:8000/jarvis-call'+search,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':good?sign(BASE+search,params):'bad'},body:new URLSearchParams(params)});
const desk=(body,{key='clave-larga-de-prueba',origin='https://app.example.com'}={})=>new Request(BASE,{method:'POST',headers:{origin,'x-jarvis-key':key,'content-type':'application/json'},body:JSON.stringify(body)});

test('ringing the phone needs the Jarvis key and Twilio secrets; the call opens with a signed voice line',async()=>{
 assert.equal((await setup().handler(desk({action:'call'},{key:'x'}))).status,401);
 assert.equal((await setup().handler(desk({action:'call'},{origin:'https://evil.com'}))).status,403);
 assert.equal((await setup({env:{TWILIO_AUTH_TOKEN:''}}).handler(desk({action:'call'}))).status,428);
 const s=setup();const r=await s.handler(desk({action:'call',message:'Wake up, Crew.'}));
 assert.deepEqual(await r.json(),{ok:true,sid:'CA1'});
 const t=s.out.find(o=>o.url.endsWith('/Calls.json'));
 assert.equal(t.url,'https://api.twilio.com/2010-04-01/Accounts/AC123/Calls.json');
 assert.equal(t.opts.headers.Authorization,'Basic '+Buffer.from('AC123:twilio-token').toString('base64'));
 const form=new URLSearchParams(t.body.toString());assert.equal(form.get('To'),'+34600000000');assert.equal(form.get('From'),'+34900000000');
 assert.ok(form.get('Url').startsWith(BASE+'?step=answer&t='));
 // Server-to-server (the brain) has no Origin and still works with the key.
 const brain=new Request(BASE,{method:'POST',headers:{'x-jarvis-key':'clave-larga-de-prueba'},body:'{}'});
 assert.equal((await setup().handler(brain)).status,200);
});
test('Twilio webhooks must be signed; a turn asks Claude and speaks back in Jarvis\'s voice',async()=>{
 const p={CallSid:'CA1',SpeechResult:'recuérdame estudiar mañana',From:'+34600000000'};
 assert.equal((await setup().handler(twilio('?step=turn',p,false))).status,403);
 const s=setup({db:{call:{turns:[{role:'assistant',content:'Hello Crew'}],misses:0}}});
 const r=await s.handler(twilio('?step=turn',p));const xml=await r.text();
 assert.equal(r.headers.get('content-type'),'text/xml');
 assert.match(xml,/<Play>https:\/\/fixture\.supabase\.co\/functions\/v1\/jarvis-call\?step=voice&amp;t=/);
 assert.match(xml,/<Gather input="speech" language="es-ES"/);
 const msgs=s.claude[0].messages;assert.equal(msgs[0].role,'user');assert.equal(msgs.at(-1).content,'recuérdame estudiar mañana');
 assert.match(s.claude[0].system,/Maths exam Friday/);
 // The voice link Twilio fetches works, and a tampered one doesn't.
 const link=xml.match(/<Play>([^<]+)<\/Play>/)[1].replace(/&amp;/g,'&');
 const audio=await s.handler(new Request(link));assert.equal(audio.status,200);assert.equal(audio.headers.get('content-type'),'audio/mpeg');
 const el=s.out.find(o=>o.url.includes('elevenlabs'));assert.equal(JSON.parse(el.opts.body).text,'Of course, Crew.');
 assert.equal((await s.handler(new Request(link.replace(/t=./,'t=X')))).status,403);
});
test('end_call hangs up; silence twice says goodbye; strangers calling in are rejected',async()=>{
 const bye=setup({reply:()=>({stop_reason:'tool_use',content:[{type:'tool_use',name:'end_call',input:{goodbye:'Bye, Crew.'}}]}),db:{call:{turns:[],misses:0}}});
 assert.match(await (await bye.handler(twilio('?step=turn',{CallSid:'CA1',SpeechResult:'adiós'}))).text(),/<Hangup\/>/);
 const quiet=setup({db:{call:{turns:[],misses:1}}});
 assert.match(await (await quiet.handler(twilio('?step=turn',{CallSid:'CA1',SpeechResult:''}))).text(),/<Hangup\/>/);
 assert.equal(quiet.claude.length,0);
 assert.match(await (await setup().handler(twilio('?step=inbound',{CallSid:'CA2',From:'+34111111111'}))).text(),/<Reject\/>/);
 assert.match(await (await setup().handler(twilio('?step=inbound',{CallSid:'CA2',From:'+34600000000'}))).text(),/<Gather/);
});
test('cron needs the Vault secret and delivers due reminders by call or on the Chromebook',async()=>{
 const cron=(token)=>new Request(BASE+'?step=cron',{method:'POST',headers:{'x-jarvis-cron':token}});
 assert.equal((await setup().handler(cron('wrong-secret-xxxxxxxx'))).status,403);
 const s=setup({db:{due:[{id:1,text:'Study maths, Crew.',via:'call',lang:'en'},{id:2,text:'Take the bins out.',via:'chromebook',lang:'en'}]}});
 assert.deepEqual(await (await s.handler(cron('cron-secret-1234567890'))).json(),{delivered:['call','chromebook']});
 assert.ok(s.out.some(o=>o.url.endsWith('/Calls.json')));
 const b=s.out.find(o=>o.url.endsWith('/realtime/v1/api/broadcast'));assert.equal(JSON.parse(b.body).messages[0].payload.text,'Take the bins out.');
 // Without Twilio, a call reminder is spoken on the Chromebook instead.
 const n=setup({env:{TWILIO_ACCOUNT_SID:''},db:{due:[{id:1,text:'Study',via:'call',lang:'en'}]}});
 assert.deepEqual(await (await n.handler(cron('cron-secret-1234567890'))).json(),{delivered:['chromebook']});
});

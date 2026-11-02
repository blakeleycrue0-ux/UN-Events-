import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {transform} from 'esbuild';
const source=await fs.readFile(new URL('../supabase/functions/jarvis-call/index.ts',import.meta.url),'utf8');
assert.ok(!/twilio/i.test(source.replace(/once handled phone calls/,'')),'no phone calls any more');
const {code}=await transform(source,{loader:'ts',target:'es2022'});
const BASE='https://fixture.supabase.co/functions/v1/jarvis-call';
const ENV={APP_ORIGINS:'https://app.example.com',JARVIS_KEY:'clave-larga-de-prueba',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service'};
function setup({env={},due=[]}={}){
 const out=[];
 const fetch=async(url,opts={})=>{url=String(url);out.push({url,opts,body:opts.body});
  if(url.includes('/rest/v1/rpc/jarvis_cron_check'))return Response.json(JSON.parse(opts.body).token==='cron-secret-1234567890');
  if(url.includes('/rest/v1/jarvis_state'))return Response.json([{name:'Crew',memory:['Maths exam Friday']}]);
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
 assert.deepEqual(await (await setup().handler(desk({action:'state'}))).json(),{name:'Crew',memory:['Maths exam Friday']});
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

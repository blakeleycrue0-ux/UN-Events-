import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {transform} from 'esbuild';
const source=await fs.readFile(new URL('../supabase/functions/jarvis-event/index.ts',import.meta.url),'utf8');
const {code}=await transform(source,{loader:'ts',target:'es2022'});
function setup(env={},status=200){
 let handler;const out=[];
 const e={APP_ORIGINS:'https://app.example.com',JARVIS_KEY:'clave-larga-de-prueba',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-fixture',...env};
 const fetch=async(url,opts)=>{out.push({url,opts,body:JSON.parse(opts.body)});return new Response('{}',{status})};
 new Function('Deno','fetch',code)({env:{get:n=>e[n]},serve:h=>handler=h},fetch);
 return {handler,out};
}
const req=(body,{origin='https://app.example.com',key='clave-larga-de-prueba'}={})=>new Request('https://fixture.supabase.co/functions/v1/jarvis-event',{method:'POST',headers:{origin,'x-jarvis-key':key,'content-type':'application/json'},body:JSON.stringify(body)});
const topic='jarvis-pc-'+createHash('sha256').update('jarvis-pc:clave-larga-de-prueba').digest('hex').slice(0,40);
test('wall events need the origin and the Jarvis key, and only known kinds pass',async()=>{
 const s=setup();
 assert.equal((await s.handler(req({kind:'arrival',person:{name:'Mamá',role:'mom'}},{origin:'https://evil.example.com'}))).status,403);
 assert.equal((await s.handler(req({kind:'arrival',person:{name:'Mamá',role:'mom'}},{key:'nope'}))).status,401);
 assert.equal((await s.handler(req({kind:'open',site:'evil'}))).status,400);
 assert.equal((await s.handler(req({kind:'arrival',person:{}}))).status,400);
 assert.equal(s.out.length,0);
});
test('arrivals are relayed to the home channel, sanitised',async()=>{
 const s=setup();
 assert.equal((await s.handler(req({kind:'arrival',person:{name:'Mamá\u0007',role:'boss',greeting:'Hi Mum'},action:'open',site:'x'}))).status,200);
 const m=s.out[0];assert.equal(m.url,'https://fixture.supabase.co/realtime/v1/api/broadcast');assert.equal(m.opts.headers.apikey,'service-fixture');
 const msg=m.body.messages[0];assert.equal(msg.topic,topic);assert.equal(msg.event,'command');
 assert.deepEqual({...msg.payload,at:0},{action:'arrival',person:{name:'Mamá',role:'other',greeting:'Hi Mum'},at:0});
 await s.handler(req({kind:'unknown',count:99}));assert.equal(s.out[1].body.messages[0].payload.count,5);
 await s.handler(req({kind:'status',camera:true}));assert.equal(s.out[2].body.messages[0].payload.action,'wall');
 assert.equal((await setup({},500).handler(req({kind:'status',camera:true}))).status,502);
});

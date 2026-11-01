import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {transform} from 'esbuild';
const source=await fs.readFile(new URL('../supabase/functions/jarvis-voice/index.ts',import.meta.url),'utf8');
const {code}=await transform(source,{loader:'ts',target:'es2022'});
function setup(extra={},status=200){
 let handler;const env={APP_ORIGINS:'https://app.example.com/ ',JARVIS_KEY:'clave-larga-de-prueba',ELEVENLABS_API_KEY:'private-elevenlabs-fixture',...extra};
 const calls=[];
 const fetch=async(url,opts)=>{calls.push({url,opts});return new Response(status===200?new Uint8Array([73,68,51]):'{}',{status,headers:{'Content-Type':status===200?'audio/mpeg':'application/json'}})};
 new Function('Deno','fetch',code)({env:{get:n=>env[n]},serve:h=>handler=h},fetch);
 return {handler,calls};
}
const req=({origin='https://app.example.com',key='clave-larga-de-prueba',text='Hola, Crew.',method='POST'}={})=>new Request('https://fixture.supabase.co/functions/v1/jarvis-voice',{method,headers:{origin,'x-jarvis-key':key,'content-type':'application/json'},body:method==='POST'?JSON.stringify({text}):undefined});
test('voice requires the allowed origin, the private Jarvis key and sane text before calling ElevenLabs',async()=>{
 const s=setup();
 assert.equal((await s.handler(req({origin:'https://evil.example.com'}))).status,403);
 assert.equal((await s.handler(req({key:'wrong'}))).status,401);
 assert.equal((await s.handler(req({key:''}))).status,401);
 assert.equal((await s.handler(req({text:''}))).status,400);
 assert.equal((await s.handler(req({text:'x'.repeat(401)}))).status,400);
 assert.equal(s.calls.length,0,'No provider call for rejected requests');
 assert.equal((await setup({ELEVENLABS_API_KEY:''}).handler(req())).status,428);
 assert.equal((await setup({JARVIS_KEY:''}).handler(req())).status,428);
 assert.equal((await s.handler(req({method:'OPTIONS'}))).status,204);
});
test('audio is streamed back and the provider key stays on the server',async()=>{
 const s=setup();const r=await s.handler(req());
 assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'audio/mpeg');
 assert.equal(r.headers.get('access-control-allow-origin'),'https://app.example.com');
 assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[73,68,51]);
 const call=s.calls[0];assert.ok(call.url.startsWith('https://api.elevenlabs.io/v1/text-to-speech/'));
 assert.equal(call.opts.headers['xi-api-key'],'private-elevenlabs-fixture');
 const body=JSON.parse(call.opts.body);assert.equal(body.text,'Hola, Crew.');assert.equal(body.language_code,'es');
 assert.ok(!JSON.stringify([...r.headers]).includes('private-elevenlabs-fixture'));
 assert.equal((await setup({},401).handler(req())).status,502);
 assert.equal((await (await setup({},429).handler(req())).json()).error,'ElevenLabs quota reached');
});

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
const req=({origin='https://app.example.com',key='clave-larga-de-prueba',text='Hola, Crew.',method='POST',lang}={})=>new Request('https://fixture.supabase.co/functions/v1/jarvis-voice',{method,headers:{origin,'x-jarvis-key':key,'content-type':'application/json'},body:method==='POST'?JSON.stringify({text,lang}):undefined});
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
 const body=JSON.parse(call.opts.body);assert.equal(body.text,'Hola, Crew.');assert.equal(body.language_code,'en');
 assert.ok(!JSON.stringify([...r.headers]).includes('private-elevenlabs-fixture'));
 const es=setup();await es.handler(req({lang:'es'}));assert.equal(JSON.parse(es.calls[0].opts.body).language_code,'es');
 assert.equal((await setup({},401).handler(req())).status,502);
 assert.equal((await (await setup({},429).handler(req())).json()).error,'ElevenLabs quota reached');
});

test('ElevenLabs out of credit → Gemini free voice as WAV; model ladder on 429',async()=>{
 let handler;const calls=[];
 const env={APP_ORIGINS:'https://app.example.com',JARVIS_KEY:'clave-larga-de-prueba',ELEVENLABS_API_KEY:'private-elevenlabs-fixture',GEMINI_API_KEY:'gem-fixture'};
 const pcm=btoa(String.fromCharCode(1,2,3,4));
 const fetch=async(url,opts)=>{url=String(url);calls.push({url,opts});
  if(url.includes('elevenlabs'))return Response.json({detail:{status:'quota_exceeded'}},{status:401});
  if(url.includes('gemini-2.5-flash-preview-tts'))return new Response('{}',{status:429});
  return Response.json({candidates:[{content:{parts:[{inlineData:{mimeType:'audio/L16;codec=pcm;rate=24000',data:pcm}}]}}]})};
 new Function('Deno','fetch',code)({env:{get:n=>env[n]},serve:h=>handler=h},fetch);
 const r=await handler(req({text:'Hola, señor.',lang:'es'}));
 assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'audio/wav');
 const bytes=new Uint8Array(await r.arrayBuffer());assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'RIFF');assert.equal(bytes.length,48);
 assert.equal(new DataView(bytes.buffer).getUint32(24,true),24000);
 const g=calls.filter(c=>c.url.includes('generativelanguage'));assert.equal(g.length,2);assert.match(g[1].url,/gemini-2\.5-pro-preview-tts:generateContent/);
 const body=JSON.parse(g[1].opts.body);assert.match(body.contents[0].parts[0].text,/español de España: Hola, señor\.$/);assert.deepEqual(body.generationConfig.responseModalities,['AUDIO']);
 // Only Gemini configured: still talks. Nothing works: clear error.
 delete env.ELEVENLABS_API_KEY;assert.equal((await handler(req())).status,200);
 const all429=async()=>new Response('{}',{status:429});let h2;new Function('Deno','fetch',code)({env:{get:n=>env[n]},serve:h=>h2=h},all429);
 assert.equal((await (await h2(req())).json()).error,'Gemini voice unavailable');
});

test('once ElevenLabs says out of credit, later replies go straight to Gemini',async()=>{
 let handler;const calls=[];
 const env={APP_ORIGINS:'https://app.example.com',JARVIS_KEY:'clave-larga-de-prueba',ELEVENLABS_API_KEY:'private-elevenlabs-fixture',GEMINI_API_KEY:'gem-fixture'};
 const fetch=async(url)=>{url=String(url);calls.push(url);
  if(url.includes('elevenlabs'))return Response.json({detail:{status:'quota_exceeded'}},{status:401});
  return Response.json({candidates:[{content:{parts:[{inlineData:{mimeType:'audio/L16;rate=24000',data:btoa('ab')}}]}}]})};
 new Function('Deno','fetch',code)({env:{get:n=>env[n]},serve:h=>handler=h},fetch);
 assert.equal((await handler(req())).status,200);assert.equal((await handler(req({text:'Otra'}))).status,200);
 assert.equal(calls.filter(u=>u.includes('elevenlabs')).length,1);assert.equal(calls.filter(u=>u.includes('generativelanguage')).length,2);
});

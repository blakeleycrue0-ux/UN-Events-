import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {transform} from 'esbuild';
const source=await fs.readFile(new URL('../supabase/functions/jarvis-hear/index.ts',import.meta.url),'utf8');
const {code}=await transform(source,{loader:'ts',target:'es2022'});
function setup(extra={},status=200,reply={text:' hola Jarvis ',language_code:'spa'}){
 let handler;const env={APP_ORIGINS:'https://app.example.com',JARVIS_KEY:'clave-larga-de-prueba',ELEVENLABS_API_KEY:'private-elevenlabs-fixture',...extra};
 const calls=[];
 const fetch=async(url,opts)=>{calls.push({url,opts});return new Response(JSON.stringify(status===200?reply:{detail:{status:status===401?'missing_permissions':'x'}}),{status,headers:{'Content-Type':'application/json'}})};
 new Function('Deno','fetch',code)({env:{get:n=>env[n]},serve:h=>handler=h},fetch);
 return {handler,calls};
}
const audio=new Uint8Array(4000).fill(7);
const req=({origin='https://app.example.com',key='clave-larga-de-prueba',type='audio/mp4',body=audio}={})=>new Request('https://fixture.supabase.co/functions/v1/jarvis-hear',{method:'POST',headers:{origin,'x-jarvis-key':key,'content-type':type},body});
test('hearing requires origin, key and a real audio clip before calling ElevenLabs',async()=>{
 const s=setup();
 assert.equal((await s.handler(req({origin:'https://evil.example.com'}))).status,403);
 assert.equal((await s.handler(req({key:'nope'}))).status,401);
 assert.equal((await s.handler(req({type:'text/plain'}))).status,415);
 assert.equal((await s.handler(req({body:new Uint8Array(10)}))).status,400);
 assert.equal(s.calls.length,0);
 assert.equal((await setup({ELEVENLABS_API_KEY:''}).handler(req())).status,428);
});
test('the clip is sent to ElevenLabs Speech to Text and the text comes back',async()=>{
 const s=setup();const r=await s.handler(req({type:'audio/mp4;codecs=mp4a.40.2'}));
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{text:'hola Jarvis',language:'spa'});
 const call=s.calls[0];assert.equal(call.url,'https://api.elevenlabs.io/v1/speech-to-text');
 assert.equal(call.opts.headers['xi-api-key'],'private-elevenlabs-fixture');
 assert.equal(call.opts.body.get('model_id'),'scribe_v1');
 const file=call.opts.body.get('file');assert.equal(file.size,4000);assert.equal(file.type,'audio/mp4');
 assert.equal((await (await setup({},401).handler(req())).json()).error,'ElevenLabs key lacks speech to text permission');
 assert.equal((await setup({},500).handler(req())).status,502);
});

test('Gemini transcribes for free first; ElevenLabs is only the backup',async()=>{
 let handler;const calls=[];
 const env={APP_ORIGINS:'https://app.example.com',JARVIS_KEY:'clave-larga-de-prueba',ELEVENLABS_API_KEY:'private-elevenlabs-fixture',GEMINI_API_KEY:'gem-fixture'};
 let gem=(url)=>url.includes('gemini-flash-lite-latest')?new Response('{}',{status:429}):Response.json({candidates:[{content:{parts:[{text:'{"text":" «Jarvis, pon música» ","language":"es"}'}]}}]});
 const fetch=async(url,opts)=>{url=String(url);calls.push({url,opts});return url.includes('generativelanguage')?gem(url):new Response(JSON.stringify({text:'from eleven',language_code:'spa'}),{status:200})};
 new Function('Deno','fetch',code)({env:{get:n=>env[n]},serve:h=>handler=h},fetch);
 const r=await handler(req({type:'audio/wav'}));
 assert.deepEqual(await r.json(),{text:'Jarvis, pon música',language:'es',via:'gemini'});
 assert.equal(calls.length,2);assert.match(calls[1].url,/gemini-2\.5-flash-lite:generateContent/);assert.equal(calls[1].opts.headers['x-goog-api-key'],'gem-fixture');
 const part=JSON.parse(calls[1].opts.body).contents[0].parts[0].inlineData;assert.equal(part.mimeType,'audio/wav');assert.equal(atob(part.data).length,4000);
 gem=()=>new Response('{}',{status:429});calls.length=0;
 assert.equal((await (await handler(req())).json()).text,'from eleven');assert.ok(calls.some(c=>c.url.includes('elevenlabs')));
 delete env.ELEVENLABS_API_KEY;assert.equal((await handler(req())).status,502);
});

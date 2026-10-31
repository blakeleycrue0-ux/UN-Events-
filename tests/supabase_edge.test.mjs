import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {transform} from 'esbuild';
import {webcrypto,createHmac} from 'node:crypto';
const source=await fs.readFile(new URL('../supabase/functions/ice-config/index.ts',import.meta.url),'utf8');
const {code}=await transform(source,{loader:'ts',target:'es2022'});
function setup({enabled=true,relay=true}={}){
 let handler;const env={APP_ORIGINS:'https://app.example.com',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_ANON_KEY:'public-test-key',...(relay?{TURN_SHARED_SECRET:'test-secret-not-used-in-production-1234567890',TURN_URLS_JSON:'["turns:relay.example.com:5349?transport=tcp"]'}:{})};
 const fetch=async url=>new Response(JSON.stringify(url.includes('/auth/')?{id:'11111111-1111-4111-8111-111111111111'}:enabled?[{user_id:'11111111-1111-4111-8111-111111111111'}]:[]),{status:200,headers:{'Content-Type':'application/json'}});
 new Function('Deno','fetch','crypto','btoa',code)({env:{get:n=>env[n]},serve:h=>handler=h},fetch,webcrypto,s=>Buffer.from(s,'binary').toString('base64'));
 return {handler,env};
}
const request=(origin='https://app.example.com',authorization='Bearer test-user-jwt')=>new Request('https://fixture.supabase.co/functions/v1/ice-config',{method:'POST',headers:{origin,authorization}});
test('TURN credentials require origin, login, enabled membership and server configuration',async()=>{
 const {handler}=setup();assert.equal((await handler(request('https://wrong.example.com'))).status,403);
 assert.equal((await handler(request('https://app.example.com',''))).status,401);
 assert.equal((await setup({enabled:false}).handler(request())).status,403);
 assert.equal((await setup({relay:false}).handler(request())).status,428);
});
test('authenticated user gets expiring HMAC credentials, never the shared secret',async()=>{
 const {handler,env}=setup();const response=await handler(request());assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://app.example.com');assert.equal(response.headers.get('Cache-Control'),'no-store');
 const result=await response.json(),server=result.iceServers[0];assert.equal(server.credential,createHmac('sha1',env.TURN_SHARED_SECRET).update(server.username).digest('base64'));assert.ok(result.expiresAt>Date.now()/1000);assert.ok(result.expiresAt<=Date.now()/1000+3600);assert.ok(!JSON.stringify(result).includes(env.TURN_SHARED_SECRET));
});

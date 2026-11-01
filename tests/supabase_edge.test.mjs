import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {transform} from 'esbuild';
import {webcrypto,createHmac} from 'node:crypto';
const source=await fs.readFile(new URL('../supabase/functions/ice-config/index.ts',import.meta.url),'utf8');
const {code}=await transform(source,{loader:'ts',target:'es2022'});
function setup({enabled=true,relay=true,hosted=false,hostedFailure=false}={}){
 let handler;const env={APP_ORIGINS:'https://app.example.com',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_ANON_KEY:'public-test-key',...(relay?{TURN_SHARED_SECRET:'test-secret-not-used-in-production-1234567890',TURN_URLS_JSON:'["turns:relay.example.com:5349?transport=tcp"]'}:{})};
 if(hosted)Object.assign(env,{CLOUDFLARE_TURN_KEY_ID:'public-key-id-fixture',CLOUDFLARE_TURN_API_TOKEN:'private-provider-fixture'});
 const requests=[],options=[];
 const fetch=async (url,opts)=>{requests.push(url);options.push(opts);return new Response(JSON.stringify(url.includes('rtc.live.cloudflare.com')?{iceServers:{urls:['stun:stun.example.com:3478','turns:relay.example.com:5349?transport=tcp'],username:'ephemeral-user',credential:'ephemeral-password'}}:url.includes('/auth/')?{id:'11111111-1111-4111-8111-111111111111'}:enabled?[{user_id:'11111111-1111-4111-8111-111111111111'}]:[]),{status:hostedFailure&&url.includes('rtc.live.cloudflare.com')?503:200,headers:{'Content-Type':'application/json'}})};
 new Function('Deno','fetch','crypto','btoa',code)({env:{get:n=>env[n]},serve:h=>handler=h},fetch,webcrypto,s=>Buffer.from(s,'binary').toString('base64'));
 return {handler,env,requests,options};
}
const request=(origin='https://app.example.com',authorization='Bearer test-user-jwt')=>new Request('https://fixture.supabase.co/functions/v1/ice-config',{method:'POST',headers:{origin,authorization}});
test('TURN credentials require origin, login, enabled membership and server configuration',async()=>{
 const {handler}=setup();assert.equal((await handler(request('https://wrong.example.com'))).status,403);
 assert.equal((await handler(request('https://app.example.com',''))).status,401);
 assert.equal((await setup({enabled:false}).handler(request())).status,403);
 assert.equal((await setup({relay:false}).handler(request())).status,428);
});
test('hosted TURN is requested only after authorization and exposes only short-lived relay credentials',async()=>{
 const s=setup({hosted:true,relay:false});const response=await s.handler(request());assert.equal(response.status,200);
 const body=await response.json();assert.deepEqual(body.iceServers[0].urls,['turns:relay.example.com:5349?transport=tcp']);
 assert.ok(!JSON.stringify(body).includes(s.env.CLOUDFLARE_TURN_API_TOKEN));
 const i=s.requests.findIndex(u=>u.includes('rtc.live.cloudflare.com'));
 assert.ok(i>=2);assert.equal(JSON.parse(s.options[i].body).ttl,3600);
 assert.equal(s.options[i].headers.Authorization,'Bearer '+s.env.CLOUDFLARE_TURN_API_TOKEN);
 const denied=setup({hosted:true,enabled:false});assert.equal((await denied.handler(request())).status,403);
 assert.ok(!denied.requests.some(u=>u.includes('rtc.live.cloudflare.com')));
 assert.equal((await setup({hosted:true,hostedFailure:true}).handler(request())).status,503);
});
test('paired-device TURN checks the caller-scoped unrevoked camera link via RLS',async()=>{
 const pairId='33333333-3333-4333-8333-333333333333';
 const req=id=>new Request('https://fixture.supabase.co/functions/v1/ice-config',{method:'POST',headers:{origin:'https://app.example.com',authorization:'Bearer test-jwt','content-type':'application/json'},body:JSON.stringify({pairId:id})});
 const s=setup();assert.equal((await s.handler(req(pairId))).status,200);
 assert.ok(s.requests.some(u=>u.includes('/camera_links?')&&u.includes('id=eq.'+pairId)&&u.includes('revoked=eq.false')&&u.includes('camera_id=not.is.null')));
 assert.ok(!s.requests.some(u=>u.includes('/remote_memberships')));
 assert.equal((await setup({enabled:false}).handler(req(pairId))).status,403);
 assert.equal((await s.handler(req('../unsafe'))).status,400);
 assert.equal((await setup({relay:false}).handler(req(pairId))).status,428);
});
test('authenticated user gets expiring HMAC credentials, never the shared secret',async()=>{
 const {handler,env}=setup();const response=await handler(request());assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://app.example.com');assert.equal(response.headers.get('Cache-Control'),'no-store');
 const result=await response.json(),server=result.iceServers[0];assert.equal(server.credential,createHmac('sha1',env.TURN_SHARED_SECRET).update(server.username).digest('base64'));assert.ok(result.expiresAt>Date.now()/1000);assert.ok(result.expiresAt<=Date.now()/1000+3600);assert.ok(!JSON.stringify(result).includes(env.TURN_SHARED_SECRET));
});

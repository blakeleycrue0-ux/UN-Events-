import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {transform} from 'esbuild';
const source=await fs.readFile(new URL('../supabase/functions/jarvis-brain/index.ts',import.meta.url),'utf8');
const stripped=source.replace('import Anthropic from "npm:@anthropic-ai/sdk";','');
assert.notEqual(stripped,source,'SDK import line changed; update the test harness');
const {code}=await transform(stripped,{loader:'ts',target:'es2022'});
// Fake SDK with the same surface: default export class with typed error classes.
function fakeSdk(behaviour){
 class APIError extends Error{constructor(status,m){super(m);this.status=status}}
 class AuthenticationError extends APIError{} class PermissionDeniedError extends APIError{}
 class RateLimitError extends APIError{} class BadRequestError extends APIError{}
 const calls=[];
 class Anthropic{constructor(opts){this.opts=opts;calls.push({ctor:opts});this.beta={messages:{create:async(p)=>{calls.push({params:p});return behaviour(p,Anthropic)}}}}}
 Object.assign(Anthropic,{APIError,AuthenticationError,PermissionDeniedError,RateLimitError,BadRequestError});
 return {Anthropic,calls};
}
function setup(behaviour=()=>({stop_reason:'end_turn',content:[{type:'thinking',thinking:''},{type:'text',text:'Good evening, Crew.'}]}),env={}){
 let handler;const sdk=fakeSdk(behaviour);
 const e={APP_ORIGINS:'https://app.example.com',JARVIS_KEY:'clave-larga-de-prueba',ANTHROPIC_API_KEY:'sk-ant-fixture',...env};
 new Function('Deno','Anthropic',code)({env:{get:n=>e[n]},serve:h=>handler=h},sdk.Anthropic);
 return {handler,calls:sdk.calls};
}
const req=(body,{origin='https://app.example.com',key='clave-larga-de-prueba'}={})=>new Request('https://fixture.supabase.co/functions/v1/jarvis-brain',{method:'POST',headers:{origin,'x-jarvis-key':key,'content-type':'application/json'},body:JSON.stringify(body)});
const convo={messages:[{role:'user',content:'hola jarvis'}],lang:'en',name:'Crew',now:'Monday 2 November, 01:10'};
test('brain requires origin, key and a well-formed short conversation before calling Claude',async()=>{
 const s=setup();
 assert.equal((await s.handler(req(convo,{origin:'https://evil.example.com'}))).status,403);
 assert.equal((await s.handler(req(convo,{key:'nope'}))).status,401);
 assert.equal((await s.handler(req({messages:[]}))).status,400);
 assert.equal((await s.handler(req({messages:[{role:'assistant',content:'x'}]}))).status,400);
 assert.equal((await s.handler(req({messages:[{role:'user',content:'a'},{role:'assistant',content:'b'}]}))).status,400);
 assert.equal((await s.handler(req({messages:[{role:'user',content:'x'.repeat(1001)}]}))).status,400);
 assert.equal(s.calls.length,0);
 assert.equal((await setup(undefined,{ANTHROPIC_API_KEY:''}).handler(req(convo))).status,428);
});
test('reply comes from text blocks of Claude Opus 5.5 at low effort with refusal fallback',async()=>{
 const s=setup();const r=await s.handler(req(convo));
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{reply:'Good evening, Crew.'});
 const p=s.calls.find(c=>c.params).params;
 assert.equal(p.model,'claude-opus-5-5');assert.deepEqual(p.output_config,{effort:'low'});
 assert.equal(p.fallbacks,'default');assert.deepEqual(p.betas,['server-side-fallback-2026-07-01']);
 assert.ok(!('thinking' in p)&&!('temperature' in p));
 assert.match(p.system,/answer in English only/);assert.match(p.messages[0].content,/^\[Local time: Monday/);
 assert.equal(s.calls[0].ctor.apiKey,'sk-ant-fixture');
 const es=setup();await es.handler(req({...convo,lang:'es'}));assert.match(es.calls.find(c=>c.params).params.system,/Spanish/);
 const haiku=setup(undefined,{CLAUDE_MODEL:'claude-haiku-5-5'});await haiku.handler(req(convo));
 const hp=haiku.calls.find(c=>c.params).params;assert.equal(hp.model,'claude-haiku-5-5');assert.ok(!('fallbacks' in hp));
});
test('refusals and API errors become short, safe messages',async()=>{
 assert.deepEqual(await (await setup(()=>({stop_reason:'refusal',content:[]})).handler(req(convo))).json(),{reply:'',refused:true});
 for(const [cls,message,expected] of [
  ['AuthenticationError','invalid x-api-key','Claude key rejected'],
  ['RateLimitError','rate limited','Claude busy'],
  ['BadRequestError','Your credit balance is too low','Claude credit exhausted'],
  ['BadRequestError','messages: invalid','Claude request rejected'],
  ['APIError','overloaded','Claude unavailable']]){
  const s=setup((p,A)=>{throw new A[cls](400,message)});
  const r=await s.handler(req(convo));
  assert.equal(r.status,502,cls);assert.deepEqual(await r.json(),{error:expected});
 }
 const network=setup(()=>{throw new TypeError('fetch failed')});
 assert.equal((await network.handler(req(convo))).status,503);
});

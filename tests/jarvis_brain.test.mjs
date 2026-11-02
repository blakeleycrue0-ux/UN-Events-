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
function setup(behaviour=()=>({stop_reason:'end_turn',content:[{type:'thinking',thinking:''},{type:'text',text:'Good evening, Crew.'}]}),env={},status=200){
 let handler;const sdk=fakeSdk(behaviour);const outbound=[],state=[];
 const e={APP_ORIGINS:'https://app.example.com',JARVIS_KEY:'clave-larga-de-prueba',ANTHROPIC_API_KEY:'sk-ant-fixture',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-fixture',...env};
 const fetch=async(url,opts)=>{const entry={url,opts,body:JSON.parse(opts.body)};if(String(url).includes('/rest/v1/jarvis_state')){state.push(entry);return new Response('',{status:201})}outbound.push(entry);return new Response(entry.url.includes('/rest/v1/')?'':'{}',{status:entry.url.includes('/rest/v1/')&&status===200?201:status})};
 new Function('Deno','Anthropic','fetch',code)({env:{get:n=>e[n]},serve:h=>handler=h},sdk.Anthropic,fetch);
 return {handler,calls:sdk.calls,outbound,state};
}
const req=(body,{origin='https://app.example.com',key='clave-larga-de-prueba'}={})=>new Request('https://fixture.supabase.co/functions/v1/jarvis-brain',{method:'POST',headers:{origin,'x-jarvis-key':key,'content-type':'application/json'},body:JSON.stringify(body)});
const tool=(name,input,text='')=>()=>({stop_reason:'tool_use',content:[...(text?[{type:'text',text}]:[]),{type:'tool_use',id:'t1',name,input}]});
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
test('reply comes from text blocks of Claude Haiku 5.5 (cheapest) at low effort',async()=>{
 const s=setup();const r=await s.handler(req(convo));
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{reply:'Good evening, Crew.',actions:[]});
 const p=s.calls.find(c=>c.params).params;
 assert.equal(p.model,'claude-haiku-5-5');assert.deepEqual(p.output_config,{effort:'low'});assert.ok(p.max_tokens<=1024);
 assert.ok(!('fallbacks' in p),'Haiku has no server-side fallback');
 const opus=setup(undefined,{CLAUDE_MODEL:'claude-opus-5-5'});await opus.handler(req(convo));
 const op=opus.calls.find(c=>c.params).params;assert.equal(op.fallbacks,'default');assert.deepEqual(op.betas,['server-side-fallback-2026-07-01']);
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
test('Claude gets strict tools and its choices reach the Chromebook channel or the inbox',async()=>{
 const s=setup(tool('play_music',{query:'lofi beats',service:'youtube'},'Playing lofi beats on YouTube.'));
 const r=await s.handler(req(convo));assert.deepEqual(await r.json(),{reply:'Playing lofi beats on YouTube.',actions:['play']});
 const p=s.calls.find(c=>c.params).params;
 assert.deepEqual(p.tools.map(t=>t.name),['play_music','media_control','open_site','web_search','remember','email_me','browser_task','set_reminder','add_homework','homework_done','add_countdown','remove_countdown']);
 assert.ok(p.tools.every(t=>t.strict===true&&t.input_schema.additionalProperties===false));
 assert.ok(!('tool_choice' in p));
 const call=s.outbound[0];assert.equal(call.url,'https://fixture.supabase.co/realtime/v1/api/broadcast');
 assert.equal(call.opts.headers.apikey,'service-fixture');
 const msg=call.body.messages[0];
 const {createHash}=await import('node:crypto');
 assert.equal(msg.topic,'jarvis-pc-'+createHash('sha256').update('jarvis-pc:clave-larga-de-prueba').digest('hex').slice(0,40));
 assert.equal(msg.event,'command');assert.equal(msg.private,false);
 assert.deepEqual({...msg.payload,at:0},{action:'play',service:'youtube',query:'lofi beats',lang:'en',at:0});
 const open=setup(tool('open_site',{site:'teams'}));assert.deepEqual(await (await open.handler(req(convo))).json(),{reply:'Opened.',actions:['open:teams']});
 assert.equal(open.outbound[0].body.messages[0].payload.site,'teams');
 const bad=setup(tool('open_site',{site:'evil.com'}));await bad.handler(req(convo));assert.equal(bad.outbound.length,0,'Unknown sites are never sent');
 const pause=setup(tool('media_control',{action:'pause'}));await pause.handler(req(convo));assert.equal(pause.outbound[0].body.messages[0].payload.action,'pause');
 const down=setup(tool('web_search',{query:'weather'}),{},500);
 assert.equal((await (await down.handler(req(convo))).json()).reply,"I couldn't reach your computer.");
 // Email goes only to the configured inbox, through Resend.
 const mail=setup(tool('email_me',{subject:'Study',body:'Maths at 6'},'Sent you a reminder.'),{RESEND_API_KEY:'re_fixture',JARVIS_EMAIL_TO:'me@example.com'});
 assert.deepEqual(await (await mail.handler(req(convo))).json(),{reply:'Sent you a reminder.',actions:['email:sent']});
 const m=mail.outbound[0];assert.equal(m.url,'https://api.resend.com/emails');assert.deepEqual(m.body.to,['me@example.com']);
 assert.equal(m.body.subject,'Study');assert.equal(m.opts.headers.Authorization,'Bearer re_fixture');
 const nomail=setup(tool('email_me',{subject:'x',body:'y'},'Sent!'));
 assert.equal((await (await nomail.handler(req(convo))).json()).reply,"I can't send emails yet: email isn't set up.");
});
test('memory and live context reach Claude; remember comes back to the desk',async()=>{
 const s=setup(tool('remember',{fact:'Crew has a maths exam on Friday.'},'Noted.'));
 const r=await s.handler(req({...convo,memory:['Crew likes lofi.','x'.repeat(500)],context:'18°C, sunny in Calvià'}));
 assert.deepEqual(await r.json(),{reply:'Noted.',actions:['remember'],remember:['Crew has a maths exam on Friday.']});
 const p=s.calls.find(c=>c.params).params;
 assert.match(p.system,/Live context: 18°C, sunny in Calvià/);assert.match(p.system,/Crew likes lofi\./);
 assert.ok(!p.system.includes('x'.repeat(201)),'each memory is capped');
 assert.equal(s.outbound.length,0,'remembering sends nothing anywhere');
 const louder=setup(tool('media_control',{action:'louder'}));await louder.handler(req(convo));assert.equal(louder.outbound[0].body.messages[0].payload.action,'louder');
});

test('multi-step browser jobs go to the Chromebook agent; the phone side gets name, language and memory',async()=>{
 const s=setup(tool('browser_task',{task:'Check Teams for maths assignments due this week'},"On it, I'm checking Teams."));
 const r=await s.handler(req({...convo,lang:'es',memory:['Likes lofi.'],hear:'es-ES'}));
 assert.deepEqual(await r.json(),{reply:"On it, I'm checking Teams.",actions:['agent']});
 assert.deepEqual({...s.outbound[0].body.messages[0].payload,at:0},{action:'agent',task:'Check Teams for maths assignments due this week',lang:'es',at:0});
 assert.equal(s.state.length,1);assert.deepEqual({...s.state[0].body,updated_at:0},{id:1,name:'Crew',lang:'es',hear:'es-ES',memory:['Likes lofi.'],updated_at:0});
 assert.match(s.state[0].opts.headers.Prefer,/merge-duplicates/);
 const p=s.calls.find(c=>c.params).params;assert.match(p.system,/browser_task/);
});
test('reminders are stored with an exact time; past or garbled times are refused',async()=>{
 const due=new Date(Date.now()+3600e3).toISOString().replace('Z','+00:00');
 const s=setup(tool('set_reminder',{due,text:'Time to study maths, Crew.',via:'desk'},"I'll remind you at eight."));
 assert.deepEqual(await (await s.handler(req(convo))).json(),{reply:"I'll remind you at eight.",actions:['reminder:chromebook']});
 const row=s.outbound[0];assert.equal(row.url,'https://fixture.supabase.co/rest/v1/jarvis_reminders');assert.equal(row.opts.headers.apikey,'service-fixture');
 assert.deepEqual(row.body,{due_at:new Date(due).toISOString(),text:'Time to study maths, Crew.',via:'chromebook',lang:'en'});
 for(const bad of ['tomorrow','2020-01-01T08:00:00+01:00']){
  const b=setup(tool('set_reminder',{due:bad,text:'x',via:'desk'},'Done.'));
  assert.deepEqual(await (await b.handler(req(convo))).json(),{reply:"I couldn't save that reminder.",actions:['reminder:failed']});assert.equal(b.outbound.length,0);
 }
});

test('with no words from Claude, Jarvis says what it actually did',async()=>{
 const say=async(name,input)=>(await (await setup(tool(name,input)).handler(req(convo))).json()).reply;
 assert.equal(await say('media_control',{action:'pause'}),'Done.');
 assert.equal(await say('play_music',{query:'lofi',service:'youtube'}),'Playing it now.');
 assert.equal(await say('browser_task',{task:'Check Teams'}),"On it. I'll tell you when it's done.");
 assert.equal(await say('set_reminder',{due:new Date(Date.now()+3600e3).toISOString(),text:'Study',via:'desk'}),'Reminder saved.');
 const empty=setup(()=>({stop_reason:'end_turn',content:[]}));
 assert.equal((await (await empty.handler(req(convo))).json()).reply,"Sorry, I didn't catch that. Could you say it again?");
});

test('homework and countdowns: Claude edits the lists on screen, with valid dates only',async()=>{
 const two=()=>({stop_reason:'tool_use',content:[{type:'tool_use',name:'add_homework',input:{title:'History essay',due:'2026-11-05'}},{type:'tool_use',name:'add_countdown',input:{title:'Maths exam',date:'2026-11-20'}},{type:'tool_use',name:'homework_done',input:{title:'Maths p. 42'}},{type:'tool_use',name:'add_homework',input:{title:'Bad',due:'Thursday'}}]});
 const s=setup(two);
 const r=await (await s.handler(req({...convo,lists:{homework:[{title:'Maths p. 42',due:'2026-11-03'}],countdowns:[]}}))).json();
 assert.deepEqual(r.lists,{homeworkAdd:[{title:'History essay',due:'2026-11-05'}],homeworkDone:['Maths p. 42'],countdownAdd:[{title:'Maths exam',date:'2026-11-20'}],countdownRemove:[]});
 assert.equal(r.reply,'Noted.');
 assert.match(s.calls.find(c=>c.params).params.system,/Current homework: Maths p\. 42 \(2026-11-03\)/);
});

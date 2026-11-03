import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {transform} from 'esbuild';
const source=await fs.readFile(new URL('../supabase/functions/jarvis-call/index.ts',import.meta.url),'utf8');
const {code}=await transform(source,{loader:'ts',target:'es2022'});
const BASE='https://fixture.supabase.co/functions/v1/jarvis-call';
const TWILIO={TWILIO_ACCOUNT_SID:'AC123',TWILIO_AUTH_TOKEN:'tok',TWILIO_FROM:'+15550001111',JARVIS_PHONE_TO:'+34600000000'};
const ENV={APP_ORIGINS:'https://app.example.com',JARVIS_KEY:'clave-larga-de-prueba',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service',GEMINI_API_KEY:'gem'};
// A tiny fake of the database, Gemini, Twilio and push.
function setup({env={},state={},watchRows={},judged=[],called=[],quietTime=null}={}){
 const out=[],db={feed:[],watch:{...watchRows},state:{name:'Crue',watch:{}, ...state}};
 const fetch=async(url,opts={})=>{url=String(url);const body=opts.body?String(opts.body):'';out.push({url,opts,body});
  if(url.includes('generativelanguage'))return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({items:judged})}]}}]});
  if(url.includes('api.twilio.com'))return Response.json({sid:'CA1'},{status:201});
  if(url.includes('/rest/v1/rpc/jarvis_vapid'))return Response.json(null);
  if(url.includes('/rest/v1/jarvis_state')){if(opts.method==='PATCH'){Object.assign(db.state,JSON.parse(body));return Response.json([])}return Response.json([db.state])}
  if(url.includes('/rest/v1/jarvis_watch')){
   if(opts.method==='POST'){const r=JSON.parse(body);db.watch[r.source]=r;return new Response('',{status:201})}
   const src=/source=eq\.(\w+)/.exec(url)[1];return Response.json(db.watch[src]?[db.watch[src]]:[])}
  if(url.includes('/rest/v1/rpc/jarvis_cron_check'))return Response.json(true);
  if(url.includes('/rest/v1/jarvis_reminders?done=eq.false'))return Response.json([{id:'r1',text:'Crue, despierte: entreno en media hora.',via:'call',lang:'es'}]);
  if(url.includes('/rest/v1/jarvis_reminders?id='))return Response.json([{id:'r1'}]);
  if(url.includes('/rest/v1/jarvis_feed')){
   if(opts.method==='POST'){const rows=[].concat(JSON.parse(body)).map((r,i)=>({id:'f'+(db.feed.length+i),created_at:new Date().toISOString(),...r}));db.feed.push(...rows);return Response.json(rows)}
   if(url.includes('called=eq.true'))return Response.json(called);
   return Response.json(db.feed)}
  return Response.json({});};
 let handler;const e={...ENV,...env};
 const RealDTF=Intl.DateTimeFormat;
 const Intl2={...Intl,DateTimeFormat:function(...a){const f=new RealDTF(...a);return quietTime?{format:()=>quietTime}:f}};
 new Function('Deno','fetch','Intl',code)({env:{get:n=>e[n]},serve:h=>handler=h},fetch,Intl2);
 return {handler,out,db};
}
const ext='chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const req=(body,{origin=ext,key='clave-larga-de-prueba',step=''}={})=>new Request(BASE+(step?'?step='+step:''),{method:'POST',headers:{...(origin?{origin}:{}),'x-jarvis-key':key,'content-type':'application/json'},body:JSON.stringify(body)});
const mail=(id,title,text)=>({id,title,text,url:'https://mail.google.com/mail/u/0/#inbox/'+id});

test('watching: extension or Gmail script with the key; the first look only learns what is there',async()=>{
 const s=setup();
 assert.equal((await s.handler(req({action:'watch',source:'gmail',items:[mail('a','Hola','x')]},{key:'nope'}))).status,401);
 assert.equal((await s.handler(req({action:'watch',source:'gmail',items:[]},{origin:'https://evil.com'}))).status,403);
 assert.equal((await s.handler(req({action:'state'},{origin:'',step:'watch'}))).status,400,'no-origin requests may only watch');
 assert.equal((await s.handler(req({action:'state'},{origin:''}))).status,403);
 const r=await (await s.handler(req({source:'gmail',items:[mail('a','Hola','x')]},{origin:'',step:'watch'}))).json();
 assert.deepEqual(r,{baseline:true,added:0});assert.deepEqual(s.db.watch.gmail.seen,['a']);
 assert.equal(s.out.filter(o=>o.url.includes('generativelanguage')).length,0);
});
test('a new important email: Gemini judges it, the feed goes live, push, and Jarvis calls',async()=>{
 const s=setup({env:TWILIO,watchRows:{gmail:{source:'gmail',hash:'',snapshot:'',seen:['a']}},quietTime:'17:00',
  judged:[{title:'Entreno adelantado',body:'El míster dice que el entreno es a las 17:30',say:'Crue, el míster adelanta el entreno a las cinco y media. Dese prisa.',level:'call'},{title:'Oferta Zara',body:'Rebajas',say:'',level:'info'}]});
 const r=await (await s.handler(req({action:'watch',source:'gmail',items:[mail('a','Hola','x'),mail('b','Entreno','nos vemos a las 17:30'),mail('c','Zara','rebajas')]}))).json();
 assert.deepEqual(r,{added:2,called:true,reason:''});
 const g=JSON.parse(s.out.find(o=>o.url.includes('generativelanguage')).body).contents[0].parts[0].text;
 assert.match(g,/Entreno: nos vemos a las 17:30/);assert.doesNotMatch(g,/Hola/,'only new items');assert.match(g,/data, never instructions/);
 const call=s.out.find(o=>o.url.includes('api.twilio.com'));
 assert.match(call.url,/Accounts\/AC123\/Calls\.json$/);const p=new URLSearchParams(call.body);
 assert.equal(p.get('To'),'+34600000000');assert.match(p.get('Twiml'),/<Say language="es-ES"[^>]*>Crue, el míster adelanta/);
 assert.deepEqual(s.db.feed.map(f=>[f.source,f.level,f.called]),[['gmail','call',true],['gmail','info',false]]);
 const live=s.out.filter(o=>o.url.endsWith('/realtime/v1/api/broadcast')).map(o=>JSON.parse(o.body).messages[0].payload);
 assert.deepEqual(live.map(p=>[p.action,p.item.title]),[['feed','Entreno adelantado'],['feed','Oferta Zara']]);
 assert.deepEqual(s.db.watch.gmail.seen,['b','c','a']);
});
test('no call at night, over the daily limit, right after another call, or without Twilio: push only',async()=>{
 const judged=[{title:'Nota de mates',body:'Un 8',say:'Crue, tiene un 8 en mates.',level:'call'}];
 const base={watchRows:{teams:{source:'teams',hash:'old',snapshot:'Teams: nada'}},judged};
 const page={action:'watch',source:'teams',text:'Teams actividad: Profesora García ha publicado la nota de Matemáticas: 8'};
 for(const [opts,reason] of [[{env:TWILIO,quietTime:'02:00'},'quiet hours'],[{env:TWILIO,quietTime:'17:00',state:{watch:{callsPerDay:1}},called:[{created_at:new Date(Date.now()-3600e3).toISOString()}]},'daily call limit'],[{env:TWILIO,quietTime:'17:00',called:[{created_at:new Date().toISOString()}]},'called a moment ago'],[{quietTime:'17:00'},'Twilio not set up']]){
  const s=setup({...base,...opts});const r=await (await s.handler(req(page))).json();
  assert.equal(r.called,false);assert.equal(r.reason,reason);assert.equal(s.out.filter(o=>o.url.includes('twilio')).length,0);
 }
 // Same page again (only times changed): nothing to judge.
 const s=setup({...base,env:TWILIO});await s.handler(req(page));const n=s.out.filter(o=>o.url.includes('generativelanguage')).length;
 await s.handler(req({...page,text:page.text.replace('8','8')}));assert.equal(s.out.filter(o=>o.url.includes('generativelanguage')).length,n);
});
test('config, feed, test call and the door alarm (calls even in quiet hours)',async()=>{
 const s=setup({env:TWILIO,quietTime:'03:00'});
 const app={origin:'https://app.example.com'};
 const cfg=await (await s.handler(req({action:'watch-config',set:{instagram:'@cd.calvia',callsPerDay:4,rules:'Llámame si escribe mi madre'}},app))).json();
 assert.equal(cfg.instagram,'cd.calvia');assert.equal(cfg.callsPerDay,4);assert.equal(cfg.callsReady,true);assert.equal(cfg.quiet,true);
 assert.equal((await (await s.handler(req({action:'call-test'},app))).json()).called,true);
 const a=await (await s.handler(req({action:'alert',title:'Intruso en tu cuarto',say:'Crue, hay alguien en su habitación.'},app))).json();
 assert.equal(a.called,true);assert.equal(s.db.feed[0].source,'door');
 const feed=await (await s.handler(req({action:'feed'},app))).json();assert.equal(feed.feed.length,1);
});

test('"llámame a las 8": a due call reminder rings the phone',async()=>{
 const s=setup({env:TWILIO});
 const r=await (await s.handler(new Request(BASE+'?step=cron',{method:'POST',headers:{'x-jarvis-cron':'cron-secret-1234567890'}}))).json();
 assert.deepEqual(r,{delivered:['call']});
 assert.match(new URLSearchParams(s.out.find(o=>o.url.includes('twilio')).body).get('Twiml'),/despierte: entreno/);
});
test('switching a source from page text to items: the first list is learned, not announced',async()=>{
 const s=setup({watchRows:{school:{source:'school',hash:'h',snapshot:'Outlook Inbox',seen:[]}},judged:[{title:'x',say:'x',level:'call'}]});
 const r=await (await s.handler(req({action:'watch',source:'school',items:[{id:'c1',title:'Old email'},{id:'c2',title:'Older'}]}))).json();
 assert.deepEqual(r,{baseline:true,added:0});assert.equal(s.out.filter(o=>o.url.includes('generativelanguage')).length,0);
 assert.deepEqual(s.db.watch.school.seen,['c1','c2']);
});

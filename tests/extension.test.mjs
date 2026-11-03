import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const {jarvisPlan,jarvisTopic}=require('../extension/commands.js');

test('only fixed actions are possible: no arbitrary URL can come from a message',()=>{
 assert.equal(jarvisPlan({action:'play',service:'youtube',query:'lofi beats'}).url,'https://www.youtube.com/results?search_query=lofi%20beats#jarvis-play');
 assert.equal(jarvisPlan({action:'play',service:'spotify',query:'Drake'}).url,'https://open.spotify.com/search/Drake#jarvis-play');
 assert.equal(jarvisPlan({action:'open',site:'teams'}).url,'https://teams.microsoft.com/');
 assert.equal(jarvisPlan({action:'search',query:'weather mallorca'}).url,'https://www.google.com/search?q=weather%20mallorca');
 assert.deepEqual(jarvisPlan({action:'next'}),{kind:'media',action:'next'});
 for(const bad of [{action:'open',site:'https://evil.com'},{action:'open',site:'constructor'},{action:'open',url:'https://evil.com'},{action:'play',query:''},{action:'rm'},null,'x'])
  assert.equal(jarvisPlan(bad),null,JSON.stringify(bad));
});
test('the channel name matches the one the brain function uses',async()=>{
 assert.equal(await jarvisTopic(' clave-larga '),'jarvis-pc-'+createHash('sha256').update('jarvis-pc:clave-larga').digest('hex').slice(0,40));
});
test('background joins the private topic and turns a broadcast into a new tab',async()=>{
 execFileSync('node',['scripts/zip-extension.mjs']);
 const sockets=[],tabs=[],scripts=[],store={key:'clave-larga'};
 class FakeSocket{constructor(url){this.url=url;this.readyState=0;this.sent=[];sockets.push(this);setTimeout(()=>{this.readyState=1;this.onopen?.()},5)}send(m){this.sent.push(JSON.parse(m))}close(){this.readyState=3}}
 const listeners={};const on=(n)=>({addListener:(f)=>(listeners[n]=f)});
 const chrome={storage:{local:{get:async(k)=>typeof k==='string'?{[k]:store[k]}:store,set:async(o)=>Object.assign(store,o)},onChanged:on('changed')},
  tabs:{create:async(o)=>tabs.push(o.url),query:async()=>[{id:7,audible:true}]},scripting:{executeScript:async(o)=>scripts.push(o.args[0])},
  alarms:{create(){},onAlarm:on('alarm')},runtime:{onInstalled:on('installed'),onStartup:on('startup'),onMessage:on('message')}};
 const timers=[];const ctx=vm.createContext({chrome,WebSocket:FakeSocket,crypto:globalThis.crypto,TextEncoder,setTimeout:(f,ms)=>{const t=setTimeout(f,ms);t.unref?.();return t},setInterval:(f,ms)=>{const t=setInterval(f,ms);t.unref();timers.push(t);return t},clearInterval,console,Date,
  importScripts:(...files)=>files.forEach(f=>vm.runInContext(fs.readFileSync('extension/'+f,'utf8'),ctx))});
 vm.runInContext(fs.readFileSync('extension/background.js','utf8'),ctx);
 await new Promise(r=>setTimeout(r,60));
 const ws=sockets[0];const config=fs.readFileSync('supabase-config.js','utf8');
 assert.ok(ws.url.startsWith('wss://pmzekgfgwlfugfffzhrt.supabase.co/realtime/v1/websocket?apikey='));
 assert.ok(config.includes(decodeURIComponent(ws.url.split('apikey=')[1].split('&')[0])),'uses the public anon key');
 const topic='realtime:'+await jarvisTopic('clave-larga');
 const join=ws.sent.find(m=>m.event==='phx_join');assert.equal(join.topic,topic);assert.equal(join.payload.config.private,false);
 ws.onmessage({data:JSON.stringify({topic,event:'phx_reply',payload:{status:'ok'}})});
 await new Promise(r=>setTimeout(r,5));assert.equal(store.status.state,'conectado');
 const cmd=(payload,t=topic)=>ws.onmessage({data:JSON.stringify({topic:t,event:'broadcast',payload:{event:'command',type:'broadcast',payload}})});
 cmd({action:'open',site:'gmail',at:Date.now()});await new Promise(r=>setTimeout(r,10));
 assert.deepEqual(tabs,['https://mail.google.com/']);
 cmd({action:'open',site:'gmail',at:Date.now()-500000});cmd({action:'open',site:'gmail',at:1});
 cmd({action:'open',site:'teams',at:Date.now()},'realtime:other');await new Promise(r=>setTimeout(r,10));
 assert.equal(tabs.length,1,'stale, replayed and foreign-topic messages are ignored');
 cmd({action:'play',service:'youtube',query:'chill',at:Date.now()+1});await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(scripts,['pause'],'pauses what was playing first');
 assert.equal(tabs[1],'https://www.youtube.com/results?search_query=chill#jarvis-play');
 const zip=fs.readFileSync('jarvis-chromebook.zip');
 for(const f of ['manifest.json','background.js','commands.js','config.js','options.html','options.js','autoplay.js'])
  assert.ok(zip.includes(Buffer.from('jarvis-chromebook/'+f)),f);
 JSON.parse(fs.readFileSync('extension/manifest.json','utf8'));
});
test('agent: risky steps wait for a spoken yes; a no is passed back to Claude; summary reaches the desk',async()=>{
 const {agentNeedsConfirm,agentSaidYes}=require('../extension/agent.js');
 assert.ok(agentNeedsConfirm({type:'click',risky:false},'Hand in'));assert.ok(agentNeedsConfirm({type:'click',risky:true},'Next'));
 assert.ok(agentNeedsConfirm({type:'click'},'Entregar'));assert.ok(!agentNeedsConfirm({type:'click'},'Assignments'));
 assert.ok(!agentNeedsConfirm({type:'scroll'},'send'));
 assert.ok(agentSaidYes('Sí, hazlo'));assert.ok(agentSaidYes('yes please'));assert.ok(!agentSaidYes('no'));assert.ok(!agentSaidYes(''));
 assert.deepEqual(jarvisPlan({action:'agent',task:'  check   teams ',lang:'es'}),{kind:'agent',task:'check teams',lang:'es'});
 assert.equal(jarvisPlan({action:'agent',task:''}),null);
 // Full loop with fake Chrome and a fake agent function.
 const desk=[],acted=[],steps=[{type:'click',id:2,risky:true,say:'Handing in'},{type:'click',id:2,risky:true,say:'Handing in'},{type:'done',summary:'Handed in your maths homework.'}];
 const bodies=[];let answers=['no, wait','sí'];
 const chrome={storage:{local:{get:async()=>({key:'clave-larga'})}},
  windows:{create:async()=>({id:9,tabs:[{id:5}]})},
  tabs:{get:async(id)=>({id,status:'complete',url:'https://teams.microsoft.com/',title:'Teams'}),update:async()=>{},goBack:async()=>{},
   captureVisibleTab:async()=>'data:image/jpeg;base64,'+'A'.repeat(200),
   query:async()=>[{id:1,url:'https://unevents.netlify.app/'},{id:3,url:'https://unevents.netlify.app/pared'}],
   sendMessage:async(tabId,m)=>{assert.equal(tabId,1,'only the desk tab, never the wall');desk.push(m.agent);if(m.agent.kind==='ask')setTimeout(()=>ctx.agentAnswer(m.agent.id,answers.shift()),5)}},
  scripting:{executeScript:async({func,args})=>{if(func.name==='agentSnapshot')return[{result:{url:'https://teams.microsoft.com/',title:'Teams',text:'Homework',elements:['[2] button Hand in']}}];
   if(args[0].peek)return[{result:{ok:true,label:'Hand in',href:''}}];acted.push(args[0]);return[{result:{ok:true,label:'Hand in'}}]}},
  downloads:{download:async()=>{}}};
 const fetch=async(url,o)=>{bodies.push(JSON.parse(o.body));assert.ok(url.endsWith('/functions/v1/jarvis-agent'));assert.equal(o.headers['x-jarvis-key'],'clave-larga');return Response.json({action:steps.shift()})};
 const ctx=vm.createContext({chrome,fetch,Response,console,setTimeout:(f,ms)=>{const t=setTimeout(f,ms>5000?ms:Math.min(ms,5));if(ms>5000)t.unref();return t},JARVIS_CONFIG:{url:'https://x.supabase.co',anonKey:'anon'},Date,String,Promise,Map});
 vm.runInContext(fs.readFileSync('extension/agent.js','utf8'),ctx);
 await vm.runInContext('runAgent("Hand in my maths homework on Teams","es")',ctx);
 assert.equal(acted.length,1,'clicked only after the yes');
 assert.match(bodies[1].log.at(-1),/user said no/);
 assert.deepEqual(desk.filter(m=>m.kind==='ask').length,2);assert.match(desk.find(m=>m.kind==='ask').question,/Hand in/);
 const done=desk.at(-1);assert.equal(done.kind,'done');assert.equal(done.summary,'Handed in your maths homework.');
 assert.ok(bodies[0].screenshot.startsWith('data:image/jpeg'));assert.equal(bodies[0].lang,'es');
});
test('agent clicks and types for real (DevTools input), like a person; falls back to page scripts',async()=>{
 const cmds=[];let attached=0;
 const chrome={debugger:{attach:async()=>{attached++},detach:async()=>{},sendCommand:async(t,m,p)=>{cmds.push([m,p])}},
  storage:{local:{get:async()=>({key:'clave-larga'})}},windows:{create:async()=>({id:9,tabs:[{id:5}]})},
  tabs:{get:async(id)=>({id,status:'complete',url:'https://open.spotify.com/',title:'Spotify'}),update:async()=>{},captureVisibleTab:async()=>'',query:async()=>[{id:1,url:'https://unevents.netlify.app/'}],sendMessage:async()=>{}},
  scripting:{executeScript:async({func,args})=>{if(func.name==='agentSnapshot')return[{result:{url:'https://open.spotify.com/',title:'Spotify',text:'',elements:['[3] input Search'],vw:1280,vh:800,dpr:2}}];
   if(args[0].peek)return[{result:{ok:true,label:'Search',x:400,y:60}}];return[{result:{ok:true}}]}},downloads:{download:async()=>{}}};
 const steps=[{type:'type',id:3,text:'Bohemian Rhapsody',submit:true,say:'Searching'},{type:'click_at',x:1200,y:700,risky:false,say:'Play'},{type:'press_key',key:'Escape',say:'Close'},{type:'done',summary:'Playing it.'}];
 const fetch=async()=>Response.json({action:steps.shift()});
 const ctx=vm.createContext({chrome,fetch,Response,console,setTimeout:(f,ms)=>{const t=setTimeout(f,ms>5000?ms:Math.min(ms,5));if(ms>5000)t.unref();return t},JARVIS_CONFIG:{url:'https://x.supabase.co',anonKey:'anon'},Date,String,Promise,Map,Math});
 vm.runInContext(fs.readFileSync('extension/agent.js','utf8'),ctx);
 await vm.runInContext('runAgent("Play Bohemian Rhapsody on Spotify","en")',ctx);
 const clicks=cmds.filter(([m,p])=>m==='Input.dispatchMouseEvent'&&p.type==='mousePressed').map(([,p])=>[p.x,p.y]);
 assert.deepEqual(clicks,[[400,60],[600,350]],'element centre, then screenshot pixels / dpr');
 assert.ok(cmds.some(([m,p])=>m==='Input.insertText'&&p.text==='Bohemian Rhapsody'));
 assert.ok(cmds.some(([m,p])=>m==='Input.dispatchKeyEvent'&&p.key==='Enter'&&p.type==='keyDown'));
 assert.ok(cmds.some(([m,p])=>m==='Input.dispatchKeyEvent'&&p.key==='Escape'));
 assert.equal(attached,1,'attached once per job');
});
test('watching: every 10 minutes, in its own minimised window, each enabled site is read and sent to Jarvis',async()=>{
 const store={key:'clave-larga'},session={},calls=[],opened=[],windows=[];
 const pages={'https://teams.microsoft.com/v2/':{signIn:false,text:'Actividad: nueva nota de Matemáticas'},'https://outlook.office.com/mail/inbox':{signIn:false,ready:true,items:[{id:'conv1',title:'Profesora García, Examen el viernes',text:'',url:'https://outlook.office.com/mail/inbox'}]},
  'https://www.instagram.com/cd.calvia/':{signIn:false,items:[{id:'ABC',title:'Nueva publicación',text:'Partido el sábado',url:'https://www.instagram.com/p/ABC/'}]}};
 let current='';const listeners={};const on=(n)=>({addListener:(f)=>(listeners[n]=f)});
 const chrome={storage:{local:{get:async(k)=>typeof k==='string'?{[k]:store[k]}:Object.fromEntries([].concat(k).map(x=>[x,store[x]])),set:async(o)=>Object.assign(store,o)},session:{get:async(k)=>({[k]:session[k]}),set:async(o)=>Object.assign(session,o)}},
  windows:{create:async(o)=>{windows.push(o);return {id:9,tabs:[{id:5}]}},get:async()=>({tabs:[{id:5}]})},
  tabs:{update:async(id,o)=>{current=o.url;opened.push(o.url)},get:async()=>({status:'complete'})},
  scripting:{executeScript:async(o)=>[{result:pages[current]}]},alarms:{onAlarm:on('alarm')},runtime:{onMessage:on('message')}};
 const fetch=async(url,opts)=>{const body=JSON.parse(opts.body);calls.push({url,body,key:opts.headers['x-jarvis-key']});
  if(body.action==='watch-config')return Response.json({teams:true,school:true,instagramOn:true,instagram:'cd.calvia'});
  return Response.json(body.source==='teams'?{added:1,called:true}:{baseline:true,added:0})};
 const ctx=vm.createContext({chrome,fetch,Response,JARVIS_CONFIG:{url:'https://x.supabase.co',anonKey:'anon'},setTimeout:(f)=>setTimeout(f,0),Date,console,String,Object,JSON});
 vm.runInContext(fs.readFileSync('extension/watch.js','utf8'),ctx);
 await vm.runInContext('watchAll(true)',ctx);
 const plain=(x)=>JSON.parse(JSON.stringify(x));
 assert.deepEqual(plain(windows),[{url:'about:blank',focused:false,state:'minimized'}]);
 assert.deepEqual(opened,['https://teams.microsoft.com/v2/','https://outlook.office.com/mail/inbox','https://www.instagram.com/cd.calvia/','about:blank']);
 assert.ok(calls.every(c=>c.url==='https://x.supabase.co/functions/v1/jarvis-call'&&c.key==='clave-larga'));
 assert.deepEqual(calls.slice(1).map(c=>[c.body.source,c.body.text||c.body.items[0].id]),[['teams','Actividad: nueva nota de Matemáticas'],['school','conv1'],['instagram','ABC']]);
 assert.deepEqual(plain(store.watchReport.report),{teams:'1 nuevo(s) · te he llamado',school:'listo (primera vez)',instagram:'listo (primera vez)'});
 // Not again until 10 minutes have passed.
 await vm.runInContext('watchAll()',ctx);assert.equal(calls.length,4);
});
test('Outlook in a minimised window: a debugger screenshot makes it draw; if that fails the window is shown unfocused, then minimised again',async()=>{
 const sent=[],updates=[];let drawn=false,shotFails=false;
 const chrome={debugger:{attach:async()=>{},detach:async()=>sent.push('detach'),sendCommand:async(t,m)=>{sent.push(m);if(m==='Page.captureScreenshot'){if(shotFails)throw Error('minimized');drawn=true}return {}}},
  tabs:{get:async()=>({windowId:9})},windows:{update:async(id,o)=>{updates.push(o.state);if(o.state==='normal')drawn=true}},
  storage:{local:{get:async()=>({})}},alarms:{onAlarm:{addListener(){}}},runtime:{onMessage:{addListener(){}}}};
 const ctx=vm.createContext({chrome,setTimeout:(f)=>setTimeout(f,0),Date,console,String,Object,JSON,Set,Promise});
 vm.runInContext(fs.readFileSync('extension/watch.js','utf8'),ctx);
 ctx.ready=async()=>drawn;
 assert.equal(await vm.runInContext('wakePage(5, ready, 30000)',ctx),true);
 assert.deepEqual(sent,['Emulation.setFocusEmulationEnabled','Page.captureScreenshot','detach']);assert.deepEqual(updates,[]);
 drawn=false;shotFails=true;sent.length=0;
 assert.equal(await vm.runInContext('wakePage(5, ready, 30000)',ctx),true);
 assert.deepEqual(updates,['normal','minimized']);assert.equal(sent.at(-1),'detach');
});

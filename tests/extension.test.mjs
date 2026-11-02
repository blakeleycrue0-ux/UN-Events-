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

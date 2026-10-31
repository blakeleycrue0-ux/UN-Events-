import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { startSignaling } from '../server/signaling.mjs';
const origin='http://127.0.0.1:8001';
async function connect(url){const s=new WebSocket(url,{origin});await once(s,'open');return s}
function read(s){return once(s,'message').then(([raw])=>JSON.parse(raw.toString()))}
test('authenticated pairing, private relay, rejection and revocation',async()=>{
 const token=crypto.randomBytes(32).toString('hex');const service=startSignaling({development:true,port:0,accessToken:token,origins:[origin]});await once(service.server,'listening');const url='ws://127.0.0.1:'+service.server.address().port+'/';
 try{
  const bad=await connect(url);const rejected=once(bad,'close');bad.send(JSON.stringify({type:'create',secret:'a'.repeat(48),accessToken:'invalid'}));assert.equal((await rejected)[0],1008);
  const camera=await connect(url),secret=crypto.randomBytes(24).toString('hex');let response=read(camera);camera.send(JSON.stringify({type:'create',secret,accessToken:token}));assert.equal((await response).type,'created');
  const stranger=await connect(url);const denied=once(stranger,'close');stranger.send(JSON.stringify({type:'join',secret:'b'.repeat(48)}));assert.equal((await denied)[0],1008);
  const viewer=await connect(url);response=read(viewer);const ready=read(camera);viewer.send(JSON.stringify({type:'join',secret}));assert.equal((await response).type,'joined');assert.equal((await ready).type,'viewer-ready');
  response=read(viewer);camera.send(JSON.stringify({type:'offer',sdp:'test-sdp'}));assert.equal((await response).sdp,'test-sdp');
  const closed=once(viewer,'close');camera.close();await closed;
  const revoked=await connect(url);const failed=once(revoked,'close');revoked.send(JSON.stringify({type:'join',secret}));assert.equal((await failed)[0],1008);
 }finally{await service.close()}
});
test('production refuses missing credentials, origins and TLS',()=>{
 assert.throws(()=>startSignaling({}),/token/);
 assert.throws(()=>startSignaling({accessToken:'x'.repeat(32)}),/origins/);
 assert.throws(()=>startSignaling({accessToken:'x'.repeat(32),origins:['https://example.com']}),/TLS/);
});

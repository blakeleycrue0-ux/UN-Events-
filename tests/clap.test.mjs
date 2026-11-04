import test from 'node:test';
import assert from 'node:assert/strict';
import {createClapDetector} from '../src/jarvis/clap.js';
// 10 ms chunks: [peak, rms] per chunk.
const quiet=(n)=>Array(n).fill([0.01,0.004]);
const clap=()=>[[0.9,0.35],[0.5,0.12],[0.15,0.04],[0.05,0.01],...quiet(14)];
const run=(chunks)=>{let n=0;const d=createClapDetector({onDouble:()=>n++});chunks.forEach(([p,r],i)=>d.feed(p,r,i*10));return {n,claps:d.claps}};
test('two claps 0.3 s apart wake Jarvis; one clap does not',()=>{
 assert.equal(run([...quiet(30),...clap(),...quiet(12),...clap(),...quiet(30)]).n,1);
 assert.equal(run([...quiet(30),...clap(),...quiet(100)]).n,0);
});
test('too far apart, speech and music are not claps',()=>{
 assert.equal(run([...quiet(30),...clap(),...quiet(120),...clap(),...quiet(30)]).n,0,'1.3 s apart');
 const word=[[0.5,0.2],[0.5,0.22],[0.45,0.2],[0.4,0.18],[0.4,0.18],[0.3,0.12],[0.2,0.08],...quiet(10)];
 assert.equal(run([...quiet(30),...word,...quiet(5),...word,...quiet(30)]).n,0,'sustained sounds');
 assert.equal(run([...quiet(30),...Array(200).fill([0.6,0.25])]).n,0,'loud music');
});
test('raw samples are cut into 10 ms chunks',()=>{
 let n=0;const d=createClapDetector({onDouble:()=>n++});const rate=48000;
 const buf=new Float32Array(rate*2);for(let i=0;i<buf.length;i++)buf[i]=(Math.random()*2-1)*0.005;
 for(const at of [0.5,0.85])for(let i=0;i<rate*0.02;i++)buf[Math.floor(at*rate)+i]=(Math.random()*2-1)*0.9*Math.exp(-i/(rate*0.006));
 d.samples(buf,rate,0);assert.equal(n,1);
});
test('beeps and tones (pure sounds) are not claps, even when sharp',()=>{
 let n=0;const d=createClapDetector({onDouble:()=>n++});const rate=48000;
 const buf=new Float32Array(rate*2);
 for(const at of [0.5,0.85])for(let i=0;i<rate*0.05;i++)buf[Math.floor(at*rate)+i]=0.9*Math.sin(2*Math.PI*1000*i/rate)*Math.exp(-i/(rate*0.01));
 d.samples(buf,rate,0);assert.equal(n,0);
});

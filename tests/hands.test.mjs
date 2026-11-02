import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const out=await build({entryPoints:['src/jarvis/hands.js'],bundle:true,format:'esm',write:false,platform:'neutral'});
const {pose,createGestureReader}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
const hand=(curls,thumb={curl:'full',direction:'horizontalLeft'},indexDir='verticalUp')=>({thumb,
 index:{curl:curls[0],direction:indexDir},middle:{curl:curls[1]},ring:{curl:curls[2]},pinky:{curl:curls[3]}});
test('finger curls become poses',()=>{
 assert.equal(pose(hand(['none','none','none','none'])),'palm');
 assert.equal(pose(hand(['full','full','half','full'])),'fist');
 assert.equal(pose(hand(['full','full','full','full'],{curl:'none',direction:'verticalUp'})),'thumbUp');
 assert.equal(pose(hand(['half','full','full','full'],{curl:'none',direction:'diagonalDownLeft'})),'thumbDown');
 assert.equal(pose(hand(['none','full','full','full'])),'point');
 assert.equal(pose(hand(['none','full','full','full'],undefined,'verticalDown')),'');
 assert.equal(pose(hand(['none','none','full','full'])),'');
 assert.equal(pose(null),'');
});
test('holding a pose fires once, with a cooldown; brief poses do nothing',()=>{
 const read=createGestureReader();let t=0;const feed=(p,x=0.5)=>read(p,x,t+=100);
 assert.equal(feed('palm'),'');for(let i=0;i<5;i++)assert.equal(feed('palm'),'');
 assert.equal(feed('palm'),'toggle');assert.equal(feed('palm'),'');
 for(let i=0;i<20;i++)feed('palm');t+=2000;
 assert.equal(feed('thumbUp'),'');for(let i=0;i<5;i++)feed('thumbUp');
 assert.equal(feed('thumbUp'),'louder');assert.equal(feed('thumbUp'),'','fires once per hold');
 const read2=createGestureReader();let u=0;
 assert.equal(read2('point',0.5,u+=100),'');assert.equal(read2('point',0.5,u+=200),'');assert.equal(read2('',null,u+=100),'');
 const fired=[];for(let i=0;i<7;i++) fired.push(read2('point',0.5,u+=100));
 assert.deepEqual(fired.filter(Boolean),['talk'],'a brief pose then a held one: exactly one action');
});
test('a quick sideways open hand is a swipe, not a pause',()=>{
 const read=createGestureReader();let t=0,got='';
 for(const x of [0.2,0.3,0.42,0.55]){got=read('palm',x,t+=80)||got;}
 assert.equal(got,'next');
 for(let i=0;i<5;i++) assert.equal(read('palm',0.55,t+=100),'','cooldown after a swipe');
 const back=createGestureReader();let u=0,g='';for(const x of [0.8,0.65,0.5,0.4]) g=back('palm',x,u+=80)||g;
 assert.equal(g,'previous');
 const pause=createGestureReader();let v=0,last='';for(let i=0;i<9;i++) last=pause('thumbUp',0.5+(i%2)*0.01,v+=100)||last;
 assert.equal(last,'louder');
});

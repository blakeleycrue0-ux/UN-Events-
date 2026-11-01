import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const scope={window:{}};
vm.runInNewContext(fs.readFileSync('src/detection.js','utf8'),scope);
const D=scope.window.SecurityDetection;
const width=256,height=144;
function image(x=null,light=100,noise=false) {
 const g=new Uint8Array(width*height).fill(light);
 if(x!==null) for(let y=60;y<78;y++) for(let col=x;col<x+7;col++) g[y*width+col]=220;
 if(noise) for(let y=2;y<height;y+=7) for(let x=2;x<width;x+=7) g[y*width+x]=200;
 return g;
}
test('small coherent foreground under 0.4% starts after confirmation; old 5.5% gate would miss it',()=>{
 const m=new D.Motion();m.analyze(image(),width,height,null,null,60,.5,0,250);
 let result=m.analyze(image(40),width,height,null,null,60,.5,250,250);assert.equal(result.confirmed,false);
 result=m.analyze(image(43),width,height,null,null,60,.5,500,250);
 result=m.analyze(image(46),width,height,null,null,60,.5,750,250);
 assert.equal(result.confirmed,true);assert.ok(7*18/(width*height)<.004);assert.ok(result.ratio<.01);assert.ok(result.bounds.w>0);
});
test('uniform exposure and isolated digital noise do not trigger',()=>{
 const m=new D.Motion();m.analyze(image(),width,height,null,null,60,.5,0,250);
 for(let i=1;i<8;i++) assert.equal(m.analyze(image(null,i%2?150:100),width,height,null,null,60,.5,i*250,250).moving,false);
 m.reset();m.analyze(image(),width,height,null,null,60,.5,0,250);
 assert.equal(m.analyze(image(null,100,true),width,height,null,null,60,.5,250,250).moving,false);
});
test('outside-zone and masked small motion are ignored; inside-zone motion remains detectable',()=>{
 const zone={x:0,y:0,w:.5,h:1},mask={x:0,y:.3,w:.3,h:.4};const m=new D.Motion();
 m.analyze(image(),width,height,zone,mask,60,.5,0,250);
 assert.equal(m.analyze(image(210),width,height,zone,mask,60,.5,250,250).moving,false);
 assert.equal(m.analyze(image(40),width,height,zone,mask,60,.5,500,250).moving,false);
 assert.equal(m.analyze(image(100),width,height,zone,mask,60,.5,750,250).moving,true);
});
test('overlapping scan crops stay within zone, return source coordinates and include feet',()=>{
 const z={x:.2,y:.1,w:.5,h:.8};
 for(let i=0;i<4;i++) {const r=D.detailRegion(z,null,i);assert.ok(r.x>=z.x && r.y>=z.y && r.x+r.w<=z.x+z.w+.00001 && r.y+r.h<=z.y+z.h+.00001);}
 const b=D.mapBox([.2,.2,.1,.6],z);assert.ok(Math.abs(b.x-.3)<.00001);assert.ok(Math.abs(b.h-.48)<.00001);
 assert.equal(D.personInside({x:.3,y:0,w:.1,h:.4},{x:.2,y:.3,w:.4,h:.3}),true);
 assert.equal(D.personInside({x:.8,y:.2,w:.1,h:.4},z),false);
});

test('general/detail passes retain the last observation briefly, deduplicate and expire',()=>{
 const old={x:.2,y:.2,w:.1,h:.3,score:.7,seen:100};
 assert.equal(D.mergePeople([], [old],2000,6000).length,1);
 const fresh={...old,score:.8,seen:2200};
 const merged=D.mergePeople([fresh],[old],2200,6000);
 assert.equal(merged.length,1);assert.equal(merged[0].seen,2200);
 assert.equal(D.mergePeople([], [old],6200,6000).length,0);
});

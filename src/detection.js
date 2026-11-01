"use strict";
// Pure geometry and frame analysis. No camera, network or UI side effects.
window.SecurityDetection = (() => {
  const full = { x: 0, y: 0, w: 1, h: 1 };
  const contains = (x, y, r) => !r || (x >= r.x && y >= r.y && x <= r.x+r.w && y <= r.y+r.h);
  function expand(rect, padding = .1, limit = full) {
    const x = Math.max(limit.x, rect.x-padding), y = Math.max(limit.y, rect.y-padding);
    const right = Math.min(limit.x+limit.w, rect.x+rect.w+padding);
    const bottom = Math.min(limit.y+limit.h, rect.y+rect.h+padding);
    return { x, y, w: Math.max(.001, right-x), h: Math.max(.001, bottom-y) };
  }
  function detailRegion(zone, motion, index) {
    const area = zone || full;
    if (motion && contains(motion.x+motion.w/2, motion.y+motion.h/2, area)) {
      const w = Math.max(area.w*.4, motion.w*2), h = Math.max(area.h*.5, motion.h*2);
      return expand({x:motion.x+motion.w/2-w/2,y:motion.y+motion.h/2-h/2,w,h},0,area);
    }
    // Overlapping quadrants. One at a time; a full-zone pass alternates with each detail.
    const w = area.w*.65, h = area.h*.65;
    return { x:area.x+(index%2 ? area.w-w : 0), y:area.y+(index%4>1 ? area.h-h : 0), w, h };
  }
  function mapBox(box, region) {
    return {x:region.x+box[0]*region.w,y:region.y+box[1]*region.h,w:box[2]*region.w,h:box[3]*region.h};
  }
  function personInside(box, zone) {
    return contains(box.x+box.w/2,box.y+box.h/2,zone) || contains(box.x+box.w/2,box.y+box.h,zone);
  }
  function mergePeople(found, previous, now, ttl) {
    const result = found.slice();
    for (const old of previous) {
      if (!old.seen || now-old.seen >= ttl) continue;
      const duplicate = found.some(p => {
        const w = Math.max(0, Math.min(p.x+p.w,old.x+old.w)-Math.max(p.x,old.x));
        const h = Math.max(0, Math.min(p.y+p.h,old.y+old.h)-Math.max(p.y,old.y));
        return w*h/Math.max(.00001,p.w*p.h+old.w*old.h-w*h)>.25;
      });
      if (!duplicate) result.push(old);
    }
    return result.slice(0,8);
  }
  class Motion {
    reset() { this.background=null; this.previous=null; this.since=null; this.lastHit=0; this.hits=0; }
    analyze(grey, width, height, zone, mask, sensitivity, confirmation, now, interval) {
      const n=grey.length;
      if (!this.background || this.background.length!==n) {
        this.background=Float32Array.from(grey); this.previous=grey.slice(); this.since=null; this.hits=0;
        return {moving:false,confirmed:false,ratio:0,bounds:null};
      }
      const valid=new Uint8Array(n), changed=new Uint8Array(n);
      let count=0, prevMean=0, baseMean=0;
      for(let i=0;i<n;i++) {
        const x=(i%width+.5)/width,y=(Math.floor(i/width)+.5)/height;
        if(!contains(x,y,zone) || (mask && contains(x,y,mask))) continue;
        valid[i]=1; count++; prevMean+=grey[i]-this.previous[i]; baseMean+=grey[i]-this.background[i];
      }
      prevMean/=Math.max(1,count); baseMean/=Math.max(1,count);
      const threshold=10+(100-sensitivity)*.18;
      let changedCount=0;
      for(let i=0;i<n;i++) if(valid[i] && Math.max(Math.abs(grey[i]-this.previous[i]-prevMean),Math.abs(grey[i]-this.background[i]-baseMean))>threshold) {changed[i]=1;changedCount++;}
      // A broad scene/exposure transition is not a small intrusion. Rebuild the reference.
      const sceneChange=changedCount/Math.max(1,count)>.65;
      const minimum=Math.max(6,Math.ceil(count*(.001+(100-sensitivity)*.00003)));
      const queue=new Int32Array(n); let largest=0,bounds=null;
      if(!sceneChange) for(let i=0;i<n;i++) {
        if(!changed[i]) continue;
        let head=0,tail=1,minX=i%width,maxX=minX,minY=Math.floor(i/width),maxY=minY;
        changed[i]=0;queue[0]=i;
        while(head<tail) {
          const at=queue[head++],x=at%width,y=Math.floor(at/width);
          minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
          const neighbours=[x>0?at-1:-1,x<width-1?at+1:-1,at>=width?at-width:-1,at<n-width?at+width:-1];
          for(const next of neighbours) if(next>=0 && changed[next]) {changed[next]=0;queue[tail++]=next;}
        }
        if(tail>=minimum && maxX-minX>=1 && maxY-minY>=2 && tail>largest) {
          largest=tail;bounds={x:minX/width,y:minY/height,w:(maxX-minX+1)/width,h:(maxY-minY+1)/height};
        }
      }
      const moving=largest>=minimum;
      const gap=Math.max(800,interval*1.8);
      if(moving) {
        if(this.since===null || now-this.lastHit>gap) {this.since=now;this.hits=0;}
        this.lastHit=now;this.hits++;
      } else if(sceneChange || now-this.lastHit>gap) {this.since=null;this.hits=0;}
      const confirmed=moving && this.hits>=2 && now-this.since>=confirmation*1000;
      for(let i=0;i<n;i++) this.background[i]=sceneChange?grey[i]:this.background[i]*.94+grey[i]*.06;
      this.previous=grey.slice();
      return {moving,confirmed,ratio:largest/Math.max(1,count),bounds,sceneChange,minimum};
    }
  }
  return {Motion,contains,expand,detailRegion,mapBox,personInside,mergePeople};
})();

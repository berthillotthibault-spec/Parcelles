// Génère les icônes 96 px des raccourcis PWA (n° 15) en PNG, sans dépendance :
// pictogrammes blancs dessinés par champs de distance, fond vert arrondi, anticrénelage 4x4.
// Usage : node tools/make-shortcut-icons.mjs
import {writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';

const S=96,BG=[0x17,0x66,0x3f],FG=[255,255,255];
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc=buf=>{let c=0xffffffff;for(const b of buf)c=crcTable[(c^b)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;};
function chunk(type,data){const out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length,0);out.write(type,4,'ascii');data.copy(out,8);out.writeUInt32BE(crc(out.subarray(4,8+data.length)),8+data.length);return out;}
function png(rgba){
  const raw=Buffer.alloc(S*(S*4+1));for(let y=0;y<S;y++){raw[y*(S*4+1)]=0;rgba.copy(raw,y*(S*4+1)+1,y*S*4,(y+1)*S*4);}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(S,0);ihdr.writeUInt32BE(S,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
// Primitives (coordonnées sur 96) : vrai si le point est dans la forme.
const seg=(ax,ay,bx,by,w)=>(x,y)=>{const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)));return Math.hypot(x-ax-t*dx,y-ay-t*dy)<=w/2;};
const disc=(cx,cy,r)=>(x,y)=>Math.hypot(x-cx,y-cy)<=r;
const ringS=(cx,cy,r,w)=>(x,y)=>Math.abs(Math.hypot(x-cx,y-cy)-r)<=w/2;
const rrect=(x0,y0,x1,y1,r)=>(x,y)=>{const qx=Math.max(x0+r-x,0,x-(x1-r)),qy=Math.max(y0+r-y,0,y-(y1-r));return x>=x0&&x<=x1&&y>=y0&&y<=y1&&Math.hypot(qx,qy)<=r;};
const minus=(a,b)=>(x,y)=>a(x,y)&&!b(x,y);
const any=(...fs)=>(x,y)=>fs.some(f=>f(x,y));
const ICONS={
  // Terrain : repère de position (goutte) avec point central.
  field:minus(any(disc(48,40,20),(x,y)=>y>=40&&y<=74&&Math.abs(x-48)<=20*(74-y)/34),disc(48,40,8)),
  // J'ai fait : coche épaisse.
  work:any(seg(28,50,42,64,10),seg(42,64,70,34,10)),
  // Photo : boîtier, objectif et viseur.
  photo:minus(any(rrect(22,34,74,70,8),rrect(38,27,58,38,4)),any(disc(48,52,12))),
  // Dicter : micro, arceau et pied.
  voice:any(rrect(40,22,56,56,8),minus(ringS(48,46,17,6),(x,y)=>y<46),seg(48,63,48,74,6),seg(38,74,58,74,6))
};
const background=rrect(0,0,95.999,95.999,22);
for(const [name,shape] of Object.entries(ICONS)){
  const rgba=Buffer.alloc(S*S*4);
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){
    let bg=0,fg=0;for(let i=0;i<4;i++)for(let j=0;j<4;j++){const px=x+(i+.5)/4,py=y+(j+.5)/4;if(background(px,py)){bg++;if(shape(px,py))fg++;}}
    const o=(y*S+x)*4,a=bg/16,f=bg?fg/bg:0;
    for(let c=0;c<3;c++)rgba[o+c]=Math.round(BG[c]*(1-f)+FG[c]*f);rgba[o+3]=Math.round(a*255);
  }
  const file=new URL(`../shortcut-${name}-96.png`,import.meta.url);writeFileSync(file,png(rgba));console.log('écrit',file.pathname);
}

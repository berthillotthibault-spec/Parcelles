// Générateur PDF vectoriel minimal (lot 2) : aucun accès réseau ni dépendance.
// Pages A4, texte en polices standard PDF (Helvetica, Times) encodé WinAnsi pour les accents
// français, €, « », espaces insécables ; traits, rectangles (arrondis), couleurs ; images JPEG
// insérées telles quelles (DCTDecode). Coordonnées en points depuis le coin HAUT gauche.
// Les fonctions de partage (navigator.share, téléchargement) ne touchent le DOM qu’à l’appel.

export const A4=[595.28,841.89];
export const mm=v=>v*72/25.4;

const WIDTH_SRC={
  helv:'278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,761,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500',
  helvB:'278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,761,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556',
  times:'250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541,761,500,0,333,500,444,1000,500,500,333,1000,556,333,889,0,611,0,0,333,333,444,444,350,500,1000,333,980,389,333,722,0,444,722,250,333,500,500,500,500,200,500,333,760,276,500,564,333,760,333,400,564,300,300,333,500,453,250,333,300,310,500,750,750,750,444,722,722,722,722,722,722,889,667,611,611,611,611,333,333,333,333,722,722,722,722,722,722,722,564,722,722,722,722,722,722,556,500,444,444,444,444,444,444,667,444,444,444,444,444,278,278,278,278,500,500,500,500,500,500,500,564,500,500,500,500,500,500,500,500',
  timesB:'250,333,555,500,500,1000,833,278,333,333,500,570,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,930,722,667,722,722,667,611,778,778,389,500,778,667,944,722,778,611,778,722,556,667,722,722,1000,722,722,667,333,278,333,581,500,333,500,556,444,556,444,333,500,556,278,333,556,278,833,556,500,556,556,444,389,333,556,500,722,500,500,444,394,220,394,520,761,500,0,333,500,500,1000,500,500,333,1000,556,333,1000,0,667,0,0,333,333,500,500,350,500,1000,333,1000,389,333,722,0,444,722,250,333,500,500,500,500,220,500,333,747,300,500,570,333,747,333,400,570,300,300,333,556,540,250,333,300,330,500,750,750,750,500,722,722,722,722,722,722,1000,722,667,667,667,667,389,389,389,389,722,722,778,778,778,778,778,570,778,722,722,722,722,722,611,556,500,500,500,500,500,500,722,444,444,444,444,444,278,278,278,278,500,556,500,500,500,500,500,570,500,556,556,556,556,500,556,500'
};
const BASE_FONTS={helv:'Helvetica',helvB:'Helvetica-Bold',times:'Times-Roman',timesB:'Times-Bold'};
const FONT_KEYS=Object.keys(BASE_FONTS);
const widthCache={};
const widths=font=>widthCache[font]||(widthCache[font]=WIDTH_SRC[font in WIDTH_SRC?font:'helv'].split(',').map(Number));

// Unicode → WinAnsi (cp1252). Les caractères sans équivalent sont simplifiés (accents retirés) ou remplacés par « ? ».
const CP1252={0x20AC:0x80,0x201A:0x82,0x0192:0x83,0x201E:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02C6:0x88,0x2030:0x89,0x0160:0x8A,0x2039:0x8B,0x0152:0x8C,0x017D:0x8E,0x2018:0x91,0x2019:0x92,0x201C:0x93,0x201D:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02DC:0x98,0x2122:0x99,0x0161:0x9A,0x203A:0x9B,0x0153:0x9C,0x017E:0x9E,0x0178:0x9F};
const SUBST={0x2212:0x2D,0x2010:0x2D,0x2011:0x2D,0x202F:0xA0,0x2007:0xA0,0x2009:0x20,0x200A:0x20,0x2002:0x20,0x2003:0x20,0x2032:0x27,0x2033:0x22,0x2192:0x3E,0x00D7:0xD7,0x2715:0x78,0x2713:0x76,0x00B7:0xB7,0x2027:0xB7,0x2219:0xB7,0x22C5:0xB7};
export function winAnsi(str){
  const out=[];
  for(const ch of String(str??'')){
    let c=ch.codePointAt(0);
    if(c===9||c===10||c===13)c=32;
    if(c<32||c===127||c===0x200B||c===0xAD||c===0xFEFF)continue;
    if(c<128||(c>=0xA0&&c<=0xFF)){out.push(c);continue;}
    if(CP1252[c]){out.push(CP1252[c]);continue;}
    if(SUBST[c]!==undefined){out.push(SUBST[c]);continue;}
    const base=ch.normalize('NFD').replace(/[̀-ͯ]/g,'');
    if(base&&base!==ch&&[...base].every(b=>b.codePointAt(0)<256)){for(const b of base)out.push(b.codePointAt(0));continue;}
    out.push(0x3F);
  }
  return out;
}
export function textWidth(str,font='helv',size=10){const w=widths(font);let t=0;for(const c of winAnsi(str))t+=c>=32?w[c-32]||0:0;return t*size/1000;}

// Découpe en lignes tenant dans maxWidth (coupure aux espaces, mots trop longs coupés). « \n » force une ligne.
export function wrapText(str,font='helv',size=10,maxWidth=200){
  const out=[];
  for(const para of String(str??'').split(/\r?\n/)){
    const words=para.split(/ +/).filter(w=>w!=='');if(!words.length){out.push('');continue;}
    let line='';
    for(let word of words){
      const tryLine=line?`${line} ${word}`:word;
      if(textWidth(tryLine,font,size)<=maxWidth){line=tryLine;continue;}
      if(line){out.push(line);line='';}
      while(textWidth(word,font,size)>maxWidth&&word.length>1){let cut=word.length-1;while(cut>1&&textWidth(word.slice(0,cut),font,size)>maxWidth)cut--;out.push(word.slice(0,cut));word=word.slice(cut);}
      line=word;
    }
    out.push(line);
  }
  return out;
}

const fmt=v=>{const n=Math.round((Number(v)||0)*1000)/1000;return Object.is(n,-0)?'0':String(n);};
const pdfStr=bytes=>{let s='(';for(const c of bytes){if(c===0x28||c===0x29||c===0x5C)s+='\\'+String.fromCharCode(c);else if(c<32||c>126)s+='\\'+c.toString(8).padStart(3,'0');else s+=String.fromCharCode(c);}return s+')';};
export function hexColor(hex,fallback=[0,0,0]){const m=String(hex||'').trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);if(!m)return fallback;let h=m[1];if(h.length===3)h=h.replace(/./g,'$&$&');return[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255);}
// Mélange d’une couleur avec du blanc (0 = blanc, 1 = couleur pleine) : teintes claires sans transparence.
export function tint(hex,amount){const c=hexColor(hex);const a=Math.max(0,Math.min(1,amount));return'#'+c.map(v=>Math.round((1-a)*255+a*v*255).toString(16).padStart(2,'0')).join('');}
const rgb=(hex,op)=>{const c=Array.isArray(hex)?hex:hexColor(hex);return`${c.map(fmt).join(' ')} ${op}`;};

// Lecture des dimensions d’un JPEG (marqueur SOF) : nécessaire à l’objet image.
export function jpegInfo(bytes){
  const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  if(b.length<4||b[0]!==0xFF||b[1]!==0xD8)return null;
  let i=2;
  while(i+9<b.length){
    if(b[i]!==0xFF){i++;continue;}
    const marker=b[i+1];
    if(marker===0xFF){i++;continue;}
    if(marker===0xD8||marker===0x01||(marker>=0xD0&&marker<=0xD7)){i+=2;continue;}
    const len=(b[i+2]<<8)|b[i+3];
    if(marker>=0xC0&&marker<=0xCF&&marker!==0xC4&&marker!==0xC8&&marker!==0xCC){
      const height=(b[i+5]<<8)|b[i+6],width=(b[i+7]<<8)|b[i+8],components=b[i+9];
      if(!width||!height)return null;
      return{width,height,components,colorSpace:components===1?'DeviceGray':components===4?'DeviceCMYK':'DeviceRGB'};
    }
    if(marker===0xD9||marker===0xDA)break;
    i+=2+len;
  }
  return null;
}
export function dataUrlBytes(url){
  const m=String(url||'').match(/^data:([^;,]+)?(;base64)?,(.*)$/s);if(!m)return null;
  if(!m[2])return new TextEncoder().encode(decodeURIComponent(m[3]));
  const bin=atob(m[3]);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;
}

class PdfPage{
  constructor(doc){this.doc=doc;this.ops=[];}
  get width(){return this.doc.width;}
  get height(){return this.doc.height;}
  // y = ligne de base du texte, mesurée depuis le haut de la page.
  text(str,x,y,{font='helv',size=10,color='#000000',align='left',angle=0,spacing=0,alpha=1}={}){
    const bytes=winAnsi(str);if(!bytes.length)return 0;
    const f=FONT_KEYS.includes(font)?font:'helv';
    let w=textWidth(str,f,size)+(spacing?spacing*Math.max(0,bytes.length-1):0);
    let tx=x;if(align==='right')tx=x-w;else if(align==='center')tx=x-w/2;
    const Y=this.height-y,fontRef=`/F${FONT_KEYS.indexOf(f)+1} ${fmt(size)} Tf`;
    let pos;
    if(angle){const a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);pos=`${fmt(c)} ${fmt(s)} ${fmt(-s)} ${fmt(c)} ${fmt(tx)} ${fmt(Y)} Tm`;}
    else pos=`${fmt(tx)} ${fmt(Y)} Td`;
    const gs=alpha<1?`/${this.doc.alpha(alpha)} gs `:'';
    this.ops.push(`${gs?'q '+gs:''}BT ${rgb(color,'rg')} ${fontRef} ${fmt(spacing)} Tc ${pos} ${pdfStr(bytes)} Tj ET${gs?' Q':''}`);
    return w;
  }
  // Rectangle : x, y = coin haut gauche. fill/stroke = couleur hexadécimale ; radius en points.
  rect(x,y,w,h,{fill=null,stroke=null,lineWidth=0.75,radius=0}={}){
    if(!fill&&!stroke)return;
    const Y=this.height-y-h;let path;
    const r=Math.max(0,Math.min(radius,w/2,h/2));
    if(!r)path=`${fmt(x)} ${fmt(Y)} ${fmt(w)} ${fmt(h)} re`;
    else{const k=r*0.5523,x1=x+w,y1=Y+h;path=[`${fmt(x+r)} ${fmt(Y)} m`,`${fmt(x1-r)} ${fmt(Y)} l`,`${fmt(x1-r+k)} ${fmt(Y)} ${fmt(x1)} ${fmt(Y+r-k)} ${fmt(x1)} ${fmt(Y+r)} c`,`${fmt(x1)} ${fmt(y1-r)} l`,`${fmt(x1)} ${fmt(y1-r+k)} ${fmt(x1-r+k)} ${fmt(y1)} ${fmt(x1-r)} ${fmt(y1)} c`,`${fmt(x+r)} ${fmt(y1)} l`,`${fmt(x+r-k)} ${fmt(y1)} ${fmt(x)} ${fmt(y1-r+k)} ${fmt(x)} ${fmt(y1-r)} c`,`${fmt(x)} ${fmt(Y+r)} l`,`${fmt(x)} ${fmt(Y+r-k)} ${fmt(x+r-k)} ${fmt(Y)} ${fmt(x+r)} ${fmt(Y)} c`,'h'].join(' ');}
    const paint=fill&&stroke?'B':fill?'f':'S';
    this.ops.push(`q ${fill?rgb(fill,'rg')+' ':''}${stroke?rgb(stroke,'RG')+` ${fmt(lineWidth)} w `:''}${path} ${paint} Q`);
  }
  line(x1,y1,x2,y2,{color='#000000',width=0.75,dash=null}={}){
    this.ops.push(`q ${rgb(color,'RG')} ${fmt(width)} w ${dash?`[${dash.map(fmt).join(' ')}] 0 d `:''}${fmt(x1)} ${fmt(this.height-y1)} m ${fmt(x2)} ${fmt(this.height-y2)} l S Q`);
  }
  image(img,x,y,w,h){if(!img)return;this.ops.push(`q ${fmt(w)} 0 0 ${fmt(h)} ${fmt(x)} ${fmt(this.height-y-h)} cm /${img.name} Do Q`);}
}

export class PdfDoc{
  constructor({width=A4[0],height=A4[1],title='',author='',subject='',creator='Parcelles'}={}){
    Object.assign(this,{width,height,title,author,subject,creator});this.pages=[];this.images=[];this.alphas=[];
  }
  // Opacité (ExtGState) : filigranes discrets par-dessus le contenu.
  alpha(a){const v=Math.round(Math.max(0,Math.min(1,a))*1000)/1000;let i=this.alphas.indexOf(v);if(i<0){this.alphas.push(v);i=this.alphas.length-1;}return`GS${i+1}`;}
  addPage(){const p=new PdfPage(this);this.pages.push(p);return p;}
  addJpeg(bytes){const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);const info=jpegInfo(b);if(!info)throw Error('Image JPEG illisible.');const img={name:`Im${this.images.length+1}`,bytes:b,...info};this.images.push(img);return img;}
  output(){
    if(!this.pages.length)this.addPage();
    const enc=s=>{const out=new Uint8Array(s.length);for(let i=0;i<s.length;i++)out[i]=s.charCodeAt(i)&0xFF;return out;};
    const chunks=[],offsets=[];let length=0;
    const push=part=>{const b=typeof part==='string'?enc(part):part;chunks.push(b);length+=b.length;};
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const nFonts=FONT_KEYS.length,firstFont=4,firstImage=firstFont+nFonts,firstGs=firstImage+this.images.length,firstPage=firstGs+this.alphas.length,total=firstPage+this.pages.length*2-1;
    const obj=(id,body,stream=null)=>{offsets[id]=length;push(`${id} 0 obj\n`);if(stream){push(`${body}\nstream\n`);push(stream);push('\nendstream\nendobj\n');}else push(`${body}\nendobj\n`);};
    const textString=s=>{const str=String(s||'');if(/^[\x20-\x7E]*$/.test(str))return pdfStr([...str].map(c=>c.charCodeAt(0)));let hex='FEFF';for(let i=0;i<str.length;i++)hex+=str.charCodeAt(i).toString(16).padStart(4,'0').toUpperCase();return`<${hex}>`;};
    const d=new Date(),p2=n=>String(n).padStart(2,'0'),date=`D:${d.getFullYear()}${p2(d.getMonth()+1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const kids=this.pages.map((_,i)=>`${firstPage+i*2} 0 R`).join(' ');
    obj(1,'<< /Type /Catalog /Pages 2 0 R >>');
    obj(2,`<< /Type /Pages /Kids [${kids}] /Count ${this.pages.length} >>`);
    obj(3,`<< /Producer (Parcelles pdf-lite) /Creator ${textString(this.creator)} /CreationDate (${date})${this.title?` /Title ${textString(this.title)}`:''}${this.author?` /Author ${textString(this.author)}`:''}${this.subject?` /Subject ${textString(this.subject)}`:''} >>`);
    FONT_KEYS.forEach((k,i)=>obj(firstFont+i,`<< /Type /Font /Subtype /Type1 /BaseFont /${BASE_FONTS[k]} /Encoding /WinAnsiEncoding >>`));
    this.images.forEach((img,i)=>obj(firstImage+i,`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /${img.colorSpace} /BitsPerComponent 8${img.colorSpace==='DeviceCMYK'?' /Decode [1 0 1 0 1 0 1 0]':''} /Filter /DCTDecode /Length ${img.bytes.length} >>`,img.bytes));
    this.alphas.forEach((a,i)=>obj(firstGs+i,`<< /Type /ExtGState /ca ${fmt(a)} /CA ${fmt(a)} >>`));
    const fonts=FONT_KEYS.map((_,i)=>`/F${i+1} ${firstFont+i} 0 R`).join(' '),xobj=this.images.length?` /XObject << ${this.images.map((img,i)=>`/${img.name} ${firstImage+i} 0 R`).join(' ')} >>`:'',gstates=this.alphas.length?` /ExtGState << ${this.alphas.map((_,i)=>`/GS${i+1} ${firstGs+i} 0 R`).join(' ')} >>`:'';
    this.pages.forEach((page,i)=>{
      const id=firstPage+i*2,content=enc(page.ops.join('\n'));
      obj(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(this.width)} ${fmt(this.height)}] /Resources << /Font << ${fonts} >>${xobj}${gstates} /ProcSet [/PDF /Text /ImageB /ImageC] >> /Contents ${id+1} 0 R >>`);
      obj(id+1,`<< /Length ${content.length} >>`,content);
    });
    const xref=length;let table=`xref\n0 ${total+1}\n0000000000 65535 f \n`;
    for(let id=1;id<=total;id++)table+=`${String(offsets[id]).padStart(10,'0')} 00000 n \n`;
    const idHex=Array.from({length:16},(_,i)=>((length*31+i*97+this.pages.length*13)&0xFF).toString(16).padStart(2,'0')).join('');
    push(`${table}trailer\n<< /Size ${total+1} /Root 1 0 R /Info 3 0 R /ID [<${idHex}> <${idHex}>] >>\nstartxref\n${xref}\n%%EOF\n`);
    const out=new Uint8Array(length);let o=0;for(const c of chunks){out.set(c,o);o+=c.length;}
    return out;
  }
}

// ---------- Mise en page en flux (titres, paragraphes, listes, tableaux) ----------
// Sert aux documents imprimables HTML (dossier de campagne, dossier de contrôle, rapports) :
// blocks = [{type:'h1'|'h2'|'h3'|'p'|'li'|'note'|'table'|'rule'|'pagebreak', text, rows, head, align}].
export function flowPdf(blocks,{title='',footer='',accent='#2f6b4a',author=''}={}){
  const doc=new PdfDoc({title,author}),M=mm(15),W=doc.width-2*M,BOTTOM=doc.height-mm(18);
  let page=null,y=0;
  const newPage=()=>{page=doc.addPage();y=M;};
  const ensure=h=>{if(!page||y+h>BOTTOM)newPage();};
  newPage();
  const para=(text,{font='helv',size=9.5,color='#172019',indent=0,gap=4,lead=1.38,bullet=''}={})=>{
    const lines=wrapText(text,font,size,W-indent);const lh=size*lead;
    lines.forEach((l,i)=>{ensure(lh);if(i===0&&bullet)page.text(bullet,M+indent-9,y+size,{font,size,color:accent});page.text(l,M+indent,y+size,{font,size,color});y+=lh;});
    y+=gap;
  };
  for(const b of blocks){
    if(b.type==='pagebreak'){if(y>M+1)newPage();continue;}
    if(b.type==='rule'){ensure(8);page.line(M,y+3,M+W,y+3,{color:'#d9d4c7',width:0.6});y+=10;continue;}
    if(b.type==='h1'){ensure(60);para(b.text,{font:'times',size:22,gap:8,lead:1.15});continue;}
    if(b.type==='h2'){ensure(70);y+=6;para(b.text,{font:'times',size:15,gap:2,lead:1.2});page.line(M,y,M+W,y,{color:accent,width:0.8});y+=8;continue;}
    if(b.type==='h3'){ensure(50);y+=3;para(b.text,{font:'helvB',size:10.5,gap:3,color:'#172019'});continue;}
    if(b.type==='li'){para(b.text,{indent:12,bullet:'•',gap:2});continue;}
    if(b.type==='note'){const lines=wrapText(b.text,'helv',8.8,W-20),h=lines.length*12+10;ensure(h);page.rect(M,y,W,h,{fill:tint(accent,0.07)});page.rect(M,y,2.2,h,{fill:accent});lines.forEach((l,i)=>page.text(l,M+12,y+16+i*12,{size:8.8,color:'#172019'}));y+=h+8;continue;}
    if(b.type==='p'){para(b.text,{font:b.bold?'helvB':'helv',size:b.small?8.5:9.5,color:b.muted?'#59625b':'#172019'});continue;}
    if(b.type==='table'){
      const rows=(b.rows||[]).filter(r=>r.length),head=b.head||[],cols=Math.max(head.length,...rows.map(r=>r.length),1),align=b.align||[];
      if(!rows.length&&!head.length)continue;
      // Largeurs : proportionnelles à la longueur du contenu, bornées.
      const need=Array.from({length:cols},(_,c)=>Math.max(textWidth(head[c]||'','helvB',7.5),...rows.slice(0,60).map(r=>Math.min(textWidth(r[c]||'','helv',8.5),220))));
      const sum=need.reduce((s,v)=>s+v+10,0)||1;let widthsC=need.map(v=>Math.max(36,(v+10)/sum*W));const k=W/widthsC.reduce((s,v)=>s+v,0);widthsC=widthsC.map(v=>v*k);
      const xs=widthsC.reduce((a,w,i)=>(a.push(i?a[i-1]+widthsC[i-1]:M),a),[]);
      const drawHead=()=>{if(!head.length)return;ensure(18);page.rect(M,y,W,16,{fill:accent});head.forEach((h,c)=>{const right=align[c]==='right';page.text(wrapText(String(h).toUpperCase(),'helvB',7,widthsC[c]-8)[0]||'',right?xs[c]+widthsC[c]-4:xs[c]+4,y+11,{font:'helvB',size:7,color:'#ffffff',align:right?'right':'left'});});y+=16;};
      ensure(40);drawHead();
      rows.forEach((r,ri)=>{
        const cells=Array.from({length:cols},(_,c)=>wrapText(r[c]??'','helv',8.5,widthsC[c]-8));const h=Math.max(...cells.map(l=>l.length))*11+7;
        if(y+h>BOTTOM){newPage();drawHead();}
        if(ri%2)page.rect(M,y,W,h,{fill:'#f6f4ee'});
        const font=b.bold?.[ri]?'helvB':'helv';cells.forEach((lines,c)=>{const right=align[c]==='right';lines.forEach((l,li)=>page.text(l,right?xs[c]+widthsC[c]-4:xs[c]+4,y+11+li*11,{font,size:8.5,color:'#172019',align:right?'right':'left'}));});
        y+=h;page.line(M,y,M+W,y,{color:'#e2ddd0',width:0.4});
      });
      y+=10;continue;
    }
  }
  const n=doc.pages.length;
  doc.pages.forEach((p,i)=>{p.line(M,doc.height-mm(12),M+W,doc.height-mm(12),{color:'#d9d4c7',width:0.5});if(footer)p.text(footer,M,doc.height-mm(8),{size:7.5,color:'#59625b'});p.text(`Page ${i+1}/${n}`,M+W,doc.height-mm(8),{size:7.5,color:'#59625b',align:'right'});});
  return doc.output();
}

// Convertit un document HTML imprimable (déjà analysé : Document) en blocs pour flowPdf.
export function htmlBlocks(root){
  const blocks=[],clean=s=>String(s||'').replace(/[ \t\r\n]+/g,' ').trim();
  const skip=el=>el.matches?.('script,style,svg,canvas,img,button,footer,.dz-foot,.dz-toolbar,.inv-draft-mark,[aria-hidden="true"],.dz-map,.dz-chart,.no-pdf');
  const BLOCK='p,h1,h2,h3,h4,h5,h6,table,ul,ol,li,dl,div,section,article,header,main,figure,blockquote';
  const walk=el=>{
    for(const node of el.children||[]){
      if(skip(node))continue;
      const tag=node.tagName.toLowerCase();
      if(/^h[1-3]$/.test(tag)){const t=clean(node.textContent);if(t)blocks.push({type:tag,text:t});continue;}
      if(/^h[4-6]$/.test(tag)){const t=clean(node.textContent);if(t)blocks.push({type:'h3',text:t});continue;}
      if(tag==='p'||tag==='figcaption'||tag==='address'||tag==='blockquote'){const t=clean(node.textContent);if(t)blocks.push({type:node.classList.contains('dz-note')?'note':'p',text:t,muted:node.classList.contains('muted')});continue;}
      if(tag==='li'){const t=clean(node.textContent);if(t)blocks.push({type:'li',text:t});continue;}
      if(tag==='figure'){const cap=clean(node.querySelector('figcaption')?.textContent);const t=node.querySelector('table');if(t)walk(node);else if(cap)blocks.push({type:'p',text:`Graphique : ${cap} (voir la version imprimable).`,muted:true,small:true});continue;}
      // Indicateurs (valeur + libellé) : tableau à deux colonnes.
      if(node.classList?.contains('dz-kpis')){const rows=[...node.children].map(k=>{const parts=[...k.children].map(c=>clean(c.textContent)).filter(Boolean);return parts.length>=2?[parts.slice(1).join(' '),parts[0]]:[clean(k.textContent),''];}).filter(r=>r[0]);blocks.push({type:'table',head:[],rows,align:['left','right']});continue;}
      if(tag==='table'){
        const head=[...node.querySelectorAll('thead th, thead td')].map(c=>clean(c.textContent));
        const body=[...node.querySelectorAll('tbody tr, tfoot tr')].length?[...node.querySelectorAll('tbody tr, tfoot tr')]:[...node.querySelectorAll('tr')].filter(r=>!r.closest('thead'));
        const rows=body.map(r=>[...r.children].map(c=>clean(c.textContent))),bold=body.map(r=>!!r.closest('tfoot'));
        const first=body[0]?[...body[0].children]:[];
        const align=(head.length?[...node.querySelectorAll('thead th, thead td')]:first).map(c=>c.classList.contains('n')?'right':'left');
        blocks.push({type:'table',head,rows,align,bold});continue;
      }
      if(tag==='dl'){const dts=[...node.querySelectorAll('dt')];blocks.push({type:'table',head:[],rows:dts.map(dt=>[clean(dt.textContent),clean(dt.nextElementSibling?.textContent)]),align:['left','left']});continue;}
      if(tag==='hr'){blocks.push({type:'rule'});continue;}
      if(node.classList?.contains('dz-cover')){walk(node);blocks.push({type:'pagebreak'});continue;}
      if(node.children?.length&&!node.querySelector(BLOCK)){const t=clean([...node.children].map(c=>c.textContent).join(' '));if(t)blocks.push({type:'p',text:t});continue;}
      if(node.children?.length){
        // Bloc conteneur : texte direct éventuel (ex. carte KPI) puis enfants.
        const own=[...node.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ').trim();
        if(own&&!node.querySelector('p,h1,h2,h3,table,li'))blocks.push({type:'p',text:clean(node.textContent)});
        else{if(own)blocks.push({type:'p',text:clean(own)});walk(node);}
        continue;
      }
      const t=clean(node.textContent);if(t)blocks.push({type:'p',text:t,small:tag==='small'});
      if(node.classList?.contains('dz-cover'))blocks.push({type:'pagebreak'});
    }
  };
  walk(root.body||root);
  return blocks;
}

// ---------- Remise du fichier (navigateur uniquement) ----------
export const safeFileName=s=>String(s||'document').replace(/(\d)\/(\d)/g,'$1-$2').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,120)||'document';
export function pdfFile(bytes,name){const n=safeFileName(name).replace(/\.pdf$/i,'')+'.pdf';try{return new File([bytes],n,{type:'application/pdf'});}catch{const b=new Blob([bytes],{type:'application/pdf'});b.name=n;return b;}}
export function canSharePdf(file){try{return !!(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]}));}catch{return false;}}
export function isTouchDevice(){try{return matchMedia('(pointer: coarse)').matches||/iPhone|iPad|iPod|Android/i.test(navigator.userAgent);}catch{return false;}}
// À appeler DANS le geste (clic) : sur iOS, navigator.share exige une activation utilisateur récente.
// Renvoie 'shared' | 'cancelled' | 'downloaded'.
export async function sharePdf(file,{title='',preferShare=true}={}){
  if(preferShare&&canSharePdf(file)){
    try{await navigator.share({files:[file],title:title||file.name});return'shared';}
    catch(error){if(error?.name==='AbortError')return'cancelled';}
  }
  downloadPdf(file);return'downloaded';
}
export function downloadPdf(file){
  const url=URL.createObjectURL(file),a=document.createElement('a');
  a.href=url;a.download=file.name||'document.pdf';a.rel='noopener';a.style.display='none';document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

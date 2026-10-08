// Facture et avoir en vrai fichier PDF (lot 2), sans dépendance : même contenu que l’aperçu HTML
// (invoiceView), mise en page A4 sobre. Logique pure : le logo arrive déjà converti en JPEG
// (fond blanc) par l’interface ; ici, aucun accès au DOM.
import {PdfDoc,mm,textWidth,wrapText,tint} from './pdf-lite.js';
import {invoiceView,invoiceFileName} from './invoices.js';

const INK='#172019',MUTED='#5d655f',RULE='#dcd7cb',ZEBRA='#f6f4ee';
export {invoiceFileName};

// logo : {bytes: Uint8Array JPEG} ou null.
export function invoicePdf(state,inv,{logo=null}={}){
  const v=invoiceView(state,inv),acc=v.accent;
  const doc=new PdfDoc({title:`${v.kind} ${v.number}${v.clientName?` - ${v.clientName}`:''}`,author:v.sellerName,subject:`${v.kind} ${v.number}`});
  const M=mm(15),W=doc.width-2*M,R=M+W,H=doc.height,BOTTOM=H-mm(24);
  let img=null;if(logo?.bytes){try{img=doc.addJpeg(logo.bytes);}catch{img=null;}}
  let page=null,y=0;

  const watermark=p=>{
    if(!v.draft)return;const size=92,word='BROUILLON',w=textWidth(word,'helvB',size)+4*(word.length-1),a=30*Math.PI/180,cx=doc.width/2,cy=H/2;
    p.text(word,cx-w/2*Math.cos(a)+size*0.33*Math.sin(a),cy+w/2*Math.sin(a)+size*0.33*Math.cos(a),{font:'helvB',size,color:'#9b3b2e',angle:30,spacing:4,alpha:0.09});
  };
  const newPage=(continued=false)=>{
    page=doc.addPage();page.rect(0,0,doc.width,5,{fill:acc});y=M;
    if(continued){
      page.text(`${v.kind} ${v.number} (suite)`,M,y+10,{font:'helvB',size:10,color:INK});
      page.text(v.clientName,R,y+10,{size:9,color:MUTED,align:'right'});
      y+=24;
    }
  };
  const para=(lines,x,yy,{font='helv',size=9,color=INK,lead=1.32,align='left'}={})=>{lines.forEach((l,i)=>page.text(l,x,yy+size+i*size*lead,{font,size,color,align}));return lines.length*size*lead;};

  // ---------- En-tête ----------
  newPage();
  const LW=W*0.52;let ly=y;
  if(img){const s=Math.min(165/img.width,58/img.height,1.2),w=img.width*s,h=img.height*s;page.image(img,M,ly,w,h);ly+=h+10;}
  const nameLines=wrapText(v.sellerName,'helvB',14,LW);ly+=para(nameLines,M,ly,{font:'helvB',size:14,lead:1.18})+3;
  const sellerLines=v.sellerLines.flatMap(l=>wrapText(l,'helv',8.6,LW));ly+=para(sellerLines,M,ly,{size:8.6,color:MUTED,lead:1.36});

  let ry=y;
  page.text(v.kind.toUpperCase(),R,ry+22,{font:'helvB',size:24,color:acc,align:'right',spacing:2.5});ry+=32;
  page.text(`N° ${v.number}`,R,ry+12,{font:'helvB',size:12,color:INK,align:'right'});ry+=20;
  if(v.stamp){const t=v.stamp.text.toUpperCase(),c=v.stamp.tone==='paid'?'#2f6b4a':'#9b3b2e',w=textWidth(t,'helvB',7.8)+0.8*(t.length-1)+16;page.rect(R-w,ry+2,w,17,{stroke:c,lineWidth:1.1,radius:3.5});page.text(t,R-8,ry+13.6,{font:'helvB',size:7.8,color:c,align:'right',spacing:0.8});ry+=26;}
  ry+=4;const valW=Math.max(60,...v.meta.map(([,x])=>textWidth(x,'helvB',9.2)));
  for(const [k,x] of v.meta){page.text(k,R-valW-12,ry+9,{size:9,color:MUTED,align:'right'});page.text(x,R,ry+9,{font:'helvB',size:9.2,color:INK,align:'right'});ry+=14;}
  y=Math.max(ly,ry)+12;page.line(M,y,R,y,{color:RULE,width:0.7});y+=16;

  // ---------- Règlement / client ----------
  const BW=(W-16)/2,PAD=11,inner=BW-2*PAD;
  const termLines=v.terms.lines.flatMap(l=>wrapText(l,'helv',8.8,inner));
  const bankLabelW=Math.max(0,...v.terms.bank.map(([k])=>textWidth(k,'helv',8.6)))+8;
  const termsH=14+termLines.length*11.6+(v.terms.bank.length?6+v.terms.bank.length*12:0);
  const clientName=wrapText(v.clientName,'helvB',11,inner),clientLines=v.clientLines.flatMap(l=>wrapText(l,'helv',8.8,inner));
  const clientH=14+clientName.length*13.5+clientLines.length*11.6;
  const boxH=Math.max(termsH,clientH)+2*PAD-4;
  page.rect(M,y,BW,boxH,{stroke:RULE,lineWidth:0.8,radius:6,fill:'#ffffff'});
  page.rect(M+BW+16,y,BW,boxH,{stroke:acc,lineWidth:1.3,radius:6,fill:tint(acc,0.05)});
  let by=y+PAD;page.text(v.terms.title.toUpperCase(),M+PAD,by+7,{font:'helvB',size:7,color:acc,spacing:1});by+=14;
  by+=para(termLines,M+PAD,by-2,{size:8.8,lead:1.32});
  if(v.terms.bank.length){by+=4;for(const [k,x] of v.terms.bank){page.text(k,M+PAD,by+9,{size:8.6,color:MUTED});page.text(x,M+PAD+bankLabelW,by+9,{font:'helvB',size:8.6,color:INK});by+=12;}}
  let cy=y+PAD;const cx=M+BW+16+PAD;page.text(v.clientLabel.toUpperCase(),cx,cy+7,{font:'helvB',size:7,color:acc,spacing:1});cy+=14;
  cy+=para(clientName,cx,cy-2,{font:'helvB',size:11,lead:1.22});para(clientLines,cx,cy,{size:8.8,lead:1.32});
  y+=boxH+18;

  // ---------- Lignes ----------
  const COLS=[['Désignation',W-268,'left'],['Quantité',72,'right'],['PU HT',72,'right'],['TVA',44,'right'],['Montant HT',80,'right']];
  const xs=COLS.reduce((a,c,i)=>(a.push(i?a[i-1]+COLS[i-1][1]:M),a),[]);
  const tableHead=()=>{page.rect(M,y,W,20,{fill:acc,radius:3});COLS.forEach(([h,w,al],i)=>page.text(h.toUpperCase(),al==='right'?xs[i]+w-7:xs[i]+7,y+13.2,{font:'helvB',size:7.2,color:'#ffffff',align:al,spacing:0.6}));y+=20;};
  tableHead();
  if(!v.rows.length){page.text('Aucune ligne.',M+7,y+15,{size:9,color:MUTED});y+=24;}
  v.rows.forEach((r,i)=>{
    const label=wrapText(r.label||'—','helv',9,COLS[0][1]-14),h=label.length*11.6+(r.date?10:0)+11;
    if(y+h>BOTTOM){newPage(true);tableHead();}
    if(i%2)page.rect(M,y,W,h,{fill:ZEBRA});
    para(label,xs[0]+7,y+3.5,{size:9,lead:1.29});if(r.date)page.text(r.date,xs[0]+7,y+5.5+label.length*11.6+6,{size:7.5,color:MUTED});
    const vals=[null,`${r.qty} ${r.unit}`,r.price,r.vat,r.total];
    vals.forEach((x,c)=>{if(c&&x)page.text(x,xs[c]+COLS[c][1]-7,y+12.5,{font:c===4?'helvB':'helv',size:9,color:INK,align:'right'});});
    y+=h;page.line(M,y,R,y,{color:'#e6e1d4',width:0.5});
  });
  y+=14;

  // ---------- Totaux (et note à gauche) ----------
  const TW=232,TX=R-TW,noteW=W-TW-18;
  const noteLines=v.note?v.note.split(/\r?\n/).flatMap(l=>wrapText(l,'helv',8.6,noteW-22)):[];
  const totalsH=v.totals.length*17+30+v.after.length*17+(v.missing?16:0),noteH=noteLines.length?24+noteLines.length*11.2:0;
  if(y+Math.max(totalsH,noteH)>BOTTOM)newPage(true);
  if(noteLines.length){page.rect(M,y,noteW,noteH,{fill:tint(acc,0.06),radius:4});page.rect(M,y,2.4,noteH,{fill:acc});page.text('NOTE',M+12,y+14,{font:'helvB',size:7,color:acc,spacing:1});para(noteLines,M+12,y+17,{size:8.6,lead:1.3});}
  let ty=y;
  for(const [k,x] of v.totals){page.text(k,TX+8,ty+12,{size:9,color:INK});page.text(x,R-8,ty+12,{size:9,color:INK,align:'right'});ty+=17;page.line(TX,ty,R,ty,{color:'#ece7db',width:0.5});}
  ty+=4;page.rect(TX,ty,TW,26,{fill:acc,radius:5});page.text(v.grand[0],TX+10,ty+17,{font:'helvB',size:11,color:'#ffffff'});page.text(v.grand[1],R-10,ty+17,{font:'helvB',size:12,color:'#ffffff',align:'right'});ty+=30;
  v.after.forEach(([k,x],i)=>{const f=i?'helvB':'helv';page.text(k,TX+8,ty+12,{font:f,size:9,color:INK});page.text(x,R-8,ty+12,{font:f,size:9,color:INK,align:'right'});ty+=17;});
  if(v.missing){page.text(`${v.missing} ligne${v.missing>1?'s':''} sans prix : non comptée${v.missing>1?'s':''}.`,R,ty+10,{size:8,color:'#9b3b2e',align:'right'});ty+=16;}
  y=Math.max(ty,y+noteH)+20;

  // ---------- Mentions légales ----------
  const legal=v.legal.flatMap((l,i)=>[...(i?['']:[]),...wrapText(l,'helv',7.6,W)]).map(l=>l);
  if(y+24>BOTTOM)newPage(true);
  page.line(M,y,R,y,{color:RULE,width:0.6});y+=6;
  for(const l of legal){if(!l){y+=3;continue;}if(y+10>BOTTOM){newPage(true);}page.text(l,M,y+8,{size:7.6,color:MUTED});y+=10.2;}

  // ---------- Pied de page ----------
  const n=doc.pages.length,foot=wrapText(v.footer,'helv',7.4,W-110)[0]||'';
  doc.pages.forEach((p,i)=>{watermark(p);p.line(M,H-mm(15),R,H-mm(15),{color:RULE,width:0.5});p.text(foot,M,H-mm(10.5),{size:7.4,color:MUTED});p.text(`${v.kind} ${v.number} · page ${i+1}/${n}`,R,H-mm(10.5),{size:7.4,color:MUTED,align:'right'});});
  return doc.output();
}

// Générateur PDF maison (lot 2) : structure valide, accents WinAnsi, image JPEG, pagination,
// et facture PDF complète (numéro, nom de fichier, logo, filigrane du brouillon).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PdfDoc,flowPdf,jpegInfo,textWidth,winAnsi,wrapText,dataUrlBytes,safeFileName} from './pdf-lite.js';
import {Store} from './state.js';
import {createDraft,emitInvoice,saveSettings,validateSettings,invoiceSettings,invoiceHtml,LOGO_MAX_BYTES} from './invoices.js';
import {invoicePdf,invoiceFileName} from './invoice-pdf.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const JPEG_B64='/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAACAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgACAAQAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMABAQEBAQEBgQEBgkGBgYJDAkJCQkMDwwMDAwMDxIPDw8PDw8SEhISEhISEhUVFRUVFRkZGRkZHBwcHBwcHBwcHP/bAEMBBAUFBwcHDAcHDB0UEBQdHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHf/dAAQAAf/aAAwDAQACEQMRAD8A8pooorjPiT//2Q==';
const jpeg=()=>Uint8Array.from(Buffer.from(JPEG_B64,'base64'));
const latin=bytes=>Buffer.from(bytes).toString('latin1');

// Contrôle structurel : en-tête, objets, table xref cohérente avec les offsets réels, trailer.
function checkPdf(bytes){
  const s=latin(bytes);
  assert.ok(s.startsWith('%PDF-1.4\n'),'en-tête %PDF-1.4');
  assert.ok(s.trimEnd().endsWith('%%EOF'),'fin %%EOF');
  const startxref=Number(s.match(/startxref\n(\d+)\n%%EOF\s*$/)[1]);
  assert.equal(s.slice(startxref,startxref+4),'xref','startxref pointe sur la table xref');
  const [,first,count]=s.slice(startxref).match(/^xref\n(\d+) (\d+)\n/);assert.equal(Number(first),0);
  const size=Number(s.match(/trailer\n<< \/Size (\d+) /)[1]);assert.equal(size,Number(count),'/Size = nombre d’entrées');
  const table=s.slice(startxref).split('\n').slice(2,2+Number(count));
  assert.equal(table[0],'0000000000 65535 f ');
  for(let id=1;id<Number(count);id++){
    const m=table[id].match(/^(\d{10}) 00000 n $/);assert.ok(m,`entrée xref ${id} de 20 octets`);
    assert.equal(s.slice(Number(m[1]),Number(m[1])+String(id).length+6),`${id} 0 obj`,`offset de l’objet ${id}`);
  }
  for(const m of s.matchAll(/<< \/Length (\d+)[^\n]*>>\nstream\n/g)){const start=m.index+m[0].length,len=Number(m[1]);assert.equal(s.slice(start+len,start+len+10),'\nendstream','longueur de flux exacte');}
  assert.match(s,/\/Root 1 0 R/);assert.match(s,/\/Type \/Catalog/);
  return{s,pages:Number(s.match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/)[1])};
}

test('structure PDF valide, accents français encodés WinAnsi, couleurs et formes',()=>{
  const doc=new PdfDoc({title:'Facture été'});const p=doc.addPage();
  p.text('Été : 1 234,50 € « réglé » l’an dernier — œuvre',40,60,{size:12,color:'#2f6b4a'});
  p.rect(40,80,200,40,{fill:'#2f6b4a',radius:6});p.rect(40,130,200,40,{stroke:'#9b3b2e'});p.line(40,180,300,180,{color:'#cccccc',dash:[2,2]});
  p.text('BROUILLON',100,400,{size:60,angle:30,alpha:0.1});
  const {s,pages}=checkPdf(doc.output());assert.equal(pages,1);
  for(const [code,label] of [['\\311','É'],['\\351','é'],['\\200','€'],['\\253','«'],['\\273','»'],['\\222','’'],['\\240','espace insécable'],['\\227','tiret cadratin'],['\\234','œ']])assert.ok(s.includes(code),`${label} encodé (${code})`);
  assert.match(s,/\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/);assert.match(s,/\/BaseFont \/Times-Roman/);
  assert.match(s,/0\.184 0\.42 0\.29 rg/,'couleur de remplissage');assert.match(s,/ re f Q|c h f Q/);assert.match(s,/\/ExtGState << \/GS1/,'opacité du filigrane');
  assert.match(s,/\/Title <FEFF/,'titre Unicode (UTF-16)');
});

test('WinAnsi : substitutions, largeurs et coupure de lignes',()=>{
  assert.deepEqual(winAnsi('−2'),[0x2D,0x32],'signe moins');assert.deepEqual(winAnsi('ŝ'),[0x73],'accent inconnu retiré');assert.deepEqual(winAnsi('中'),[0x3F]);
  assert.deepEqual(winAnsi('a\nb'),[0x61,0x20,0x62]);
  assert.equal(Math.round(textWidth('Hello','helv',10)*100)/100,22.78);assert.ok(textWidth('r','helvB',10)>textWidth('r','helv',10));
  const lines=wrapText('Pressage de balles rondes avec reprise et transport jusqu’au hangar du client','helv',9,120);
  assert.ok(lines.length>2);for(const l of lines)assert.ok(textWidth(l,'helv',9)<=120,l);
  assert.deepEqual(wrapText('a\nb','helv',9,100),['a','b']);assert.ok(wrapText('x'.repeat(300),'helv',9,50).length>3,'mot trop long coupé');
  assert.equal(safeFileName('Facture F2026/0001 : "A"'),'Facture F2026-0001 A');assert.equal(safeFileName('Dossier 2026/27 · Banque'),'Dossier 2026-27 · Banque');
});

test('image JPEG insérée telle quelle (DCTDecode) avec ses dimensions',()=>{
  const bytes=jpeg();assert.deepEqual(jpegInfo(bytes),{width:16,height:8,components:3,colorSpace:'DeviceRGB'});
  assert.equal(jpegInfo(new Uint8Array([1,2,3,4])),null);assert.throws(()=>new PdfDoc().addJpeg(new Uint8Array(10)),/JPEG/);
  const doc=new PdfDoc(),img=doc.addJpeg(bytes);doc.addPage().image(img,40,40,120,60);const out=doc.output(),{s}=checkPdf(out);
  assert.match(s,/\/Subtype \/Image \/Width 16 \/Height 8 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode \/Length 775/);
  assert.ok(Buffer.from(out).includes(Buffer.from(bytes)),'octets JPEG intacts');assert.match(s,/\/Im1 Do/);
  assert.deepEqual(dataUrlBytes('data:image/jpeg;base64,'+JPEG_B64),bytes);
});

test('mise en page en flux : plusieurs pages numérotées, tableau répété',()=>{
  const blocks=[{type:'h1',text:'Dossier de campagne 2026/27'},{type:'h2',text:'Parcelles'},{type:'table',head:['Parcelle','Surface'],align:['left','right'],rows:Array.from({length:90},(_,i)=>[`Parcelle n° ${i+1}`,`${i+1},5 ha`])},...Array.from({length:40},(_,i)=>({type:i%5?'p':'li',text:`Paragraphe ${i+1} avec des accents : récolte, blé, maïs.`}))];
  const {s,pages}=checkPdf(flowPdf(blocks,{title:'Dossier',footer:'Dossier de campagne'}));
  assert.ok(pages>=3,`${pages} pages`);assert.ok(s.includes(`(Page 1/${pages})`)&&s.includes(`(Page ${pages}/${pages})`),'numéros de page');
  assert.ok((s.match(/\(PARCELLE\)/g)||[]).length>=2,'en-tête de tableau répété sur la page suivante');
});

class MemoryStorage{constructor(){this.value=null;}async init(){}async get(){return this.value;}async set(_k,v){this.value=structuredClone(v);}async backupPut(){}async pruneBackups(){}async blobDelete(){}}
const SETTINGS={legalName:'EARL du Sougey',legalForm:'EARL au capital de 7 500 €',address:'1 route du Sougey\n01340 Montrevel',siret:'12345678900012',vatNumber:'FR12345678901',iban:'FR7630006000011234567890189',bic:'AGRIFRPP',paymentDays:30,vatRate:20,prefix:'F'};

test('facture PDF : numéro, plusieurs pages, logo, filigrane du brouillon, nom de fichier',async()=>{
  const store=new Store(new MemoryStorage());await store.init();await store.setPreferences({autoBackup:false});
  await store.upsert('clients',{id:'c1',name:'GAEC du Bois',address:'Le Bois, 01000 Bourg'});
  const logo='data:image/jpeg;base64,'+JPEG_B64;
  await saveSettings(store,{...SETTINGS,accent:'#7d2f3a',logo});
  assert.equal(invoiceSettings(store.state).logo,logo);assert.equal(invoiceSettings(store.state).accent,'#7d2f3a');
  const lines=Array.from({length:45},(_,i)=>({label:`Prestation n° ${i+1} : moisson du blé, transport « bord de champ »`,quantity:2+i%3,unit:'h',unitPrice:55,vatRate:i%4?20:10,date:'2026-09-15'}));
  const draft=await createDraft(store,{clientId:'c1',lines,today:'2026-10-01'});
  const d=checkPdf(invoicePdf(store.state,store.get('integrationImports',draft.id),{logo:{bytes:jpeg()}}));
  assert.match(d.s,/\(BROUILLON\)/,'filigrane du brouillon');assert.match(d.s,/\/DCTDecode/,'logo inséré');
  const inv=await emitInvoice(store,draft.id,{today:'2026-10-01'});
  assert.equal(inv.seller.logo,undefined,'le logo n’est pas recopié dans chaque facture émise');assert.equal(inv.seller.accent,'#7d2f3a');
  const {s,pages}=checkPdf(invoicePdf(store.state,inv,{logo:{bytes:jpeg()}}));
  assert.ok(pages>=2,`${pages} pages`);assert.ok(s.includes('(N\\260 F2026-0001)'),'numéro de facture');assert.ok(!/\(BROUILLON\)/.test(s));
  for(const t of ['(FACTURE)','(Total TTC)','(GAEC du Bois)','(IBAN)','(FR76 3000 6000 0112 3456 7890 189)'])assert.ok(s.includes(t),t);
  assert.ok(s.includes(`page ${pages}/${pages})`),'pagination');assert.match(s,/0\.49 0\.184 0\.227 rg/,'couleur d’accent');
  assert.equal(invoiceFileName(inv),'Facture F2026-0001 - GAEC du Bois.pdf');
  assert.equal(invoiceFileName({docType:'avoir',number:'F2026-0002',clientName:'A/B'}),'Avoir F2026-0002 - A B.pdf');
  // Sans logo : PDF valide sans image ; l’aperçu HTML reprend logo et couleur.
  assert.ok(!/DCTDecode/.test(checkPdf(invoicePdf(store.state,inv)).s));
  const html=invoiceHtml(store.state,inv);assert.ok(html.includes(logo)&&html.includes('--acc:#7d2f3a'));
});

test('logo : format et taille contrôlés, champ facultatif',()=>{
  assert.equal(validateSettings({...SETTINGS,logo:''}).value.logo,'');
  assert.equal(validateSettings({...SETTINGS}).value.accent,'#2f6b4a','vert Parcelles par défaut');
  assert.match(validateSettings({...SETTINGS,logo:'data:image/svg+xml;base64,PHN2Zz4='}).error,/Logo invalide/);
  assert.match(validateSettings({...SETTINGS,logo:'data:image/png;base64,'+'A'.repeat(Math.ceil(LOGO_MAX_BYTES*4/3)+8)}).error,/150 Ko/);
  assert.equal(invoiceSettings({exploitation:{invoicing:{logo:'javascript:alert(1)'}}}).logo,'','logo invalide ignoré');
});

test('fichiers servis et accroches',()=>{
  for(const f of ['./pdf-lite.js','./invoice-pdf.js']){assert.ok(read('sw.js').includes(`'${f}'`),`${f} dans CORE`);assert.ok(read('runtime.js').includes(`'${f}'`),`${f} vérifié par le diagnostic`);}
  const ui=read('invoices-ui.js');assert.match(ui,/Partager \/ imprimer le PDF/);assert.match(ui,/Télécharger le PDF/);assert.match(ui,/Retirer le logo/);
  assert.match(read('dossier-ui.js'),/data-dossier="viewer-pdf"/);assert.match(read('design-v3.css'),/Factures v2/);
});

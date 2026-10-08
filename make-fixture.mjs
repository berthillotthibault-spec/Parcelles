#!/usr/bin/env node
/*
 * Génère le jeu de test ANONYMISÉ fixtures/parcelles-fictives.* (SHP, SHX, DBF, PRJ et ZIP)
 * à partir d'un export « Mes Parcelles » réel, sans rien publier du réel.
 *
 *   node tools/make-fixture.mjs <export.shp> [dossier-de-sortie]
 *   (le .shx, le .dbf et le .prj sont cherchés à côté du .shp)
 *
 * Ce qui est conservé (structure utile aux tests) :
 * - Polygon (type 5), coordonnées Lambert-93 et PRJ RGF93 / Lambert-93 ;
 * - le schéma DBF complet (mêmes champs, types et longueurs), dBase III, pilote de langue
 *   Windows-1252 (0x03), libellés accentués ;
 * - les libellés agronomiques génériques (cultures, destinations, sols, unités, dates).
 *
 * Ce qui est anonymisé :
 * - un sous-ensemble des parcelles seulement (une sur cinq) ;
 * - géométries : symétrie gauche-droite, déplacement vers une zone sans rapport avec
 *   l'exploitation et bruit de quelques mètres sur chaque sommet ; la surface est recalculée ;
 * - SIRET, PACAGE, code et raison sociale de l'exploitation, noms et numéros des parcelles,
 *   îlots, identifiants (GUID), communes et codes INSEE remplacés par des valeurs fictives ;
 * - tout autre champ texte non générique (commentaires, analyses, laboratoire…) vidé.
 *
 * Le résultat est déterministe : relancer le script redonne exactement les mêmes octets.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {crc32} from '../zip-lite.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [shpArg,outArg]=process.argv.slice(2);
if(!shpArg){console.error('Usage : node tools/make-fixture.mjs <export.shp> [dossier-de-sortie]');process.exit(2);}
const sibling=ext=>{
  const dir=path.dirname(shpArg),base=path.basename(shpArg).replace(/\.shp$/i,'').normalize('NFC');
  const hit=fs.readdirSync(dir).find(f=>f.normalize('NFC').toLowerCase()===(base+ext).toLowerCase());
  if(!hit)throw new Error(`Fichier ${base}${ext} introuvable à côté du .shp.`);
  return path.join(dir,hit);
};
const outDir=path.resolve(outArg||path.join(root,'fixtures'));
const BASE='parcelles-fictives';
const ZIP_BASE='Export_Fictif_Spécifique (SHP)';
const KEEP_EVERY=5;

// ---------- Lecture SHP (Polygon, en Lambert-93) ----------
const shpIn=fs.readFileSync(shpArg);
if(shpIn.readInt32BE(0)!==9994||shpIn.readInt32LE(32)!==5)throw new Error('SHP attendu : Polygon (type 5).');
const shapes=[];
for(let o=100;o<shpIn.length;){
  const len=shpIn.readInt32BE(o+4)*2,c=o+8;
  const numParts=shpIn.readInt32LE(c+36),numPoints=shpIn.readInt32LE(c+40);
  const parts=[];for(let i=0;i<numParts;i++)parts.push(shpIn.readInt32LE(c+44+4*i));
  const pts=[];const p0=c+44+4*numParts;
  for(let i=0;i<numPoints;i++)pts.push([shpIn.readDoubleLE(p0+16*i),shpIn.readDoubleLE(p0+16*i+8)]);
  shapes.push(parts.map((start,i)=>pts.slice(start,i+1<numParts?parts[i+1]:numPoints)));
  o+=8+len;
}

// ---------- Lecture DBF brute (on recopie les octets des champs génériques) ----------
const dbfIn=fs.readFileSync(sibling('.dbf'));
const recordCount=dbfIn.readUInt32LE(4),headerLength=dbfIn.readUInt16LE(8),recordLength=dbfIn.readUInt16LE(10);
if(recordCount!==shapes.length)throw new Error(`DBF (${recordCount}) et SHP (${shapes.length}) ne concordent pas.`);
if(dbfIn[29]!==0x03)throw new Error('DBF attendu avec le pilote de langue Windows-1252 (0x03).');
const fields=[];
for(let o=32,pos=1;o+32<=headerLength&&dbfIn[o]!==0x0d;o+=32){
  const name=dbfIn.subarray(o,o+11).toString('latin1').replace(/\0.*$/,'');
  const f={name,type:String.fromCharCode(dbfIn[o+11]),length:dbfIn[o+16],decimals:dbfIn[o+17],offset:pos};
  fields.push(f);pos+=f.length;
}
const field=Object.fromEntries(fields.map(f=>[f.name,f]));
const rawText=(rec,name)=>rec.subarray(field[name].offset,field[name].offset+field[name].length).toString('latin1').trim();

// Champs texte génériques, sans rien d'identifiant : copiés tels quels.
const GENERIC=/^(TYPE_PARC|CP_CULTU|CP_CODCULT|CODE_GNIS|VARIETE|DESTIN_EDI|DESTINATIO|RESIDU_EDI|RESIDUS|UNITE_EDI|UNITE_RDT|C_PREC_EDI|CULT_PREC|C_PRE2_EDI|CULT_PREC2|CIP_|CIS_|TYPE_SOL|TYPSOL_EDI|OUTIL_PILO|U_|M_)/;

// ---------- Valeurs fictives ----------
const NAMES=['LES GRANDS PRÉS','CHAMP DU CHÊNE','LA NOUE FLEURIE','BOIS DORÉ',"PRÉ DE L'ÉTANG",'LES ÉCHALIERS',"COMBE À L'ÂNE",'GRAND CLOS','PETIT PRÉ','LA FONTAINE','LES ÉPINETTES','SOUS LA CÔTE','LE VERGER','LA BRUYÈRE','LES PÂTIS','CROIX BLANCHE','LE MOULIN','LA GRAVIÈRE','LES TILLEULS','CHAMP NOËL','PRÉ CARRÉ','LA FORÊT'];
const COMMUNES=[['99901','Saint-Fictif-en-Bresse'],['99902','Bourg-Imaginaire'],['99903','Les Prés-Dorés'],["99904","Val-d'Ève"]];
const FARM={SIRET:'99999999900019',PACAGE:'099999999',CODE_EXPLO:'FICTIF0001',RAIS_SOCIA:'EARL DU PRÉ FICTIF'};
const fakeGuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

// ---------- Géométrie fictive ----------
const [minX,minY,maxX,maxY]=[shpIn.readDoubleLE(36),shpIn.readDoubleLE(44),shpIn.readDoubleLE(52),shpIn.readDoubleLE(60)];
const cx=(minX+maxX)/2,cy=(minY+maxY)/2;
const TARGET=[680000,6650000]; // zone sans rapport avec l'exploitation réelle
const noise=(x,y,salt)=>{ // déterministe, fonction du sommet d'origine : les sommets partagés le restent
  let h=Math.imul(Math.round(x*100)^0x9e3779b1,0x85ebca6b)^Math.imul(Math.round(y*100)+salt,0xc2b2ae35);
  h^=h>>>15;h=Math.imul(h,0x27d4eb2d);h^=h>>>13;
  return((h>>>0)/0xffffffff-0.5)*4; // ±2 m
};
const round=v=>Math.round(v*1000)/1000;
const transformRing=ring=>ring
  .map(([x,y])=>[round(TARGET[0]-(x-cx)+noise(x,y,1)),round(TARGET[1]+(y-cy)+noise(x,y,2))])
  .reverse(); // la symétrie inverse le sens : on le rétablit (anneau extérieur horaire)
const ringArea=ring=>{let s=0;for(let i=0;i+1<ring.length;i++)s+=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];return s/2;};

// ---------- Encodage Windows-1252 ----------
const CP1252={0x20ac:0x80,0x201a:0x82,0x0192:0x83,0x201e:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02c6:0x88,0x2030:0x89,0x0160:0x8a,0x2039:0x8b,0x0152:0x8c,0x017d:0x8e,0x2018:0x91,0x2019:0x92,0x201c:0x93,0x201d:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02dc:0x98,0x2122:0x99,0x0161:0x9a,0x203a:0x9b,0x0153:0x9c,0x017e:0x9e,0x0178:0x9f};
const cp1252=text=>Buffer.from([...text.normalize('NFC')].map(ch=>{
  const c=ch.codePointAt(0);if(c<0x80||(c>=0xa0&&c<=0xff))return c;if(CP1252[c])return CP1252[c];
  throw new Error(`Caractère non représentable en Windows-1252 : ${ch}`);
}));
const putText=(rec,name,value)=>{const f=field[name],b=cp1252(value);if(b.length>f.length)throw new Error(`${name} trop long`);rec.fill(0x20,f.offset,f.offset+f.length);b.copy(rec,f.offset);};
const putNumber=(rec,name,value)=>{const f=field[name],s=value.toFixed(f.decimals).padStart(f.length,' ');if(s.length>f.length)throw new Error(`${name} trop long`);rec.write(s,f.offset,'latin1');};

// ---------- Construction ----------
const kept=[];
for(let i=0;i<shapes.length;i+=KEEP_EVERY)kept.push(i);
const outShapes=[],outRecords=[];
kept.forEach((src,n)=>{
  const rings=shapes[src].map(transformRing);
  const hectares=Math.abs(rings.reduce((s,r)=>s+ringArea(r),0))/10000;
  const rec=Buffer.from(dbfIn.subarray(headerLength+src*recordLength,headerLength+(src+1)*recordLength));
  const origSurface=Number(rawText(rec,'SURFACE'));
  for(const f of fields){
    if(f.type!=='C'||GENERIC.test(f.name))continue;
    putText(rec,f.name,''); // vide tout champ texte non générique
  }
  for(const [k,v] of Object.entries(FARM))putText(rec,k,v);
  const [insee,commune]=COMMUNES[n%COMMUNES.length];
  putText(rec,'COD_PARCEL',`F${String(n+1).padStart(2,'0')}`);
  putText(rec,'GUID_PARC',fakeGuid(n+1));
  if(rawText(rec,'TYPE_PARC')==='Parcelle secondaire'){putText(rec,'CODE_P_ORI',`F${String(n+1).padStart(2,'0')}`);putText(rec,'GUID_P_ORI',fakeGuid(900+n));}
  putText(rec,'NOM_PARCEL',NAMES[n%NAMES.length]);
  putText(rec,'CODE_INSEE',insee);
  putText(rec,'LIB_COMMUN',commune);
  putNumber(rec,'SURFACE',hectares);
  putNumber(rec,'NUM_ILOT',n+1);
  for(const name of ['SPE_FUMIER','SPE_LISIER','SPE_AUTRE']){
    const v=Number(rawText(rec,name));if(Number.isFinite(v)&&origSurface>0)putNumber(rec,name,hectares*v/origSurface);
  }
  outShapes.push(rings);outRecords.push(rec);
});

// ---------- Écriture SHP / SHX ----------
const bboxOf=pts=>pts.reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
const header=(lengthBytes,bbox)=>{const h=Buffer.alloc(100);h.writeInt32BE(9994,0);h.writeInt32BE(lengthBytes/2,24);h.writeInt32LE(1000,28);h.writeInt32LE(5,32);bbox.forEach((v,i)=>h.writeDoubleLE(v,36+8*i));return h;};
const contents=outShapes.map(rings=>{
  const pts=rings.flat(),c=Buffer.alloc(44+4*rings.length+16*pts.length);
  c.writeInt32LE(5,0);bboxOf(pts).forEach((v,i)=>c.writeDoubleLE(v,4+8*i));
  c.writeInt32LE(rings.length,36);c.writeInt32LE(pts.length,40);
  let start=0;rings.forEach((r,i)=>{c.writeInt32LE(start,44+4*i);start+=r.length;});
  pts.forEach(([x,y],i)=>{const o=44+4*rings.length+16*i;c.writeDoubleLE(x,o);c.writeDoubleLE(y,o+8);});
  return c;
});
const fullBbox=bboxOf(outShapes.flat(2));
const shpParts=[],shxParts=[];let offset=100;
contents.forEach((c,i)=>{
  const rh=Buffer.alloc(8);rh.writeInt32BE(i+1,0);rh.writeInt32BE(c.length/2,4);shpParts.push(rh,c);
  const x=Buffer.alloc(8);x.writeInt32BE(offset/2,0);x.writeInt32BE(c.length/2,4);shxParts.push(x);offset+=8+c.length;
});
const shp=Buffer.concat([header(offset,fullBbox),...shpParts]);
const shx=Buffer.concat([header(100+8*contents.length,fullBbox),...shxParts]);

// ---------- Écriture DBF (même en-tête, nombre d'enregistrements mis à jour) ----------
const dbfHeader=Buffer.from(dbfIn.subarray(0,headerLength));
dbfHeader.writeUInt32LE(outRecords.length,4);
const dbf=Buffer.concat([dbfHeader,...outRecords]);
const prj=fs.readFileSync(sibling('.prj'));

// ---------- ZIP compressé (deflate), noms UTF-8 accentués ----------
const zipEntries=[['.shp',shp],['.shx',shx],['.dbf',dbf],['.prj',prj]].map(([ext,data])=>({name:ZIP_BASE+ext,data}));
const makeZip=entries=>{
  const DOS_TIME=(12<<11),DOS_DATE=((2026-1980)<<9)|(9<<5)|10;
  const locals=[],centrals=[];let off=0;
  for(const e of entries){
    const name=Buffer.from(e.name,'utf8'),comp=zlib.deflateRawSync(e.data,{level:9}),crc=crc32(e.data);
    const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50,0);l.writeUInt16LE(20,4);l.writeUInt16LE(0x0800,6);l.writeUInt16LE(8,8);l.writeUInt16LE(DOS_TIME,10);l.writeUInt16LE(DOS_DATE,12);l.writeUInt32LE(crc,14);l.writeUInt32LE(comp.length,18);l.writeUInt32LE(e.data.length,22);l.writeUInt16LE(name.length,26);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x0800,8);c.writeUInt16LE(8,10);c.writeUInt16LE(DOS_TIME,12);c.writeUInt16LE(DOS_DATE,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(comp.length,20);c.writeUInt32LE(e.data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(off,42);
    locals.push(l,name,comp);centrals.push(c,name);off+=30+name.length+comp.length;
  }
  const central=Buffer.concat(centrals),eocd=Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50,0);eocd.writeUInt16LE(entries.length,8);eocd.writeUInt16LE(entries.length,10);eocd.writeUInt32LE(central.length,12);eocd.writeUInt32LE(off,16);
  return Buffer.concat([...locals,central,eocd]);
};

fs.mkdirSync(outDir,{recursive:true});
const outputs={[`${BASE}.shp`]:shp,[`${BASE}.shx`]:shx,[`${BASE}.dbf`]:dbf,[`${BASE}.prj`]:prj,[`${BASE}.zip`]:makeZip(zipEntries)};
for(const [name,data] of Object.entries(outputs))fs.writeFileSync(path.join(outDir,name),data);
console.log(`✓ ${outRecords.length} parcelles fictives écrites dans ${path.relative(process.cwd(),outDir)||'.'} : ${Object.keys(outputs).join(', ')}`);

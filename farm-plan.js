// Plan imprimable de l’exploitation (n° 54) : logique pure, sans Leaflet ni réseau, testable sous Node.
// Page A4 paysage : carte en SVG (projection Web Mercator, alignée sur les tuiles IGN), cartouche,
// légende avec les hectares, échelle, nord, date et tableau des parcelles. Le même modèle produit
// un vrai PDF vectoriel (pdf-lite) pour le partage sur téléphone, où l’impression d’iframe est inopérante.
import {escapeHtml as e,formatNumber,geometryAreaHa,localDate,toNumber} from './utils.js';
import {baseLayerDefinition} from './basemaps.js';
import {printCss} from './dossier.js';
import {PdfDoc,hexColor,mm,textWidth} from './pdf-lite.js';

// Dimensions en millimètres : page A4 paysage, marges de 8 mm, carte à gauche, cartouche à droite.
export const PLAN_PAGE=Object.freeze({width:297,height:210,margin:8,gap:6});
export const PLAN_MAP=Object.freeze({width:188,height:194});
export const PLAN_SIDE_WIDTH=PLAN_PAGE.width-2*PLAN_PAGE.margin-PLAN_MAP.width-PLAN_PAGE.gap;
// Au-delà, le tableau des parcelles passe sur une page suivante pour garder la légende lisible.
export const PLAN_INLINE_ROWS=12;
// Lignes de tableau et de légende réunies que le cartouche peut contenir sans couper ses notes.
export const PLAN_INLINE_LINES=14;
export const planTableInline=m=>!!m?.options?.table&&m.rows.length<=PLAN_INLINE_ROWS&&m.rows.length+m.legend.length<=PLAN_INLINE_LINES;

export const PLAN_SCOPES=Object.freeze([['farm','Toute l’exploitation'],['parcel','Une parcelle'],['selection','La sélection']]);
export const PLAN_BACKGROUNDS=Object.freeze([['none','Sans fond','Plan épuré, fonctionne hors connexion'],['ign-plan','Plan IGN','Routes, chemins et lieux-dits'],['ign-photo','Photo IGN','Vue aérienne']]);
export const PLAN_COLORS=Object.freeze([['culture','Cultures'],['map','Comme la carte'],['bw','Noir et blanc']]);
const label=(list,id)=>list.find(([key])=>key===id)?.[1]||list[0][1];
export const normalizePlanOptions=(o={})=>({
  scope:PLAN_SCOPES.some(([k])=>k===o.scope)?o.scope:'farm',
  background:PLAN_BACKGROUNDS.some(([k])=>k===o.background)?o.background:'none',
  colorMode:PLAN_COLORS.some(([k])=>k===o.colorMode)?o.colorMode:'culture',
  labels:o.labels!==false,table:o.table!==false
});

// ---------- Géométrie ----------
const TILE=256,MAX_LAT=85.05112878,EARTH=40075016.686;
const okPoint=pt=>Array.isArray(pt)&&Number.isFinite(Number(pt[0]))&&Number.isFinite(Number(pt[1]));
// Projection Web Mercator : coordonnées « pixel monde » au niveau de zoom donné (celles des tuiles).
export function project(lon,lat,zoom=0){
  const n=TILE*2**zoom,phi=Math.max(-MAX_LAT,Math.min(MAX_LAT,Number(lat)))*Math.PI/180;
  return[(Number(lon)+180)/360*n,(1-Math.log(Math.tan(phi)+1/Math.cos(phi))/Math.PI)/2*n];
}
// Anneaux d’un polygone (contour extérieur puis trous), points nettoyés.
export function geometryRings(g){
  const polys=!g?[]:g.type==='Polygon'?[g.coordinates||[]]:g.type==='MultiPolygon'?g.coordinates||[]:[];
  return polys.map(rings=>(rings||[]).map(r=>(r||[]).filter(okPoint)).filter(r=>r.length>2)).filter(rings=>rings.length);
}
const pointOf=g=>g?.type==='Point'&&okPoint(g.coordinates)?g.coordinates:null;
const geometryPoints=g=>{const p=pointOf(g);return p?[p]:geometryRings(g).flatMap(poly=>poly[0]);};
export const hasMapGeometry=p=>geometryPoints(p?.geometry).length>0;

// Parcelles de l’emprise choisie (exploitation, parcelle ou sélection), supprimées et archivées exclues (comme sur la carte).
export function planParcels(parcels,{scope='farm',parcelId=null,ids=[]}={}){
  const list=(parcels||[]).filter(p=>p&&!p.deletedAt&&!p.archived);
  if(scope==='parcel')return list.filter(p=>p.id===parcelId);
  if(scope==='selection'){const set=new Set(ids||[]);return list.filter(p=>set.has(p.id));}
  return list;
}
export const parcelArea=p=>{const v=toNumber(p?.surfaceHa);return v>0?v:geometryAreaHa(p?.geometry);};

// Cadrage : niveau de zoom des tuiles (assez fin pour l’impression, nombre de tuiles plafonné),
// fenêtre visible et échelle réelle sur le papier. Emprise minimale : un rectangle de minMeters.
export function planLayout(parcels,{widthMm=PLAN_MAP.width,heightMm=PLAN_MAP.height,pad=.07,minMeters=300,mmPerPixel=.2,maxZoom=19,maxTiles=110}={}){
  const pts=(parcels||[]).flatMap(p=>geometryPoints(p?.geometry));if(!pts.length)return null;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity,lat0=Infinity,lat1=-Infinity;
  for(const[lon,lat]of pts){const[x,y]=project(lon,lat);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);lat0=Math.min(lat0,+lat);lat1=Math.max(lat1,+lat);}
  const lat=(lat0+lat1)/2,metersPerUnit=EARTH*Math.cos(lat*Math.PI/180)/TILE,minUnits=minMeters/metersPerUnit;
  const w=Math.max(x1-x0,minUnits)*(1+2*pad),h=Math.max(y1-y0,minUnits)*(1+2*pad),cx=(x0+x1)/2,cy=(y0+y1)/2;
  const k=Math.min(widthMm/w,heightMm/h);// millimètres de papier par unité du zoom 0
  let zoom=Math.max(0,Math.min(maxZoom,Math.ceil(Math.log2(k/mmPerPixel))));
  const frame=z=>{const s=2**z,u=s/k,vw=widthMm*u,vh=heightMm*u;return{s,u,vx:cx*s-vw/2,vy:cy*s-vh/2,vw,vh};};
  const tileCount=f=>(Math.floor((f.vx+f.vw)/TILE)-Math.floor(f.vx/TILE)+1)*(Math.floor((f.vy+f.vh)/TILE)-Math.floor(f.vy/TILE)+1);
  while(zoom>0&&tileCount(frame(zoom))>maxTiles)zoom--;
  const f=frame(zoom),metersPerMm=metersPerUnit/k;
  return{zoom,origin:[f.vx,f.vy],unitsPerMm:f.u,widthMm,heightMm,metersPerMm,scale:roundScale(metersPerMm*1000),lat};
}
// Échelle arrondie à deux chiffres significatifs (1/4 300) : l’impression peut réduire légèrement la page.
export function roundScale(n){if(!(n>0))return 0;const p=10**Math.max(0,Math.floor(Math.log10(n))-1);return Math.round(n/p)*p;}
export const toMapMm=(layout,lon,lat)=>{const[x,y]=project(lon,lat,layout.zoom);return[(x-layout.origin[0])/layout.unitsPerMm,(y-layout.origin[1])/layout.unitsPerMm];};

// Barre d’échelle : longueur « ronde » (1, 2 ou 5 × 10^n mètres) ne dépassant pas maxMm sur le papier.
export function scaleBar(metersPerMm,maxMm=36){
  if(!(metersPerMm>0))return null;
  const max=metersPerMm*maxMm,p=10**Math.floor(Math.log10(max)),meters=[5,2,1].map(f=>f*p).find(v=>v<=max)||p;
  return{meters,mm:meters/metersPerMm,label:meters>=1000?`${formatNumber(meters/1000)} km`:`${formatNumber(meters)} m`};
}

// Tuiles du fond (gabarit Leaflet {z}/{x}/{y}) couvrant le cadre, en millimètres de carte.
export function planTiles(layout,template){
  if(!layout||!template)return[];
  const{zoom,origin:[vx,vy],unitsPerMm:u,widthMm,heightMm}=layout,n=2**zoom,out=[];
  for(let ty=Math.floor(vy/TILE);ty<=Math.floor((vy+heightMm*u)/TILE);ty++){if(ty<0||ty>=n)continue;
    for(let tx=Math.floor(vx/TILE);tx<=Math.floor((vx+widthMm*u)/TILE);tx++){const x=((tx%n)+n)%n;
      out.push({x:(tx*TILE-vx)/u,y:(ty*TILE-vy)/u,size:TILE/u,url:String(template).replace('{z}',zoom).replace('{x}',x).replace('{y}',ty).replace('{s}','a')});}}
  return out;
}

// Centre d’étiquette : barycentre du plus grand anneau extérieur (point pour un repère ponctuel).
function ringCentroid(r){let a=0,cx=0,cy=0;for(let i=0,j=r.length-1;i<r.length;j=i++){const f=r[j][0]*r[i][1]-r[i][0]*r[j][1];a+=f;cx+=(r[j][0]+r[i][0])*f;cy+=(r[j][1]+r[i][1])*f;}
  if(Math.abs(a)<1e-9){const n=r.length;return{area:0,pt:[r.reduce((s,p)=>s+p[0],0)/n,r.reduce((s,p)=>s+p[1],0)/n]};}
  return{area:Math.abs(a/2),pt:[cx/(3*a),cy/(3*a)]};}
function shapeOf(p,layout){
  const pt=pointOf(p.geometry);if(pt)return{point:toMapMm(layout,pt[0],pt[1]),polys:[]};
  const polys=geometryRings(p.geometry).map(rings=>rings.map(r=>r.map(([lon,lat])=>toMapMm(layout,lon,lat))));
  const best=polys.map(rings=>ringCentroid(rings[0])).sort((a,b)=>b.area-a.area)[0];
  return{polys,anchor:best?.pt||null};
}
export const pathData=polys=>polys.map(rings=>rings.map(r=>'M'+r.map(([x,y])=>`${x.toFixed(2)} ${y.toFixed(2)}`).join('L')+'Z').join('')).join('');

// ---------- Légende et tableau ----------
const GREYS=['#4a4a4a','#9a9a9a','#d0d0d0','#6e6e6e','#b8b8b8','#e6e6e6','#2e2e2e','#828282'];
const collator=new Intl.Collator('fr',{numeric:true,sensitivity:'base'});
// infoFor(parcelle) → {label, color} (couleur de culture ou mode de la carte).
export function planLegend(parcels,infoFor,{colorMode='culture'}={}){
  const groups=new Map();
  for(const p of parcels){const info=infoFor(p)||{},key=String(info.label||'Sans culture');const g=groups.get(key)||{label:key,color:info.color||'#8a8f88',count:0,ha:0};g.count++;g.ha+=parcelArea(p);groups.set(key,g);}
  const list=[...groups.values()].sort((a,b)=>b.ha-a.ha||collator.compare(a.label,b.label));
  if(colorMode==='bw')list.forEach((g,i)=>{g.color=GREYS[i%GREYS.length];});
  return list;
}
export function farmPlanModel({parcels=[],farmName='',campaign='',options={},infoFor=p=>({label:p.culture||'Sans culture',color:'#6fb37a'}),selectionLabel='',today=new Date()}={}){
  const o=normalizePlanOptions(options);
  const list=[...parcels].sort((a,b)=>collator.compare(String(a.nom||''),String(b.nom||'')));
  const legend=planLegend(list,infoFor,{colorMode:o.colorMode}),colorOf=new Map(legend.map(g=>[g.label,g.color]));
  const mapped=list.filter(hasMapGeometry),layout=planLayout(mapped);
  const rows=list.map((p,i)=>{const lbl=String(infoFor(p)?.label||'Sans culture');return{n:i+1,id:p.id,name:String(p.nom||'Parcelle'),culture:String(p.culture||''),commune:String(p.commune||''),ha:parcelArea(p),label:lbl,color:colorOf.get(lbl),shape:layout&&hasMapGeometry(p)?shapeOf(p,layout):null};});
  const def=o.background==='none'?null:baseLayerDefinition(o.background);
  return{options:o,farmName:String(farmName||'Mon exploitation'),campaign:String(campaign||''),date:today,scopeLabel:selectionLabel||label(PLAN_SCOPES,o.scope),backgroundLabel:label(PLAN_BACKGROUNDS,o.background),
    legend,rows,layout,tiles:def?planTiles(layout,def.url):[],attribution:def?String(def.attribution||'').replace(/<[^>]+>/g,''):'',bar:layout?scaleBar(layout.metersPerMm):null,
    totals:{count:rows.length,ha:rows.reduce((s,r)=>s+r.ha,0),offMap:rows.filter(r=>!r.shape).length}};
}
export const planTitle=m=>`Plan ${m.farmName}${m.campaign?` · ${m.campaign}`:''}`;
const plural=(n,one,many)=>`${formatNumber(n)} ${n>1?many:one}`;
const ha=v=>`${formatNumber(Math.round(v*100)/100)} ha`;
const scaleText=s=>s?`1/${new Intl.NumberFormat('fr-FR').format(s)}`:'—';
const short=(s,n)=>s.length>n?s.slice(0,n-1)+'…':s;
const dateOf=d=>localDate(d instanceof Date?d.toISOString():d);
const fillOpacity=m=>m.tiles.length?(m.options.background==='ign-photo'?.5:.58):.8;

// ---------- Document HTML (impression A4 paysage) ----------
function mapSvg(m){
  const{layout,options:o}=m,W=PLAN_MAP.width,H=PLAN_MAP.height,bw=o.colorMode==='bw';
  if(!layout)return`<div class="fp-empty"><p>Aucun contour à dessiner pour cette emprise.</p><p class="muted">Les parcelles sans contour figurent dans le tableau.</p></div>`;
  const stroke=bw?'#111':'#1d2b22',fo=fillOpacity(m);
  const tiles=m.tiles.map(t=>`<image href="${e(t.url)}" x="${t.x.toFixed(2)}" y="${t.y.toFixed(2)}" width="${(t.size+.05).toFixed(2)}" height="${(t.size+.05).toFixed(2)}" preserveAspectRatio="none"/>`).join('');
  const shapes=m.rows.filter(r=>r.shape).map(r=>r.shape.point?`<circle cx="${r.shape.point[0].toFixed(2)}" cy="${r.shape.point[1].toFixed(2)}" r="1.6" fill="${e(r.color)}" stroke="${stroke}" stroke-width=".35"><title>${e(r.name)}</title></circle>`:`<path d="${pathData(r.shape.polys)}" fill="${e(r.color)}" fill-opacity="${fo}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${bw?.4:.35}" stroke-linejoin="round"><title>${e(`${r.n}. ${r.name} · ${ha(r.ha)}`)}</title></path>`).join('');
  const labels=m.rows.filter(r=>r.shape).map(r=>{const[x,y]=r.shape.point?[r.shape.point[0],r.shape.point[1]-2.6]:r.shape.anchor||[0,0];const text=o.labels?`${r.n}. ${short(r.name,22)}`:String(r.n);return`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" class="fp-lbl">${e(text)}</text>`;}).join('');
  const b=m.bar,bx=6,by=H-7,seg=b?b.mm/2:0;
  const bar=b?`<g class="fp-bar" aria-hidden="true"><rect x="${bx-2}" y="${by-6.2}" width="${(b.mm+4+Math.max(14,b.label.length*1.9)).toFixed(2)}" height="9.4" rx="1.2" fill="#fff" fill-opacity=".88"/><rect x="${bx}" y="${by}" width="${seg.toFixed(2)}" height="1.6" fill="#111"/><rect x="${(bx+seg).toFixed(2)}" y="${by}" width="${seg.toFixed(2)}" height="1.6" fill="#fff" stroke="#111" stroke-width=".25"/><rect x="${bx}" y="${by}" width="${b.mm.toFixed(2)}" height="1.6" fill="none" stroke="#111" stroke-width=".3"/><text x="${bx}" y="${by-1.4}" class="fp-sc">0</text><text x="${(bx+b.mm).toFixed(2)}" y="${by-1.4}" class="fp-sc" text-anchor="middle">${e(b.label)}</text><text x="${(bx+b.mm+3).toFixed(2)}" y="${by+1.7}" class="fp-sc">${e(scaleText(layout.scale))}</text></g>`:'';
  const nx=W-11,ny=8;
  const north=`<g class="fp-north" aria-hidden="true"><circle cx="${nx}" cy="${ny+5}" r="6.4" fill="#fff" fill-opacity=".88"/><path d="M${nx} ${ny}L${nx+2.6} ${ny+8}L${nx} ${ny+6.6}Z" fill="#111"/><path d="M${nx} ${ny}L${nx-2.6} ${ny+8}L${nx} ${ny+6.6}Z" fill="#fff" stroke="#111" stroke-width=".3"/><text x="${nx}" y="${ny-1}" class="fp-n" text-anchor="middle">N</text></g>`;
  const desc=`Plan de ${plural(m.rows.filter(r=>r.shape).length,'parcelle','parcelles')}, échelle ${scaleText(layout.scale)}, nord en haut`;
  return`<svg class="fp-svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" role="img" aria-label="${e(desc)}" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="fp-clip"><rect width="${W}" height="${H}"/></clipPath></defs><rect width="${W}" height="${H}" fill="${bw||m.tiles.length?'#fff':'#f4efe3'}"/><g clip-path="url(#fp-clip)">${tiles}${shapes}${labels}</g>${north}${bar}<rect x=".15" y=".15" width="${W-.3}" height="${H-.3}" fill="none" stroke="#172019" stroke-width=".3"/></svg>`;
}
function tableHtml(rows,compact){
  return`<table class="fp-table${compact?' is-compact':''}"><thead><tr><th class="n">N°</th><th>Parcelle</th><th>Culture</th>${compact?'':'<th>Commune</th>'}<th class="n">Surface</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="n">${r.n}</td><td><i class="fp-sw" style="background:${e(r.color)}"></i>${e(r.name)}${r.shape?'':' <span class="fp-tag">hors carte</span>'}</td><td>${e(r.culture||'—')}</td>${compact?'':`<td>${e(r.commune||'—')}</td>`}<td class="n">${ha(r.ha)}</td></tr>`).join('')}</tbody></table>`;
}
export function farmPlanCss(assetBase=''){
  return printCss({assetBase,footer:'',cover:false})+`
@page{size:A4 landscape;margin:8mm;@bottom-left{content:none}@bottom-right{content:none}}
body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page.fp-page{width:297mm;min-height:210mm;padding:8mm}
.fp-sheet{display:grid;grid-template-columns:${PLAN_MAP.width}mm minmax(0,1fr);gap:${PLAN_PAGE.gap}mm;height:${PLAN_MAP.height}mm}
.fp-svg{display:block;width:${PLAN_MAP.width}mm;height:${PLAN_MAP.height}mm;background:#fff}
.fp-empty{display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;border:1px dashed var(--rule);border-radius:6px;height:100%}
.fp-lbl{font:600 2.5px 'Instrument Sans',system-ui,sans-serif;fill:#111;text-anchor:middle;dominant-baseline:middle;paint-order:stroke;stroke:#fff;stroke-width:.7px;stroke-linejoin:round}
.fp-sc{font:600 2.4px 'Instrument Sans',system-ui,sans-serif;fill:#111}.fp-n{font:700 3px 'Instrument Sans',system-ui,sans-serif;fill:#111}
.fp-side{display:flex;flex-direction:column;gap:2.2mm;min-width:0;overflow:hidden;font-size:8.5pt}
.fp-side h1{font-size:19pt;margin:0}.fp-side h2{font-size:12pt;margin:1mm 0 0;padding-bottom:1mm}
.fp-sub{font:400 12pt/1.15 'Instrument Serif',Georgia,serif;color:var(--muted);margin:0}
.fp-meta{display:grid;grid-template-columns:auto 1fr;gap:.6mm 3mm;margin:0;font-size:8pt}.fp-meta dt{color:var(--muted)}.fp-meta dd{margin:0;font-weight:600}
.fp-legend{list-style:none;margin:0;padding:0;display:grid;gap:1mm;font-size:8.5pt}.fp-legend li{display:grid;grid-template-columns:4mm minmax(0,1fr) auto;gap:2mm;align-items:center}.fp-legend b{font-weight:600;white-space:nowrap}
.fp-legend i,.fp-sw{display:inline-block;width:3.6mm;height:3.6mm;border-radius:.8mm;border:.2mm solid rgba(0,0,0,.45)}.fp-sw{width:2.6mm;height:2.6mm;margin-right:1.5mm;vertical-align:-.3mm}
.fp-legend .fp-total{border-top:.3mm solid var(--ink);padding-top:1mm;font-weight:600}
.fp-table{margin:0;font-size:8pt}.fp-table th,.fp-table td{padding:.9mm 1.2mm}.fp-table.is-compact{font-size:7.5pt}
.fp-tag{display:inline-block;padding:0 1.2mm;border-radius:2mm;background:var(--soft);color:var(--muted);font-size:6.5pt}
.fp-note{margin-top:auto;color:var(--muted);font-size:7pt;line-height:1.35}
.fp-table-page h2{font-size:15pt}
@media screen and (max-width:1120px){.page.fp-page{width:auto;max-width:calc(100% - 24px);min-height:0;padding:16px}.fp-sheet{grid-template-columns:1fr;height:auto}.fp-svg{width:100%;height:auto}.fp-side{overflow:visible}}
@media print{.page.fp-page{width:auto;min-height:0;padding:0;margin:0}.fp-sheet{height:${PLAN_MAP.height-2}mm}.fp-svg{width:${PLAN_MAP.width}mm;height:${PLAN_MAP.height-2}mm}}`;
}
export function farmPlanHtml(m,{assetBase=''}={}){
  const inline=planTableInline(m),after=m.options.table&&!inline;
  const legend=`<ul class="fp-legend">${m.legend.map(g=>`<li><i style="background:${e(g.color)}"></i><span>${e(g.label)} <small class="muted">(${g.count})</small></span><b>${ha(g.ha)}</b></li>`).join('')}<li class="fp-total"><span></span><span>Total · ${plural(m.totals.count,'parcelle','parcelles')}</span><b>${ha(m.totals.ha)}</b></li></ul>`;
  const meta=[['Date',dateOf(m.date)],['Emprise',m.scopeLabel],['Échelle',m.layout?`${scaleText(m.layout.scale)} (A4 sans ajustement)`:'—'],['Fond',m.backgroundLabel]];
  const notes=[after?'Tableau des parcelles en page suivante.':'',m.totals.offMap?`${plural(m.totals.offMap,'parcelle sans contour','parcelles sans contour')} : dans le tableau, pas sur la carte.`:'','Surfaces déclarées, ou calculées depuis le contour. Document indicatif, sans valeur de bornage.',m.attribution?`Fond ${m.attribution}.`:''].filter(Boolean);
  const side=`<aside class="fp-side"><p class="dz-eyebrow">Plan de l’exploitation</p><h1>${e(m.farmName)}</h1>${m.campaign?`<p class="fp-sub">Campagne ${e(m.campaign)}</p>`:''}<dl class="fp-meta">${meta.map(([k,v])=>`<dt>${e(k)}</dt><dd>${e(v)}</dd>`).join('')}</dl><h2>Légende</h2>${legend}${inline?`<h2>Parcelles</h2>${tableHtml(m.rows,true)}`:''}<p class="fp-note">${notes.map(e).join('<br>')}</p></aside>`;
  const body=`<main class="page fp-page"><div class="fp-sheet"><figure style="margin:0">${mapSvg(m)}</figure>${side}</div></main>${after?`<main class="page fp-page fp-table-page"><h2>Tableau des parcelles · ${e(m.farmName)}</h2>${tableHtml(m.rows,false)}<p class="muted"><small>${e(`Total : ${plural(m.totals.count,'parcelle','parcelles')} · ${ha(m.totals.ha)} · plan du ${dateOf(m.date)}`)}</small></p></main>`:''}`;
  return`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(planTitle(m))}</title><style>${farmPlanCss(assetBase)}</style></head><body><div class="dz-toolbar"><button type="button" id="print">Imprimer / PDF</button></div>${body}<script>document.getElementById('print').addEventListener('click',function(){print()})<\/script></body></html>`;
}

// ---------- PDF vectoriel (partage sur téléphone) ----------
const f2=v=>String(Math.round(v*100)/100);
const rgbOp=(hex,op)=>`${hexColor(hex,[.55,.56,.53]).map(f2).join(' ')} ${op}`;
const fit=(s,font,size,max)=>{let t=String(s);if(textWidth(t,font,size)<=max)return t;while(t.length>1&&textWidth(t+'…',font,size)>max)t=t.slice(0,-1);return t+'…';};
// tiles : Map url → octets JPEG (photo IGN déjà téléchargée) ; les autres fonds ne sont pas repris.
export function farmPlanPdf(m,{tiles=new Map()}={}){
  const doc=new PdfDoc({width:mm(PLAN_PAGE.width),height:mm(PLAN_PAGE.height),title:planTitle(m),subject:'Plan de l’exploitation'});
  const page=doc.addPage(),H=doc.height,M=PLAN_PAGE.margin,W=PLAN_MAP.width,MH=PLAN_MAP.height,bw=m.options.colorMode==='bw';
  const X=x=>mm(M+x),Y=y=>H-mm(M+y);// millimètres de carte → points PDF (origine en bas)
  const ring=r=>r.map(([x,y],i)=>`${f2(X(x))} ${f2(Y(y))} ${i?'l':'m'}`).join(' ')+' h';
  page.rect(mm(M),mm(M),mm(W),mm(MH),{fill:bw||m.tiles.length?'#ffffff':'#f4efe3'});
  if(m.layout){
    page.ops.push(`q ${f2(X(0))} ${f2(Y(MH))} ${f2(mm(W))} ${f2(mm(MH))} re W n`);
    let drawn=0;for(const t of m.tiles){const bytes=tiles.get(t.url);if(!bytes)continue;try{const img=doc.addJpeg(bytes);page.image(img,X(t.x),mm(M+t.y),mm(t.size+.05),mm(t.size+.05));drawn++;}catch{}}
    const fo=drawn?fillOpacity(m):.8,gs=doc.alpha(fo),stroke=bw?'#111111':'#1d2b22';
    for(const r of m.rows){if(!r.shape)continue;
      if(r.shape.point){const[x,y]=r.shape.point;page.rect(X(x)-mm(1.4),mm(M+y)-mm(1.4),mm(2.8),mm(2.8),{fill:r.color,stroke,lineWidth:.8,radius:mm(1.4)});continue;}
      const d=r.shape.polys.map(rings=>rings.map(ring).join(' ')).join(' ');
      page.ops.push(`q /${gs} gs ${rgbOp(r.color,'rg')} ${d} f* Q`,`q ${rgbOp(stroke,'RG')} ${f2(mm(bw?.4:.35))} w 1 j ${d} S Q`);}
    for(const r of m.rows){if(!r.shape)continue;const[x,y]=r.shape.point?[r.shape.point[0],r.shape.point[1]-2.6]:r.shape.anchor||[0,0];const text=m.options.labels?`${r.n}. ${fit(r.name,'helv',7,mm(36))}`:String(r.n),w=textWidth(text,'helvB',7);
      page.rect(X(x)-w/2-1.6,mm(M+y)-4.6,w+3.2,9,{fill:'#ffffff',radius:2});page.text(text,X(x),mm(M+y)+2.4,{font:'helvB',size:7,color:'#111111',align:'center'});}
    page.ops.push('Q');
    // Nord
    const nx=W-11,ny=8;page.rect(X(nx)-mm(6.4),mm(M+ny+5)-mm(6.4),mm(12.8),mm(12.8),{fill:'#ffffff',radius:mm(6.4)});
    page.ops.push(`q 0 0 0 rg ${ring([[nx,ny],[nx+2.6,ny+8],[nx,ny+6.6]])} f Q`,`q 1 1 1 rg 0 0 0 RG .8 w ${ring([[nx,ny],[nx-2.6,ny+8],[nx,ny+6.6]])} B Q`);
    page.text('N',X(nx),mm(M+ny-1),{font:'helvB',size:8.5,align:'center'});
    // Échelle
    const b=m.bar;if(b){const bx=6,by=MH-7,seg=b.mm/2;page.rect(X(bx-2),mm(M+by-6.2),mm(b.mm+4+Math.max(14,b.label.length*1.9)),mm(9.4),{fill:'#ffffff',radius:mm(1.2)});
      page.rect(X(bx),mm(M+by),mm(seg),mm(1.6),{fill:'#111111'});page.rect(X(bx+seg),mm(M+by),mm(seg),mm(1.6),{fill:'#ffffff',stroke:'#111111',lineWidth:.7});
      page.text('0',X(bx),mm(M+by-1.4),{font:'helvB',size:6.8});page.text(b.label,X(bx+b.mm),mm(M+by-1.4),{font:'helvB',size:6.8,align:'center'});page.text(scaleText(m.layout.scale),X(bx+b.mm+3),mm(M+by+1.7),{font:'helvB',size:6.8});}
  }else page.text('Aucun contour à dessiner pour cette emprise.',X(W/2),mm(M+MH/2),{size:11,color:'#59625b',align:'center'});
  page.rect(mm(M),mm(M),mm(W),mm(MH),{stroke:'#172019',lineWidth:.85});
  // Cartouche
  const sx=mm(M+W+PLAN_PAGE.gap),sw=mm(PLAN_SIDE_WIDTH),bottom=mm(M+MH);let y=mm(M)+8;
  page.text('PLAN DE L’EXPLOITATION',sx,y,{font:'helvB',size:7.5,color:'#2f6b4a',spacing:.8});y+=20;
  page.text(fit(m.farmName,'times',19,sw),sx,y,{font:'times',size:19});y+=17;
  if(m.campaign){page.text(`Campagne ${m.campaign}`,sx,y,{font:'times',size:12,color:'#59625b'});y+=14;}
  for(const[k,v]of[['Date',dateOf(m.date)],['Emprise',m.scopeLabel],['Échelle',m.layout?`${scaleText(m.layout.scale)} (A4 sans ajustement)`:'—'],['Fond',drawnLabel(m,tiles)]]){page.text(k,sx,y,{size:7.5,color:'#59625b'});page.text(fit(v,'helvB',7.5,sw-48),sx+48,y,{font:'helvB',size:7.5});y+=10.5;}
  y+=6;page.text('Légende',sx,y,{font:'times',size:12.5});y+=4;page.line(sx,y,sx+sw,y,{color:'#d9d4c7'});y+=11;
  for(const g of m.legend){if(y>bottom-60)break;page.rect(sx,y-7.5,9,9,{fill:g.color,stroke:'#555555',lineWidth:.4,radius:2});const right=ha(g.ha);page.text(fit(`${g.label} (${g.count})`,'helv',8,sw-22-textWidth(right,'helvB',8)),sx+14,y,{size:8});page.text(right,sx+sw,y,{font:'helvB',size:8,align:'right'});y+=11.5;}
  page.line(sx,y-6,sx+sw,y-6,{color:'#172019',width:.8});y+=4;page.text(`Total · ${plural(m.totals.count,'parcelle','parcelles')}`,sx+14,y,{font:'helvB',size:8});page.text(ha(m.totals.ha),sx+sw,y,{font:'helvB',size:8,align:'right'});y+=12;
  const inline=planTableInline(m),after=m.options.table&&!inline;
  if(inline){y+=6;page.text('Parcelles',sx,y,{font:'times',size:12.5});y+=16;y=pdfTable(page,m.rows,{x:sx,y,width:sw,compact:true,bottom:bottom-34});}
  const notes=[after?'Tableau des parcelles en page suivante.':'',m.totals.offMap?`${plural(m.totals.offMap,'parcelle sans contour','parcelles sans contour')} : dans le tableau seulement.`:'','Surfaces déclarées, ou calculées depuis le contour.','Document indicatif, sans valeur de bornage.',m.attribution&&drawnLabel(m,tiles)!=='Sans fond'?`Fond ${m.attribution}.`:''].filter(Boolean);
  let ny2=bottom-notes.length*9+6;for(const n of notes){page.text(fit(n,'helv',6.5,sw),sx,ny2,{size:6.5,color:'#59625b'});ny2+=9;}
  if(after){let rest=m.rows;while(rest.length){const p=doc.addPage();p.text(`Tableau des parcelles · ${m.farmName}`,mm(M),mm(M)+14,{font:'times',size:15});const per=Math.floor((mm(PLAN_PAGE.height-2*M)-40)/15);pdfTable(p,rest.slice(0,per),{x:mm(M),y:mm(M)+28,width:mm(PLAN_PAGE.width-2*M),compact:false,bottom:H});rest=rest.slice(per);}}
  return doc.output();
}
function drawnLabel(m,tiles){return m.tiles.length&&m.options.background==='ign-photo'&&m.tiles.some(t=>tiles.get(t.url))?m.backgroundLabel:'Sans fond';}
function pdfTable(page,rows,{x,y,width,compact,bottom}){
  const cols=compact?[['N°',18,'r'],['Parcelle',width*.42],['Culture',width*.32],['Surface',0,'r']]:[['N°',24,'r'],['Parcelle',width*.32],['Culture',width*.24],['Commune',width*.24],['Surface',0,'r']];
  const fixed=cols.reduce((s,c)=>s+c[1],0);cols[cols.length-1][1]=width-fixed;const size=compact?7:8.5,row=compact?10.5:15;
  const cells=r=>compact?[String(r.n),r.name+(r.shape?'':' (hors carte)'),r.culture||'-',ha(r.ha)]:[String(r.n),r.name+(r.shape?'':' (hors carte)'),r.culture||'-',r.commune||'-',ha(r.ha)];
  const line=(vals,font,color)=>{let cx=x;cols.forEach(([,w,align],i)=>{const t=fit(vals[i],font,size,w-6);page.text(t,align==='r'?cx+w-3:cx+3,y,{font,size,color,align:align==='r'?'right':'left'});cx+=w;});};
  line(cols.map(c=>c[0].toUpperCase()),'helvB','#59625b');y+=3;page.line(x,y,x+width,y,{color:'#172019',width:.9});y+=row-3;
  let shown=0;for(const r of rows){if(y>bottom-row){page.text(`… et ${rows.length-shown} autres (voir l’application)`,x+3,y,{size,color:'#59625b'});y+=row;break;}
    page.rect(x+(compact?20:26),y-size+.5,size-1.5,size-1.5,{fill:r.color,radius:1});line(cells(r).map((v,i)=>i===1?`    ${v}`:v),'helv','#172019');y+=3;page.line(x,y,x+width,y,{color:'#d9d4c7',width:.4});y+=row-3;shown++;}
  return y;
}

// Export des parcelles (n° 49) : Shapefile ZIP, KML coloré par culture (Google Earth) et ISOXML
// parcellaire (PFD/PLN), plus la lecture des polygones d'un KML/KMZ à l'import. Logique pure.
import {geometryAreaHa} from './utils.js';
import {createZip} from './zip-lite.js';
import {polygonShapefile,missionIsoxml} from './machine-export.js';

const isPolygonal=geometry=>geometry?.type==='Polygon'||geometry?.type==='MultiPolygon';
export function exportableParcels(state){
  return (state?.parcelles||[]).filter(p=>!p.deletedAt&&!p.archived&&isPolygonal(p.geometry));
}
const surface=parcel=>{const value=Number(parcel.surfaceHa);if(value>0)return value;try{return geometryAreaHa(parcel.geometry)||0;}catch{return 0;}};

// --- Shapefile -----------------------------------------------------------------------------
export const PARCEL_SHP_FIELDS=[['NOM','C',100,0],['CULTURE','C',80,0],['HA','N',14,4],['ILOT','C',20,0]];
export function parcelShapefile(parcels){
  if(!parcels.length)throw Error('Aucune parcelle avec contour à exporter.');
  return polygonShapefile(parcels.map(p=>({geometry:p.geometry,values:[p.nom||'',p.culture||'',Math.round(surface(p)*10000)/10000,String(p.ilot??'')]})),PARCEL_SHP_FIELDS,{truncate:true});
}
export async function parcelShapefileZip(parcels,{base='parcelles'}={}){
  const files=parcelShapefile(parcels);
  return createZip(Object.entries(files).map(([ext,data])=>({name:`${base}.${ext}`,data:new Blob([data])})));
}

// --- KML -----------------------------------------------------------------------------------
const xmlEscape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
// KML code les couleurs en aabbggrr.
export function kmlColor(hex,alpha='ff'){const m=/^#?([0-9a-f]{6})$/i.exec(String(hex||''));const [r,g,b]=m?[m[1].slice(0,2),m[1].slice(2,4),m[1].slice(4,6)]:['77','85','79'];return `${alpha}${b}${g}${r}`.toLowerCase();}
const ring=coords=>coords.map(([x,y])=>`${Number(x).toFixed(8)},${Number(y).toFixed(8)},0`).join(' ');
function kmlPolygon(poly){return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ring(poly[0])}</coordinates></LinearRing></outerBoundaryIs>${poly.slice(1).map(r=>`<innerBoundaryIs><LinearRing><coordinates>${ring(r)}</coordinates></LinearRing></innerBoundaryIs>`).join('')}</Polygon>`;}
export function parcelsKml(parcels,{name='Parcelles',colorFor=()=>'#778579'}={}){
  const styles=new Map();
  for(const p of parcels){const key=p.culture||'Sans culture';if(!styles.has(key))styles.set(key,{id:`c${styles.size+1}`,color:colorFor(p)});}
  const styleXml=[...styles.values()].map(s=>`<Style id="${s.id}"><LineStyle><color>${kmlColor(s.color)}</color><width>2</width></LineStyle><PolyStyle><color>${kmlColor(s.color,'80')}</color></PolyStyle><LabelStyle><scale>1</scale></LabelStyle></Style>`).join('');
  const placemarks=parcels.map(p=>{
    const polygons=p.geometry.type==='Polygon'?[p.geometry.coordinates]:p.geometry.coordinates,ha=Math.round(surface(p)*100)/100;
    const data=[['nom',p.nom||''],['culture',p.culture||''],['surface_ha',ha],['ilot',p.ilot??'']].map(([k,v])=>`<Data name="${k}"><value>${xmlEscape(v)}</value></Data>`).join('');
    const shape=polygons.length===1?kmlPolygon(polygons[0]):`<MultiGeometry>${polygons.map(kmlPolygon).join('')}</MultiGeometry>`;
    return `<Placemark><name>${xmlEscape(p.nom||'Parcelle')}</name><description>${xmlEscape([p.culture,`${String(ha).replace('.',',')} ha`].filter(Boolean).join(' · '))}</description><styleUrl>#${styles.get(p.culture||'Sans culture').id}</styleUrl><ExtendedData>${data}</ExtendedData>${shape}</Placemark>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xmlEscape(name)}</name>${styleXml}${placemarks}</Document></kml>\n`;
}

// --- ISOXML parcellaire ----------------------------------------------------------------------
export function parcelsIsoxml(parcels){return missionIsoxml({parcels,operation:'Parcellaire'});}
export async function parcelsIsoxmlZip(parcels){const {xml}=parcelsIsoxml(parcels);return createZip([{name:'TASKDATA/TASKDATA.XML',data:new Blob([xml])}]);}

// --- Import KML / KMZ ------------------------------------------------------------------------
const decode=v=>String(v??'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&amp;/g,'&').trim();
const tag=(body,name)=>{const m=new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`,'i').exec(body);return m?decode(m[1]):'';};
function coordinates(raw){
  const points=decode(raw).split(/\s+/).filter(Boolean).map(c=>c.split(',').map(Number)).filter(c=>c.length>=2&&Number.isFinite(c[0])&&Number.isFinite(c[1])).map(c=>[c[0],c[1]]);
  if(points.length&&(points[0][0]!==points.at(-1)[0]||points[0][1]!==points.at(-1)[1]))points.push([...points[0]]);
  return points;
}
function polygonsOf(body){
  const out=[];const re=/<(?:\w+:)?Polygon\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Polygon>/gi;let m;
  while((m=re.exec(body))){
    const outer=/<(?:\w+:)?outerBoundaryIs\b[^>]*>[\s\S]*?<(?:\w+:)?coordinates\b[^>]*>([\s\S]*?)<\/(?:\w+:)?coordinates>/i.exec(m[1]);if(!outer)continue;
    const rings=[coordinates(outer[1])];const inner=/<(?:\w+:)?innerBoundaryIs\b[^>]*>[\s\S]*?<(?:\w+:)?coordinates\b[^>]*>([\s\S]*?)<\/(?:\w+:)?coordinates>/gi;let h;
    while((h=inner.exec(m[1])))rings.push(coordinates(h[1]));
    if(rings[0].length>=4)out.push(rings.filter(r=>r.length>=4));
  }
  return out;
}
export function kmlToGeoJson(text){
  const xml=String(text||'');if(!/<kml\b/i.test(xml))throw new Error('Fichier KML invalide.');
  const features=[];const re=/<(?:\w+:)?Placemark\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Placemark>/gi;let m;
  while((m=re.exec(xml))){
    const body=m[1],polygons=polygonsOf(body);if(!polygons.length)continue;
    const properties={};const name=tag(body,'name');if(name)properties.nom=name;
    const data=/<Data\b[^>]*name="([^"]+)"[^>]*>[\s\S]*?<value>([\s\S]*?)<\/value>/gi;let d;while((d=data.exec(body)))properties[decode(d[1])]=decode(d[2]);
    const simple=/<SimpleData\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/SimpleData>/gi;while((d=simple.exec(body)))properties[decode(d[1])]=decode(d[2]);
    if(!properties.nom&&name)properties.nom=name;
    features.push({type:'Feature',properties,geometry:polygons.length===1?{type:'Polygon',coordinates:polygons[0]}:{type:'MultiPolygon',coordinates:polygons}});
  }
  return {type:'FeatureCollection',features};
}

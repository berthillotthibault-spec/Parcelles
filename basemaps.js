// Fonds de carte et cadastre : logique pure, sans Leaflet ni réseau, testable sous Node.
// Les couches IGN passent par le WMTS public de la Géoplateforme (sans clé) ;
// l'interrogation du cadastre utilise le module « cadastre » d'API Carto (IGN).

export const IGN_WMTS_URL='https://data.geopf.fr/wmts';
export const CADASTRE_API_URL='https://apicarto.ign.fr/api/cadastre/parcelle';
export const IGN_ATTRIBUTION='© <a href="https://www.ign.fr/" target="_blank" rel="noopener">IGN</a> – Géoplateforme';

export function ignWmtsUrl({layer,style='normal',format='image/png'}){
  const params=new URLSearchParams({SERVICE:'WMTS',REQUEST:'GetTile',VERSION:'1.0.0',LAYER:layer,STYLE:style,FORMAT:format,TILEMATRIXSET:'PM'});
  // Les gabarits Leaflet doivent rester lisibles : on ajoute les jetons {z}/{y}/{x} sans les encoder.
  return `${IGN_WMTS_URL}?${params.toString()}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
}

// Ordre d'affichage dans le panneau Couches. Les noms historiques « osm » et
// « satellite » restent valides pour ne rien casser dans les préférences existantes.
export const BASE_LAYERS=[
  {id:'ign-photo',label:'Photo IGN',hint:'Orthophoto 20 cm',url:ignWmtsUrl({layer:'ORTHOIMAGERY.ORTHOPHOTOS',format:'image/jpeg'}),maxNativeZoom:19,maxZoom:20,attribution:IGN_ATTRIBUTION},
  {id:'ign-plan',label:'Plan IGN',hint:'Routes, lieux-dits',url:ignWmtsUrl({layer:'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2'}),maxNativeZoom:19,maxZoom:20,attribution:IGN_ATTRIBUTION},
  {id:'satellite',label:'Satellite Esri',hint:'Couverture mondiale',url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',maxZoom:20,attribution:'Tiles © Esri — Sources Esri, Maxar, Earthstar Geographics'},
  {id:'osm',label:'OSM',hint:'OpenStreetMap',url:'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',maxNativeZoom:19,maxZoom:20,attribution:'© OpenStreetMap contributors'}
];
export const DEFAULT_BASE_LAYER='osm';

export function normalizeBaseLayer(name){
  return BASE_LAYERS.some(layer=>layer.id===name)?name:DEFAULT_BASE_LAYER;
}
export function baseLayerDefinition(name){
  const id=normalizeBaseLayer(name);
  return BASE_LAYERS.find(layer=>layer.id===id);
}

export const CADASTRE_OVERLAY={
  id:'cadastre',label:'Cadastre',
  url:ignWmtsUrl({layer:'CADASTRALPARCELS.PARCELLAIRE_EXPRESS',style:'PCI vecteur'}),
  maxNativeZoom:19,maxZoom:20,attribution:IGN_ATTRIBUTION
};
export const DEFAULT_CADASTRE_OPACITY=0.8;

export function normalizeCadastreOpacity(value){
  const number=Number(value);
  if(value===null||value===undefined||value===''||!Number.isFinite(number))return DEFAULT_CADASTRE_OPACITY;
  return Math.round(Math.min(1,Math.max(0.2,number))*100)/100;
}

export function cadastreQueryUrl(latitude,longitude){
  const lat=Number(latitude),lng=Number(longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)throw new Error('Position invalide pour interroger le cadastre.');
  const geom=JSON.stringify({type:'Point',coordinates:[Math.round(lng*1e7)/1e7,Math.round(lat*1e7)/1e7]});
  return `${CADASTRE_API_URL}?geom=${encodeURIComponent(geom)}&_limit=1`;
}

const text=value=>value===null||value===undefined?'':String(value).trim();

function validRing(ring){
  return Array.isArray(ring)&&ring.length>=4&&ring.every(point=>Array.isArray(point)&&point.length>=2&&Number.isFinite(point[0])&&Number.isFinite(point[1])&&Math.abs(point[0])<=180&&Math.abs(point[1])<=90);
}
function validCadastreGeometry(geometry){
  if(geometry?.type==='Polygon')return Array.isArray(geometry.coordinates)&&geometry.coordinates.length>0&&geometry.coordinates.every(validRing);
  if(geometry?.type==='MultiPolygon')return Array.isArray(geometry.coordinates)&&geometry.coordinates.length>0&&geometry.coordinates.every(poly=>Array.isArray(poly)&&poly.length>0&&poly.every(validRing));
  return false;
}

// Transforme la réponse d'API Carto en fiche lisible. Renvoie null si aucune
// parcelle cadastrale ne couvre le point (zone non cadastrée, domaine public…).
export function parseCadastreResponse(payload){
  const feature=Array.isArray(payload?.features)?payload.features.find(item=>item&&item.type==='Feature'):null;
  if(!feature)return null;
  const p=feature.properties||{};
  const section=text(p.section),numero=text(p.numero);
  if(!section&&!numero)return null;
  const inseeCode=text(p.code_insee)||(text(p.code_dep)&&text(p.code_com)?`${text(p.code_dep)}${text(p.code_com)}`:'');
  const idu=text(p.idu)||(inseeCode&&section&&numero?`${inseeCode}${text(p.com_abs)||'000'}${section.padStart(2,'0')}${numero.padStart(4,'0')}`:'');
  const contenance=Number(p.contenance);
  return{
    idu,section,numero,
    commune:text(p.nom_com),inseeCode,
    feuille:p.feuille===undefined||p.feuille===null?'':text(p.feuille),
    contenanceM2:Number.isFinite(contenance)&&contenance>=0?contenance:null,
    geometry:validCadastreGeometry(feature.geometry)?structuredClone(feature.geometry):null
  };
}

export function cadastreReference(info){
  if(!info)return '';
  return [info.section&&`Section ${info.section}`,info.numero&&`n° ${info.numero}`].filter(Boolean).join(' · ');
}

// Proposition de fiche parcelle : la surface vient de la contenance cadastrale
// quand elle est connue (m² → ha), sinon elle sera calculée depuis le contour.
export function cadastreInfoToParcel(info){
  if(!info?.geometry)throw new Error('Ce contour cadastral est indisponible ou invalide.');
  const shortRef=[info.section,info.numero].filter(Boolean).join(' ');
  return{
    source:'cadastre',sourceId:info.idu?`cadastre:${info.idu}`:'',
    nom:shortRef?`Cadastre ${shortRef}`:'Parcelle cadastrale',
    geometry:structuredClone(info.geometry),
    ...(info.contenanceM2!==null&&info.contenanceM2!==undefined?{surfaceHa:Math.round(info.contenanceM2)/10000}:{}),
    commune:info.commune||'',
    cadastreSection:info.section||'',cadastreNumero:info.numero||'',cadastreInsee:info.inseeCode||'',cadastreIdu:info.idu||''
  };
}

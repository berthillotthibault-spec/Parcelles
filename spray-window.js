// n° 60 — Fenêtre de traitement enrichie (complète le n° 100, work-weather.js) :
// inversion de température probable, rappel de la limite légale de vent, direction du vent vers
// un cours d'eau, valeurs horaires de la fenêtre réelle copiées au registre, âge de la prévision.
// Fonctions pures, indicatives : jamais une autorisation de traiter.
import {forecastTime,deltaT,humidityFromDewPoint} from './weather-decision.js';
import {geometryCentroid,haversineMeters,normalize} from './utils.js';

export const LEGAL_WIND_KMH=19;   // 3 Beaufort
export const LEGAL_WIND_TEXT='Limite légale : pas de pulvérisation au-delà de 19 km/h (3 Beaufort).';
export const INVERSION_TEXT='Inversion probable : nuit calme et ciel dégagé, la bouillie peut dériver loin.';
const HOUR=3600000;
const valid=v=>typeof v==='number'&&Number.isFinite(v);
const r1=v=>Math.round(v*10)/10;

/** Inversion probable : entre 20 h et 8 h, vent < 3 km/h et ciel dégagé (nébulosité ≤ 25 %). */
export function inversionLikely({hour,wind,cloudCover}){
  if(!valid(hour)||!valid(wind)||!valid(cloudCover))return false;
  return(hour>=20||hour<8)&&wind<3&&cloudCover<=25;
}

/** Valeurs horaires couvrant [startMs, endMs[ ; null si la prévision ne couvre pas la fenêtre. */
export function windowWeather(weather,startMs,endMs){
  const h=weather?.hourly||{},times=(h.time||[]).map(t=>forecastTime(t,weather));
  if(!valid(startMs)||!valid(endMs)||endMs<=startMs)return null;
  const rows=[];
  for(let i=0;i<times.length;i++){
    const t=times[i];if(!(t+HOUR>startMs&&t<endMs))continue;
    let humidity=h.relative_humidity_2m?.[i];if(!valid(humidity))humidity=humidityFromDewPoint(h.temperature_2m?.[i],h.dew_point_2m?.[i]);
    const row={t,wind:h.wind_speed_10m?.[i],gust:h.wind_gusts_10m?.[i],temperature:h.temperature_2m?.[i],humidity,direction:h.wind_direction_10m?.[i],cloudCover:h.cloud_cover?.[i]};
    row.deltaT=valid(row.temperature)&&valid(row.humidity)?deltaT(row.temperature,row.humidity):null;
    row.inversion=inversionLikely({hour:new Date(t).getHours(),wind:row.wind,cloudCover:row.cloudCover});
    rows.push(row);
  }
  if(!rows.length)return null;
  const pick=k=>rows.map(r=>r[k]).filter(valid),max=k=>pick(k).length?r1(Math.max(...pick(k))):null,min=k=>pick(k).length?r1(Math.min(...pick(k))):null;
  return{from:startMs,to:endMs,hours:rows.length,windMax:max('wind'),gustMax:max('gust'),tempMin:min('temperature'),tempMax:max('temperature'),humidityMin:min('humidity'),humidityMax:max('humidity'),
    deltaTMin:min('deltaT'),deltaTMax:max('deltaT'),direction:pick('direction').at(-1)??null,inversion:rows.some(r=>r.inversion),forecastAt:weather.loadedAt||null};
}

/** Fenêtre réelle d'un travail (date + heures de début et de fin, heure locale). */
export function workWindow(weather,work){
  const d=String(work?.date||'').slice(0,10),a=String(work?.startTime||''),b=String(work?.endTime||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!/^\d{1,2}:\d{2}/.test(a))return null;
  const start=new Date(`${d}T${a.slice(0,5).padStart(5,'0')}:00`).getTime();
  let end=/^\d{1,2}:\d{2}/.test(b)?new Date(`${d}T${b.slice(0,5).padStart(5,'0')}:00`).getTime():start+HOUR;
  if(end<=start)end+=24*HOUR;
  return windowWeather(weather,start,end);
}

/** Avertissements d'une fenêtre (vent légal, inversion, delta T). */
export function windowWarnings(win){
  if(!win)return[];
  const out=[];
  if(valid(win.windMax)&&win.windMax>LEGAL_WIND_KMH)out.push(`Vent jusqu’à ${String(win.windMax).replace('.',',')} km/h dans la fenêtre. ${LEGAL_WIND_TEXT}`);
  if(win.inversion)out.push(INVERSION_TEXT);
  if(valid(win.deltaTMax)&&(win.deltaTMax>8||(valid(win.deltaTMin)&&win.deltaTMin<2)))out.push(`Delta T ${String(win.deltaTMin).replace('.',',')}–${String(win.deltaTMax).replace('.',',')} °C : hors de la plage conseillée 2–8 °C.`);
  return out;
}

/** Cap (degrés, 0 = nord) du point a vers le point b. */
export function bearingDeg(a,b){
  const rad=x=>x*Math.PI/180,phi1=rad(a.latitude),phi2=rad(b.latitude),dl=rad(b.longitude-a.longitude);
  const y=Math.sin(dl)*Math.cos(phi2),x=Math.cos(phi1)*Math.sin(phi2)-Math.sin(phi1)*Math.cos(phi2)*Math.cos(dl);
  return(Math.atan2(y,x)*180/Math.PI+360)%360;
}
/** Le vent météo indique d'où il vient : il souffle vers direction + 180°. */
export const windToward=from=>((Number(from)%360)+540)%360;
const angleGap=(a,b)=>{const d=Math.abs(a-b)%360;return d>180?360-d:d;};
const WATER=/cours d eau|riviere|ruisseau|fosse|canal|bief/;
export const isWaterPoint=p=>WATER.test(normalize(`${p?.type||''} ${p?.nom||p?.name||''}`));

/** Cours d'eau sous le vent de la parcelle (± spread degrés, à moins de maxDistance m), ou null. */
export function windTowardWater(parcel,points,directionFrom,{maxDistance=1000,spread=45}={}){
  const c=geometryCentroid(parcel?.geometry);if(!c||!valid(Number(directionFrom)))return null;
  const toward=windToward(directionFrom);
  let best=null;
  for(const p of points||[]){
    if(p?.deletedAt||!isWaterPoint(p))continue;
    const q={latitude:Number(p.latitude),longitude:Number(p.longitude)};if(!valid(q.latitude)||!valid(q.longitude))continue;
    const distance=haversineMeters(c,q);if(distance>maxDistance)continue;
    if(angleGap(bearingDeg(c,q),toward)<=spread&&(!best||distance<best.distance))best={point:p,distance:Math.round(distance)};
  }
  return best;
}

/** « prévision d'il y a 3 h » ; hors connexion, l'âge rappelle que c'est la dernière connue. */
export function forecastAge(weather,now=Date.now(),{online=true}={}){
  if(!weather?.loadedAt)return'';
  const h=Math.floor((now-weather.loadedAt)/HOUR);
  const age=h<1?'à l’instant':h<48?`il y a ${h} h`:`il y a ${Math.floor(h/24)} j`;
  return`${online?'Prévision':'Dernière prévision en cache'} ${age}`;
}
const COMPASS=['N','NE','E','SE','S','SO','O','NO'];
export const compass=deg=>valid(Number(deg))?COMPASS[Math.round(((Number(deg)%360)+360)%360/45)%8]:'';

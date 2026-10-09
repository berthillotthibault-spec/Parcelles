// n° 60 — Fenêtre de traitement : inversion, limite légale, fenêtre réelle, vent vers le cours d'eau.
import test from 'node:test';
import assert from 'node:assert/strict';
import {weatherWindows} from './weather-decision.js';
import {inversionLikely,windowWeather,workWindow,windowWarnings,bearingDeg,windToward,windTowardWater,isWaterPoint,forecastAge,compass,LEGAL_WIND_KMH} from './spray-window.js';
import {registerRows} from './phyto.js';
import {emptyState} from './state.js';

const at=(h,day=8)=>new Date(2026,9,day,h,0).getTime();
function forecast(now,over=()=>({})){
  const h={time:[],temperature_2m:[],relative_humidity_2m:[],precipitation:[],precipitation_probability:[],wind_speed_10m:[],wind_gusts_10m:[],wind_direction_10m:[],cloud_cover:[]};
  for(let i=0;i<72;i++){const d=new Date(2026,9,8,i),v={t:14,rh:70,wind:8,gust:12,dir:270,cloud:80,...over(d.getHours(),i)};
    h.time.push(d.toISOString());h.temperature_2m.push(v.t);h.relative_humidity_2m.push(v.rh);h.precipitation.push(0);h.precipitation_probability.push(0);h.wind_speed_10m.push(v.wind);h.wind_gusts_10m.push(v.gust);h.wind_direction_10m.push(v.dir);h.cloud_cover.push(v.cloud);}
  return{loadedAt:now-3600000,hourly:h};
}

test('inversion probable : nuit, vent < 3 km/h, ciel dégagé', ()=>{
  assert.equal(inversionLikely({hour:22,wind:2,cloudCover:10}),true);
  assert.equal(inversionLikely({hour:6,wind:1,cloudCover:20}),true);
  assert.equal(inversionLikely({hour:14,wind:1,cloudCover:0}),false);
  assert.equal(inversionLikely({hour:22,wind:5,cloudCover:0}),false);
  assert.equal(inversionLikely({hour:22,wind:1,cloudCover:90}),false);
  assert.equal(inversionLikely({hour:22,wind:1}),false);
});

test('créneaux de pulvérisation : inversion à surveiller, limite légale de 19 km/h', ()=>{
  const now=at(12);
  const w=weatherWindows(forecast(now,h=>h>=20||h<8?{wind:1,cloud:5,rh:80,t:10}:{}),'Pulvérisation',{now});
  const night=w.windows.flatMap(x=>x.hours).find(x=>new Date(x.start).getHours()===22);
  assert.equal(night.level,'watch');assert.ok(night.why.some(t=>/Inversion probable/.test(t)));
  const windy=weatherWindows(forecast(now,()=>({wind:21})),'Pulvérisation',{now,rules:{rain:1,wind:30,minTemp:0,maxTemp:40,legalWind:19}});
  assert.ok(windy.windows.every(x=>x.level==='unfavorable'));
  assert.ok(windy.windows[0].hours[0].why.some(t=>/limite légale de 19 km\/h \(3 Beaufort\)/.test(t)));
  assert.equal(LEGAL_WIND_KMH,19);
});

test('valeurs horaires de la fenêtre réelle', ()=>{
  const now=at(12),weather=forecast(now,h=>({wind:h,t:10+h/2,rh:60}));
  const win=windowWeather(weather,at(8),at(11));
  assert.equal(win.hours,3);assert.equal(win.windMax,10);assert.equal(win.tempMin,14);assert.equal(win.tempMax,15);assert.equal(win.humidityMin,60);assert.equal(win.direction,270);
  assert.equal(win.inversion,false);
  assert.deepEqual(workWindow(weather,{date:'2026-10-08',startTime:'08:00',endTime:'11:00'}).windMax,10);
  assert.equal(workWindow(weather,{date:'2026-10-08',startTime:''}),null);
  assert.equal(windowWeather(weather,at(8,20),at(9,20)),null);
  const late=workWindow(forecast(now,h=>({wind:h})),{date:'2026-10-08',startTime:'19:00',endTime:'21:00'});
  assert.ok(windowWarnings(late).some(t=>/au-delà de 19 km\/h/.test(t)));
  const calm=workWindow(forecast(now,()=>({wind:1,cloud:0})),{date:'2026-10-08',startTime:'21:00',endTime:'22:00'});
  assert.ok(windowWarnings(calm).some(t=>/Inversion probable/.test(t)));
});

test('la fenêtre est reprise au registre', ()=>{
  const s=emptyState();s.parcelles=[{id:'p1',nom:'Les Noues',culture:'Blé',surfaceHa:5}];
  s.interventions=[{id:'w',parcelId:'p1',type:'Fongicide',isPhytosanitary:true,status:'Terminé',date:'2026-04-02',weatherSnapshot:{wind:20,temperature:9,humidity:50,window:{windMax:7.5,tempMin:11,tempMax:13.2,humidityMin:55,humidityMax:61}}}];
  const c=registerRows(s,'2025/26')[0].cells;
  assert.equal(c['Vent (km/h)'],7.5);assert.equal(c['Température (°C)'],'11–13.2');assert.equal(c['Hygrométrie (%)'],'55–61');
});

test('vent vers le cours d’eau', ()=>{
  const sq={type:'Polygon',coordinates:[[[5,46],[5.002,46],[5.002,46.002],[5,46.002],[5,46]]]};
  const parcel={id:'p',geometry:sq},east={id:'r',type:'Cours d’eau',nom:'La Reyssouze',latitude:46.001,longitude:5.008};
  assert.ok(Math.abs(bearingDeg({latitude:46,longitude:5},{latitude:46,longitude:5.01})-90)<1);
  assert.equal(windToward(270),90);assert.equal(compass(270),'O');assert.equal(compass(10),'N');
  assert.equal(isWaterPoint(east),true);assert.equal(isWaterPoint({type:'Arbre'}),false);
  const hit=windTowardWater(parcel,[east,{...east,id:'a',type:'Arbre'}],270);
  assert.equal(hit.point.id,'r');assert.ok(hit.distance>400&&hit.distance<600);
  assert.equal(windTowardWater(parcel,[east],90),null);            // vent d'est : souffle vers l'ouest
  assert.equal(windTowardWater(parcel,[{...east,longitude:5.05}],270),null); // trop loin
});

test('âge de la prévision en cache', ()=>{
  const now=at(12);
  assert.equal(forecastAge({loadedAt:now-3*3600000},now),'Prévision il y a 3 h');
  assert.equal(forecastAge({loadedAt:now-50*3600000},now,{online:false}),'Dernière prévision en cache il y a 2 j');
  assert.equal(forecastAge(null,now),'');
});

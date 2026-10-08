// Advisory thresholds, editable by the farmer; never a regulatory authorization.
// Advisory thresholds, editable by the farmer; never a regulatory authorization.
// Champs optionnels : gust (rafales km/h), deltaT [min,max] en °C (pulvérisation), rainFreeHours/rainFreeMm
// (pas de pluie dans les heures qui suivent : traitements foliaires), restAfterRainHours/restRainMm
// (repos du sol après une pluie : épandage).
export const WEATHER_RULES={Semis:{rain:.5,wind:30,minTemp:3,maxTemp:35},Fauche:{rain:.2,wind:30,minTemp:5,maxTemp:35},Pulvérisation:{rain:.1,wind:15,minTemp:5,maxTemp:25,minHumidity:45,maxHumidity:90,gust:25,deltaT:[2,8],rainFreeHours:6,rainFreeMm:.5},Fertilisation:{rain:1,wind:25,minTemp:2,maxTemp:35},Récolte:{rain:.1,wind:30,minTemp:5,maxTemp:38},Épandage:{rain:1,wind:25,minTemp:2,maxTemp:35,restAfterRainHours:48,restRainMm:10}};
const valid=v=>typeof v==='number'&&Number.isFinite(v);
const r1=v=>Math.round(v*10)/10;
export function forecastTime(t,w){if(/Z$|[+-]\d\d:\d\d$/.test(t))return Date.parse(t);return valid(w.utc_offset_seconds)?Date.parse(t+'Z')-w.utc_offset_seconds*1000:Date.parse(t);}
// Température humide approchée (Stull 2011, valable de 5 à 99 % d’humidité) et delta T = sèche − humide.
export function wetBulb(t,rh){if(!valid(t)||!valid(rh))return null;const h=Math.min(99,Math.max(5,rh));return t*Math.atan(.151977*Math.sqrt(h+8.313659))+Math.atan(t+h)-Math.atan(h-1.676331)+.00391838*h**1.5*Math.atan(.023101*h)-4.686035;}
export function deltaT(t,rh){const w=wetBulb(t,rh);return w===null?null:r1(t-w);}
// Humidité relative depuis le point de rosée (Magnus), quand l’humidité manque.
export function humidityFromDewPoint(t,dew){if(!valid(t)||!valid(dew))return null;const g=x=>Math.exp(17.625*x/(243.04+x));return Math.round(Math.min(100,Math.max(0,100*g(dew)/g(t))));}
export function weatherWindows(weather,type,{now=Date.now(),rules=WEATHER_RULES[type]||WEATHER_RULES.Semis,maxAgeHours=6}={}){
  if(!weather?.loadedAt||now-weather.loadedAt>maxAgeHours*3600000)return{windows:[],reason:'Prévisions absentes ou âgées de plus de 6 heures.',confidence:'Données insuffisantes'};
  const h=weather.hourly||{},hours=[],times=(h.time||[]).map(t=>forecastTime(t,weather)),rainAt=i=>h.precipitation?.[i];
  const rainBetween=(from,to)=>{let sum=0,known=false;for(let j=0;j<times.length;j++)if(times[j]>=from&&times[j]<to&&valid(rainAt(j))){sum+=rainAt(j);known=true;}return known?r1(sum):null;};
  for(let i=0;i<times.length;i++){const start=times[i];if(start<now-3600000||start>now+72*3600000)continue;
    const values={rain:rainAt(i),probability:h.precipitation_probability?.[i],wind:h.wind_speed_10m?.[i],gust:h.wind_gusts_10m?.[i],temperature:h.temperature_2m?.[i],humidity:h.relative_humidity_2m?.[i],dewPoint:h.dew_point_2m?.[i],soilTemperature:h.soil_temperature_0cm?.[i]};
    if(!valid(values.humidity)){const rh=humidityFromDewPoint(values.temperature,values.dewPoint);if(rh!==null)values.humidity=rh;}
    if(rules.deltaT&&valid(values.temperature)&&valid(values.humidity))values.deltaT=deltaT(values.temperature,values.humidity);
    const missing=['rain','wind','temperature',...(rules.minHumidity===undefined?[]:['humidity'])].filter(k=>!valid(values[k]));
    const why=[];if(valid(values.rain))why.push(`Pluie ${values.rain} mm/h (seuil ${rules.rain})`);if(valid(values.wind))why.push(`Vent ${values.wind} km/h (seuil ${rules.wind})`);if(valid(values.gust))why.push(`Rafales ${values.gust} km/h${rules.gust?` (seuil ${rules.gust})`:''}`);if(valid(values.temperature))why.push(`Température ${values.temperature} °C (${rules.minTemp}–${rules.maxTemp})`);if(valid(values.humidity))why.push(`Humidité ${values.humidity} %`);if(valid(values.dewPoint))why.push(`Point de rosée ${values.dewPoint} °C`);if(valid(values.soilTemperature))why.push(`Sol en surface ${values.soilTemperature} °C`);
    let bad=values.rain>rules.rain||values.wind>rules.wind||values.temperature<rules.minTemp||values.temperature>rules.maxTemp||(rules.minHumidity!==undefined&&(values.humidity<rules.minHumidity||values.humidity>rules.maxHumidity));
    let risk=!bad&&(values.wind>rules.wind*.8||values.rain>rules.rain*.8||values.probability>50);
    if(rules.gust&&valid(values.gust)){if(values.gust>rules.gust)bad=true;else if(values.gust>rules.gust*.8)risk=true;}
    if(rules.deltaT&&valid(values.deltaT)){const [lo,hi]=rules.deltaT;why.push(`Delta T ${values.deltaT} °C (${lo}–${hi})`);if(values.deltaT>hi+2||values.deltaT<lo-2)bad=true;else if(values.deltaT<lo||values.deltaT>hi)risk=true;}
    if(rules.rainFreeHours){const after=rainBetween(start,start+rules.rainFreeHours*3600000);if(after!==null){why.push(`Pluie dans les ${rules.rainFreeHours} h suivantes : ${after} mm (seuil ${rules.rainFreeMm??rules.rain})`);if(after>(rules.rainFreeMm??rules.rain))bad=true;}}
    if(rules.restAfterRainHours){const before=rainBetween(start-rules.restAfterRainHours*3600000,start);if(before!==null&&before>=(rules.restRainMm??10)){why.push(`Repos de ${rules.restAfterRainHours} h après la pluie : ${before} mm tombés`);bad=true;}}
    if(bad)risk=false;
    hours.push({start,end:start+3600000,level:missing.length?'unknown':bad?'unfavorable':risk?'watch':'favorable',values,why:missing.length?[...why,'Données manquantes : '+missing.join(', ')]:why});
  }
  const windows=[];for(const hour of hours){const last=windows.at(-1);if(last&&last.level===hour.level&&last.end===hour.start){last.end=hour.end;last.hours.push(hour);}else windows.push({start:hour.start,end:hour.end,level:hour.level,hours:[hour]});}
  return{windows,confidence:hours.some(h=>h.level==='unknown')?'Données incomplètes':'Estimation météo',rules};
}
export async function parcelForecast(parcel,storage,scope,{refresh=false}={}){
  const {geometryCentroid}=await import('./utils.js');const center=geometryCentroid(parcel.geometry);if(!center)throw Error('Contour nécessaire pour localiser la prévision.');
  const latitude=center.latitude,longitude=center.longitude,key='decision-weather:'+scope,entries=await storage.get(key)||[],id=`${latitude.toFixed(3)},${longitude.toFixed(3)}`,cached=entries.find(r=>r.id===id);
  if(cached&&(!refresh||navigator.onLine===false))return cached.data;
  if(navigator.onLine===false)throw Error('Pas de prévision en cache pour cette parcelle.');
  const response=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,dew_point_2m,soil_temperature_0cm&timezone=auto&forecast_days=7`,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('Service météo indisponible.');const data={...await response.json(),loadedAt:Date.now(),latitude,longitude};if(!data.hourly?.time?.length)throw Error('Prévisions incomplètes.');await storage.set(key,[{id,data},...entries.filter(r=>r.id!==id)].slice(0,8));return data;
}

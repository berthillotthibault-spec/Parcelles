// Advisory thresholds, editable by the farmer; never a regulatory authorization.
export const WEATHER_RULES={Semis:{rain:.5,wind:30,minTemp:3,maxTemp:35},Fauche:{rain:.2,wind:30,minTemp:5,maxTemp:35},Pulvérisation:{rain:.1,wind:15,minTemp:5,maxTemp:25,minHumidity:45,maxHumidity:90},Fertilisation:{rain:1,wind:25,minTemp:2,maxTemp:35},Récolte:{rain:.1,wind:30,minTemp:5,maxTemp:38},Épandage:{rain:1,wind:25,minTemp:2,maxTemp:35}};
const valid=v=>typeof v==='number'&&Number.isFinite(v);
export function forecastTime(t,w){if(/Z$|[+-]\d\d:\d\d$/.test(t))return Date.parse(t);return valid(w.utc_offset_seconds)?Date.parse(t+'Z')-w.utc_offset_seconds*1000:Date.parse(t);}
export function weatherWindows(weather,type,{now=Date.now(),rules=WEATHER_RULES[type]||WEATHER_RULES.Semis}={}){
  if(!weather?.loadedAt||now-weather.loadedAt>6*3600000)return{windows:[],reason:'Prévisions absentes ou âgées de plus de 6 heures.',confidence:'Données insuffisantes'};
  const h=weather.hourly||{},hours=[];
  for(let i=0;i<(h.time||[]).length;i++){const start=forecastTime(h.time[i],weather);if(start<now-3600000||start>now+72*3600000)continue;
    const values={rain:h.precipitation?.[i],probability:h.precipitation_probability?.[i],wind:h.wind_speed_10m?.[i],temperature:h.temperature_2m?.[i],humidity:h.relative_humidity_2m?.[i]};
    const missing=['rain','wind','temperature',...(rules.minHumidity===undefined?[]:['humidity'])].filter(k=>!valid(values[k]));
    const why=[];if(valid(values.rain))why.push(`Pluie ${values.rain} mm/h (seuil ${rules.rain})`);if(valid(values.wind))why.push(`Vent ${values.wind} km/h (seuil ${rules.wind})`);if(valid(values.temperature))why.push(`Température ${values.temperature} °C (${rules.minTemp}–${rules.maxTemp})`);if(valid(values.humidity))why.push(`Humidité ${values.humidity} %`);
    const bad=values.rain>rules.rain||values.wind>rules.wind||values.temperature<rules.minTemp||values.temperature>rules.maxTemp||(rules.minHumidity!==undefined&&(values.humidity<rules.minHumidity||values.humidity>rules.maxHumidity));
    const risk=!bad&&(values.wind>rules.wind*.8||values.rain>rules.rain*.8||values.probability>50);
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
  const response=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m&timezone=auto&forecast_days=7`,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('Service météo indisponible.');const data={...await response.json(),loadedAt:Date.now(),latitude,longitude};if(!data.hourly?.time?.length)throw Error('Prévisions incomplètes.');await storage.set(key,[{id,data},...entries.filter(r=>r.id!==id)].slice(0,8));return data;
}

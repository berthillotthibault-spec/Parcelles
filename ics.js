// Export calendrier iCalendar (RFC 5545) : travaux et tâches à importer dans l'agenda du téléphone,
// avec une alarme (VALARM) qui sonne même application fermée. Logique pure, sans DOM.
import {agendaDate,isPending,localDay} from './home-priorities.js';

const CRLF='\r\n';
const pad=n=>String(n).padStart(2,'0');

// Échappement des valeurs TEXT (RFC 5545 §3.3.11) : \ ; , et retours à la ligne.
export function icsEscape(value){
  return String(value??'').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r\n|\r|\n/g,'\\n');
}

// Pliage des lignes à 75 octets UTF-8 (§3.1), sans couper un caractère multi-octet.
export function foldLine(line){
  const encoder=new TextEncoder();
  if(encoder.encode(line).length<=75)return line;
  const parts=[];let current='',size=0,limit=75;
  for(const char of line){
    const bytes=encoder.encode(char).length;
    if(size+bytes>limit){parts.push(current);current='';size=0;limit=74;}
    current+=char;size+=bytes;
  }
  if(current)parts.push(current);
  return parts.join(CRLF+' ');
}

const compactDate=day=>day.replace(/-/g,'');
export function utcStamp(date=new Date()){
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth()+1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}
function addDays(day,n){const d=new Date(`${day}T12:00:00`);d.setDate(d.getDate()+n);return localDay(d);}
const validTime=value=>/^\d{2}:\d{2}$/.test(String(value||''))?String(value):'';

// UID stable : réimporter le même fichier met l'événement à jour au lieu de le dupliquer.
export function icsUid(kind,id){return `parcelles-${kind}-${String(id).replace(/[^A-Za-z0-9_.-]/g,'_')}@parcelles.app`;}

// Événement neutre (indépendant du format) à partir d'un travail ou d'une tâche.
export function itemEvent(item,kind='work',{parcelName='',alarmMinutes=30}={}){
  const day=agendaDate(item,kind);if(!day)return null;
  const title=kind==='task'?(item.title||'Tâche'):(item.type||'Travail');
  const start=validTime(item.startTime),end=validTime(item.endTime);
  const notes=[parcelName&&`Parcelle : ${parcelName}`,item.status&&`Statut : ${item.status}`,item.notes||item.note||item.description||''].filter(Boolean);
  return {uid:icsUid(kind,item.id),kind,id:item.id,day,start,end,duration:Number(item.duration)>0?Number(item.duration):null,
    summary:parcelName?`${title} · ${parcelName}`:title,location:parcelName,description:notes.join('\n'),sequence:Math.max(0,Number(item.version)||0),alarmMinutes};
}

// Travaux et tâches à faire des N prochains jours (retards exclus : ils ne sonnent plus).
export function upcomingEvents(state,{from=localDay(),days=30}={}){
  const until=addDays(from,days),parcels=new Map((state.parcelles||[]).map(p=>[p.id,p.nom||'']));
  const rows=[];
  for(const [type,kind] of [['interventions','work'],['tasks','task']])for(const item of state[type]||[]){
    if(item.deletedAt||!isPending(item,kind))continue;
    const parcelId=item.parcelId||(item.parcelIds||[])[0];
    const event=itemEvent(item,kind,{parcelName:parcels.get(parcelId)||''});
    if(event&&event.day>=from&&event.day<until)rows.push(event);
  }
  return rows.sort((a,b)=>a.day.localeCompare(b.day)||(a.start||'99').localeCompare(b.start||'99')||a.summary.localeCompare(b.summary,'fr'));
}

function plusHours(day,time,hours){const d=new Date(`${day}T${time}:00`);d.setMinutes(d.getMinutes()+Math.round(hours*60));return {day:localDay(d),time:`${pad(d.getHours())}:${pad(d.getMinutes())}`};}
const localStamp=(day,time)=>`${compactDate(day)}T${time.replace(':','')}00`;

export function eventLines(event,{stamp=utcStamp(),notice=''}={}){
  const lines=['BEGIN:VEVENT',`UID:${event.uid}`,`DTSTAMP:${stamp}`,`SEQUENCE:${event.sequence||0}`];
  if(event.start){
    // Heure locale « flottante » : l'agenda la place dans le fuseau du téléphone.
    const end=event.end&&event.end>event.start?{day:event.day,time:event.end}:plusHours(event.day,event.start,event.duration||1);
    lines.push(`DTSTART:${localStamp(event.day,event.start)}`,`DTEND:${localStamp(end.day,end.time)}`);
  }else lines.push(`DTSTART;VALUE=DATE:${compactDate(event.day)}`,`DTEND;VALUE=DATE:${compactDate(addDays(event.day,1))}`);
  lines.push(`SUMMARY:${icsEscape(event.summary)}`);
  if(event.location)lines.push(`LOCATION:${icsEscape(event.location)}`);
  const description=[event.description,notice].filter(Boolean).join('\n\n');
  if(description)lines.push(`DESCRIPTION:${icsEscape(description)}`);
  lines.push(`CATEGORIES:${event.kind==='task'?'Tâche':'Travail'}`,'TRANSP:TRANSPARENT');
  // Alarme : 30 min avant un créneau horaire, ou 7 h le jour même pour une journée entière.
  const trigger=event.start?`-PT${Math.max(0,Number(event.alarmMinutes)||30)}M`:'PT7H';
  lines.push('BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${icsEscape(event.summary)}`,`TRIGGER:${trigger}`,'END:VALARM','END:VEVENT');
  return lines;
}

export const ICS_NOTICE='Exporté depuis Parcelles. Une modification ultérieure dans Parcelles n’est pas répercutée : réexportez puis réimportez le fichier.';

export function buildCalendar(events,{name='Parcelles',stamp=utcStamp(),notice=ICS_NOTICE}={}){
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Parcelles//Agenda//FR','CALSCALE:GREGORIAN','METHOD:PUBLISH',`X-WR-CALNAME:${icsEscape(name)}`];
  for(const event of events)lines.push(...eventLines(event,{stamp,notice}));
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF)+CRLF;
}

// Lecture minimale (tests et contrôle) : déplie les lignes et rend les propriétés de chaque VEVENT.
export function parseIcsEvents(text){
  const lines=String(text).replace(/\r\n[ \t]/g,'').split(/\r\n/);const events=[];let current=null,depth=0;
  for(const line of lines){
    if(line==='BEGIN:VEVENT'){current={};depth=0;continue;}
    if(line==='END:VEVENT'){events.push(current);current=null;continue;}
    if(!current)continue;
    if(line.startsWith('BEGIN:')){depth+=1;current.alarm=true;continue;}
    if(line.startsWith('END:')){depth-=1;continue;}
    if(depth)continue;
    const colon=line.indexOf(':');const key=line.slice(0,colon).split(';')[0];
    current[key]=line.slice(colon+1).replace(/\\n/g,'\n').replace(/\\([\\;,])/g,'$1');
  }
  return events;
}

export function icsFileName(base){return `${String(base||'parcelles').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase()||'parcelles'}.ics`;}

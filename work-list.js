// n° 31 - Listes de travaux sans redondance et geste de balayage. Logique pure.
const fr=n=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(Number(n)||0);

// Métadonnées utiles d'un travail du jour (la date, déjà connue, n'est pas répétée).
export function workMeta(work,{parcel=null,machineName=''}={}){
  const surface=Number(work?.surfaceWorked)||Number(parcel?.surfaceHa)||0;
  return[surface?`${fr(surface)} ha`:'',machineName||'',work?.operator||''].map(s=>String(s||'').trim()).filter(Boolean);
}

export function tomorrowIso(today){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today||''));const d=m?new Date(+m[1],+m[2]-1,+m[3]):new Date();d.setDate(d.getDate()+1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
// Report : la date prévue passe à demain, sans toucher au reste.
export const postponedWork=(work,today)=>({...work,plannedDate:tomorrowIso(today)});

// Suivi d'un geste : axe verrouillé après lockPx, seuil d'action, droite = Fait, gauche = Reporter.
export function createSwipeTracker({threshold=96,lockPx=8}={}){
  let x0=0,y0=0,axis=null,dx=0,active=false;
  return{
    start(x,y){x0=x;y0=y;axis=null;dx=0;active=true;},
    move(x,y){
      if(!active)return{axis:null,dx:0,crossed:null};
      const mx=x-x0,my=y-y0;
      if(!axis&&Math.max(Math.abs(mx),Math.abs(my))>=lockPx)axis=Math.abs(mx)>Math.abs(my)?'x':'y';
      dx=axis==='x'?mx:0;
      return{axis,dx,progress:Math.min(1,Math.abs(dx)/threshold),crossed:Math.abs(dx)>=threshold?(dx>0?'done':'postpone'):null};
    },
    end(){const result=active&&axis==='x'&&Math.abs(dx)>=threshold?(dx>0?'done':'postpone'):null;active=false;axis=null;dx=0;return result;},
    cancel(){active=false;axis=null;dx=0;},
    get axis(){return axis;}
  };
}

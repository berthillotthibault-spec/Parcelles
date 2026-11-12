// Âge d'un barème de référence daté (analyses de sol, fourrages…) : signale une table de plus
// d'un an, à vérifier. Logique pure, sans réseau.

const isoDay=v=>{
  if(v instanceof Date)return Number.isFinite(v.getTime())?`${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`:'';
  const s=String(v??'').slice(0,10);
  return/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(`${s}T12:00:00`))?s:'';
};

/** Âge en mois révolus de `table.date` (ou d'une date directe) au jour `today`. */
export function referenceAge(table,today,{maxMonths=12}={}){
  const from=isoDay(typeof table==='object'&&table&&!(table instanceof Date)?table.date:table),to=isoDay(today);
  if(!from||!to)return{months:null,old:false};
  const [y1,m1,d1]=from.split('-').map(Number),[y2,m2,d2]=to.split('-').map(Number);
  let months=(y2-y1)*12+(m2-m1);if(d2<d1)months-=1;
  return{months,old:months>=maxMonths&&!(months===maxMonths&&d2===d1)};
}

/** Badge « Barème de plus d'un an, à vérifier », ou chaîne vide si le barème est récent ou non daté. */
export function referenceAgeBadge(table,today,opts){
  return referenceAge(table,today,opts).old?'<span class="badge warning">Barème de plus d’un an, à vérifier</span>':'';
}

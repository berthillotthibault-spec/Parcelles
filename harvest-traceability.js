import {active,completed} from './farm-memory.js';import {campaignFor} from './utils.js';
// Campagne d’un lot : celle de la culture récoltée, pas celle de la date de récolte. Un maïs semé en avril
// et récolté en octobre appartient à la campagne du semis (campaignFor fait commencer la campagne en août).
// Ordre : campaignId posé sur le lot, dernier semis réalisé (hors couvert) dans les 15 mois avant la récolte,
// rotation de la même culture (campagne précédente d’abord pour une récolte d’août à décembre), sinon campaignFor(date).
const prevCampaign=c=>{const y=Number(String(c).slice(0,4))-1;return`${y}/${String(y+1).slice(-2)}`;};
const workCamp=w=>w.campaignId||(w.date?campaignFor(w.date):null);
export function harvestCampaign(state,lot){
  if(lot?.campaignId)return lot.campaignId;
  if(!lot?.date)return null;
  const day=String(lot.date).slice(0,10),start=new Date(`${day}T12:00:00`);start.setDate(start.getDate()-450);const from=start.toISOString().slice(0,10);
  const sow=active(state,'interventions').filter(w=>w.parcelId===lot.parcelId&&completed(w)&&w.date&&String(w.date).slice(0,10)<=day&&String(w.date).slice(0,10)>=from&&/semis/i.test(w.type||'')&&!/couvert|cipan|interculture|derob/i.test(`${w.type||''} ${w.culture||''}`)).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
  if(sow)return workCamp(sow);
  const own=campaignFor(lot.date),crop=String(lot.crop||'').trim().toLowerCase();
  if(crop){const rots=active(state,'rotations').filter(r=>r.parcelId===lot.parcelId&&String(r.culture||'').trim().toLowerCase()===crop);for(const c of (Number(day.slice(5,7))>=8?[prevCampaign(own),own]:[own,prevCampaign(own)]))if(rots.some(r=>r.campaignId===c))return c;}
  return own;
}
export function harvestTrace(state,lot){const parcel=active(state,'parcelles').find(p=>p.id===lot.parcelId),campaign=harvestCampaign(state,lot),own=campaignFor(lot.date),works=active(state,'interventions').filter(w=>w.parcelId===lot.parcelId&&completed(w)&&w.date<=lot.date&&(workCamp(w)===campaign||(campaign!==own&&campaignFor(w.date)===own)));return{lot,parcel,campaign,culture:lot.crop||active(state,'rotations').find(r=>r.parcelId===lot.parcelId&&r.campaignId===campaign)?.culture||null,works,documents:active(state,'documents').filter(d=>d.parcelId===lot.parcelId||works.some(w=>w.id===d.interventionId)),sales:lot.sales||[]};}
export function parcelFollowupScore(state,parcel){const works=active(state,'interventions').filter(w=>w.parcelId===parcel.id&&completed(w));if(!works.length)return null;const criteria=[{label:'Travaux datés',known:works.filter(w=>!!w.date).length,total:works.length},{label:'Coûts renseignés',known:works.filter(w=>typeof w.cost==='number'&&Number.isFinite(w.cost)).length,total:works.length},{label:'Surfaces renseignées',known:works.filter(w=>typeof w.surfaceWorked==='number'&&w.surfaceWorked>0).length,total:works.length},{label:'Opérateurs renseignés',known:works.filter(w=>!!w.operator).length,total:works.length}];return{score:Math.round(criteria.reduce((s,c)=>s+c.known/c.total,0)/criteria.length*100),criteria,label:'Complétude du suivi, pas un score agronomique ni de rentabilité'};}

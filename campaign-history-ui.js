// n° 92 — Écran « Historique des campagnes » : tableau pluriannuel coloré, mini-courbes,
// moyennes olympiques et parcelles régulièrement sous la moyenne. Lecture seule.
import {escapeHtml as e,campaignFor} from './utils.js';
import {economicColor} from './pilotage.js';
import {campaignHistory,underperformers,sparkPoints,METRICS} from './campaign-history.js';

const n0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0});
const eur=v=>v===null||v===undefined||!Number.isFinite(v)?'—':`${v<0?'−':''}${n0.format(Math.abs(v))}`;

function spark(values,label){
  const p=sparkPoints(values);if(!p.length)return'';
  const d=p.map((x,i)=>`${i?'L':'M'}${x[0]} ${x[1]}`).join('');
  return`<svg class="chart chart-spark" viewBox="0 0 64 20" width="64" height="20" role="img" aria-label="${e(label)}"><path class="chart-line" d="${d}" fill="none"/><circle class="chart-dot" cx="${p.at(-1)[0]}" cy="${p.at(-1)[1]}" r="2.5"/></svg>`;
}

export function createCampaignHistoryUI({store,modal}){
  const data=()=>store.snapshot?store.snapshot():store.state;
  let opts={by:'culture',years:5,metric:'marginHa',campaign:campaignFor()};

  const chips=(name,list)=>list.map(([v,l])=>`<button type="button" class="choice-chip${String(opts[name])===String(v)?' is-on':''}" aria-pressed="${String(opts[name])===String(v)}" data-ch="${name}" data-value="${e(v)}">${e(l)}</button>`).join('');

  function cell(c,campaign,mode){
    if(!c||c.value===null)return`<td class="ch-cell is-empty">${c?'<small>produit inconnu</small>':'—'}</td>`;
    const col=economicColor(c.value,mode);
    return`<td class="ch-cell"><button type="button" class="ch-value" style="--ch-color:${e(col.color)}" data-action="open-crop-margins" data-campaign="${e(campaign)}" title="${e(`${campaign} · ${col.label}${c.culture?` · ${c.culture}`:''} · fiable à ${c.reliability} %`)}">${e(eur(c.value))}${c.partial?'<sup aria-label="partielle">*</sup>':''}${c.culture?`<small>${e(c.culture)}</small>`:''}</button></td>`;
  }

  function open(next={}){
    opts={...opts,...next};
    render(campaignHistory(data(),opts));
  }

  function render(h){
    const metric=METRICS[h.metric],weak=underperformers(h);
    modal('Historique des campagnes',`${h.campaigns[0]} → ${h.campaigns.at(-1)} · ${metric.label} en €/ha`,`
<div class="cm-tabs" role="group" aria-label="Regrouper par">${chips('by',[['culture','Par culture'],['parcel','Par parcelle']])}</div>
<div class="cm-tabs" role="group" aria-label="Indicateur et durée">${chips('metric',Object.entries(METRICS).map(([k,v])=>[k,v.label]))}${chips('years',[[3,'3 ans'],[4,'4 ans'],[5,'5 ans']])}</div>
<div class="econ-table-wrap"><table class="econ-table ch-table"><thead><tr><th>${h.by==='parcel'?'Parcelle':'Culture'}</th>${h.campaigns.map(c=>`<th>${e(c)}</th>`).join('')}<th>Moyenne olympique</th><th>Tendance</th></tr></thead><tbody>
${h.rows.map(r=>`<tr><th scope="row">${e(r.label)}</th>${r.cells.map((c,i)=>cell(c,h.campaigns[i],metric.mode)).join('')}<td><strong>${e(eur(r.mean.value))}</strong>${r.mean.kind==='simple'?'<small> simple</small>':''}</td><td>${spark(r.values,`${metric.label} ${r.label} : ${r.values.map((v,i)=>`${h.campaigns[i]} ${v===null?'inconnue':n0.format(v)}`).join(', ')}`)}</td></tr>`).join('')||`<tr><td colspan="${h.campaigns.length+3}">Aucune parcelle en propre.</td></tr>`}
<tr class="ch-farm"><th scope="row">Exploitation</th>${h.farm.map((v,i)=>cell(v===null?{value:null}:{value:v,reliability:100},h.campaigns[i],metric.mode)).join('')}<td><strong>${e(eur(h.farmMean.value))}</strong></td><td>${spark(h.farm,`${metric.label} de l’exploitation`)}</td></tr></tbody></table></div>
<p class="form-note">* valeur partielle (travaux sans coût ou produit inconnu). Touchez une valeur pour ouvrir les marges de la campagne. Moyenne olympique : sans la meilleure ni la pire année (référence utile pour l’assurance récolte).</p>
<h3>${h.metric==='costHa'?'Charges régulièrement au-dessus de la moyenne':'Régulièrement sous la moyenne'}</h3>
${weak.length?`<ul class="stock-alerts">${weak.map(w=>`<li class="is-warning">${e(w.text)}</li>`).join('')}</ul>`:'<p class="form-note">Aucune ligne n’est sous la moyenne de l’exploitation plus d’une année sur deux.</p>'}`,
    '<button type="button" class="button primary" data-action="close-modal">Fermer</button>','large');
  }

  document.addEventListener('click',ev=>{const c=ev.target.closest('[data-ch]');if(!c)return;const v=c.dataset.value;open({[c.dataset.ch]:c.dataset.ch==='years'?Number(v):v});});
  return{open,render};
}

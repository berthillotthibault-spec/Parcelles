// n° 87 et n° 69 — Écran « Coût réel du matériel » et encart de la fiche matériel.
// Écritures : barème (préférences), coût horaire saisi de l'engin et tarif d'un client, toujours
// après une confirmation explicite.
import {escapeHtml as e,campaignFor} from './utils.js';
import {validateForm} from './form-chips-ui.js';
import {active} from './farm-memory.js';
import {machineCosts,machineCost,machineRates,validateRates,underuseText,gapTone,hourlyCostPatch,RATE_CATEGORIES,RATES_NOTE,categoryLabel} from './machine-costs.js';

const n0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}),n1=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1});
const eur=v=>v===null||v===undefined||!Number.isFinite(v)?'—':`${n0.format(v)} €`;
const shift=(c,n)=>{const y=Number(String(c).slice(0,4))+n;return`${y}/${String(y+1).slice(-2)}`;};
const pct=v=>v===null||v===undefined?'':`${v>0?'+':v<0?'−':''}${n0.format(Math.abs(v))} %`;

export function createMachineCostsUI({store,modal,toast,refreshEquipment=()=>{}}){
  const data=()=>store.snapshot?store.snapshot():store.state;
  const $=s=>document.querySelector(s);
  let current=campaignFor();

  function costLines(r){
    return`<div class="preview-summary"><div class="preview-stat"><strong>${r.perHour===null?'—':`${eur(r.perHour)}/h`}</strong><small>coût réel par heure</small></div><div class="preview-stat"><strong>${r.perHa===null?'—':`${eur(r.perHa)}/ha`}</strong><small>coût réel par hectare</small></div><div class="preview-stat"><strong>${n1.format(r.hours)} h</strong><small>${n1.format(r.hectares)} ha travaillés</small></div><div class="preview-stat"><strong>${r.completeness===null?'—':`${r.completeness} %`}</strong><small>travaux avec heures</small></div></div>
<p class="form-note">Campagne ${e(r.campaign)} : amortissement ${eur(r.amortization)} + assurance ${eur(r.insurance)} + entretiens ${eur(r.maintenance)}${r.maintenanceCount?` (${r.maintenanceCount})`:''} + carburant ${eur(r.fuel)}${r.fuelSource?` (${r.fuelSource==='pleins'?'pleins de l’engin':r.fuelSource==='travaux'?'carburant des travaux':'estimé : l/h × heures'})`:''} = <strong>${eur(r.total)}</strong>.${r.missing.length?` Manque : ${e(r.missing.join(', '))}.`:''}${r.estimated?' Le carburant est estimé, pas mesuré.':''}</p>
<div class="mc-compare"><span>Tarif saisi : <strong>${r.entered===null?'—':`${eur(r.entered)}/h`}</strong>${r.gapPct!==null?` <em class="mc-gap ${r.gapPct>0?'is-bad':'is-good'}">réel ${pct(r.gapPct)}</em>`:''}</span><span>Barème « ${e(categoryLabel(r.category))} » : <strong>${r.refValue===null?'non saisi':`${eur(r.refValue)}/${r.refUnit}`}</strong>${r.refGapPct!==null?` <em class="mc-gap ${gapTone(r.refGapPct)}">réel ${pct(r.refGapPct)}</em>`:''}</span>${r.remaining!==null?`<span>Entretien : <strong>${r.remaining<=0?`dépassé de ${n0.format(Math.abs(r.remaining))} h`:`dans ${n0.format(r.remaining)} h`}</strong></span>`:''}</div>
${r.completeness!==null&&r.completeness<80?`<p class="notice warning">Seuls ${r.completeness} % des travaux ont des heures : le coût horaire réel est surestimé.</p>`:''}`;
  }

  function actionsHtml(r){
    const clients=active(data(),'clients');
    const update=r.perHour!==null&&(r.entered===null||Math.abs(r.gapPct)>=1)?`<button type="button" class="button secondary" data-mc="ask-hourly" data-id="${e(r.id)}">Mettre à jour le coût horaire saisi</button>`:'';
    const client=clients.length&&(r.perHour!==null||r.perHa!==null)?`<label class="mc-client">Tarif de prestation d’un client<select data-mc-client="${e(r.id)}"><option value="">Choisir un client…</option>${clients.map(c=>`<option value="${e(c.id)}">${e(c.name||'Client')}</option>`).join('')}</select></label><button type="button" class="button secondary" data-mc="ask-client" data-id="${e(r.id)}">Utiliser comme tarif de prestation</button>`:'';
    return update||client?`<div class="mc-actions" data-mc-box="${e(r.id)}">${update}${client}</div><div class="mc-confirm" data-mc-confirm="${e(r.id)}" hidden></div>`:'';
  }

  /** Encart de la fiche matériel. */
  function equipmentHtml(m){
    const r=machineCost(data(),m,{campaign:campaignFor()});
    if(!r.entries&&r.total===0)return'';
    return`<h3>Coût réel (campagne ${e(r.campaign)})</h3>${costLines(r)}${actionsHtml(r)}${r.underused?`<p class="notice warning">${e(underuseText(r))}</p>`:''}<button type="button" class="button secondary" data-action="open-machine-costs">Comparer tout le matériel</button>`;
  }

  function ratesForm(rates){
    const machines=active(data(),'materiels');
    return`<details class="mc-rates"${RATE_CATEGORIES.every(c=>rates.values[c.key].value===null)?' open':''}><summary>Barème de référence (entraide, CUMA)</summary>
<form id="mc-rates-form" class="form-grid"><label>Millésime<input name="year" type="number" min="2000" max="2100" step="1" value="${e(rates.year??'')}" placeholder="ex. 2025"></label><label>Source<input name="source" value="${e(rates.source)}" placeholder="ex. barème BCMA de ma région"></label>
${RATE_CATEGORIES.map(c=>`<label>${e(c.label)}<span class="mc-rate"><input name="rate_${c.key}" type="number" min="0" max="5000" step="any" inputmode="decimal" value="${e(rates.values[c.key].value??'')}"><select name="unit_${c.key}" aria-label="Unité ${e(c.label)}"><option value="h"${rates.values[c.key].unit==='h'?' selected':''}>€/h</option><option value="ha"${rates.values[c.key].unit==='ha'?' selected':''}>€/ha</option></select></span></label>`).join('')}
<label>Sous-utilisé en dessous de (h/campagne)<input name="underuseHours" type="number" min="1" max="2000" step="1" value="${e(rates.underuseHours)}"></label>
<p class="form-error span-2" id="mc-rates-error" role="alert" hidden></p></form>
${machines.length?`<h4>Catégorie de chaque engin</h4><div class="stack-list">${machines.map(m=>{const r=machineCost(data(),m,{campaign:current,rates});return`<label class="list-row"><span>${e(m.nom||'Matériel')}</span><select data-mc-assign="${e(m.id)}">${RATE_CATEGORIES.map(c=>`<option value="${c.key}"${c.key===r.category?' selected':''}>${e(c.label)}</option>`).join('')}</select></label>`;}).join('')}</div>`:''}
<p class="form-note">${e(RATES_NOTE)}${rates.updatedAt?` Mis à jour le ${e(new Date(rates.updatedAt).toLocaleDateString('fr-FR'))}.`:''}</p><button type="button" class="button secondary" data-mc="save-rates">Enregistrer le barème</button></details>`;
  }

  function open({campaign}={}){
    if(campaign)current=campaign;
    const m=machineCosts(data(),{campaign:current});
    modal('Coût réel du matériel',`Campagne ${m.campaign} · ${m.rates.year?`barème ${m.rates.year}${m.rates.source?` (${m.rates.source})`:''}`:'barème non renseigné'}`,`
<div class="cm-tabs" role="group" aria-label="Campagne"><button type="button" class="choice-chip" data-mc="campaign" data-campaign="${e(shift(m.campaign,-1))}">← ${e(shift(m.campaign,-1))}</button><button type="button" class="choice-chip is-on" aria-pressed="true">${e(m.campaign)}</button><button type="button" class="choice-chip" data-mc="campaign" data-campaign="${e(shift(m.campaign,1))}">${e(shift(m.campaign,1))} →</button></div>
${m.alerts.length?`<ul class="stock-alerts">${m.alerts.map(r=>`<li class="is-warning">${e(underuseText(r))}</li>`).join('')}</ul>`:''}
<div class="mc-list">${m.rows.length?m.rows.map(r=>`<article class="mc-card"><header><h3>${e(r.name)}</h3><small>${e(categoryLabel(r.category))}${r.reliable?'':' · valeur à consolider'}</small></header>${costLines(r)}${actionsHtml(r)}</article>`).join(''):'<div class="empty-state">Aucun matériel enregistré.</div>'}</div>
${ratesForm(m.rates)}
<details class="margin-rules"><summary>Comment ce coût est calculé</summary><ul><li>Coût complet = amortissement annuel + assurance annuelle + entretiens datés de la campagne + carburant.</li><li>Carburant : pleins de l’engin (écran Carburant GNR), sinon carburant saisi dans les travaux, sinon consommation l/h × heures × prix moyen (estimé).</li><li>Heures et hectares : travaux terminés liés à l’engin et réalisations TP de la campagne. Un travail sans heures fait monter le €/h : regardez le taux de complétude.</li><li>Le barème est le vôtre : aucune valeur n’est fournie par Parcelles.</li></ul></details>`,
    '<button type="button" class="button primary" data-action="close-modal">Fermer</button>','large');
  }

  const row=id=>{const m=store.get('materiels',id);return m?machineCost(data(),m,{campaign:document.querySelector('.mc-list')?current:campaignFor()}):null;};
  const confirmBox=(id,html)=>{const box=document.querySelector(`[data-mc-confirm="${CSS.escape(id)}"]`);if(box){box.innerHTML=html;box.hidden=false;}};
  const after=id=>{if(document.querySelector('.mc-list'))open();else refreshEquipment(id);};

  async function action(kind,c){
    const id=c.dataset.id;
    if(kind==='campaign')return open({campaign:c.dataset.campaign});
    if(kind==='cancel'){const box=c.closest('.mc-confirm');if(box)box.hidden=true;return;}
    if(kind==='ask-hourly'){const r=row(id);if(!r||r.perHour===null)return;return confirmBox(id,`<p>${r.entered===null?`Enregistrer le coût horaire réel (${eur(r.perHour)}/h) dans la fiche ?`:`Mettre à jour le coût horaire saisi (${eur(r.entered)}/h) avec la valeur réelle (${eur(r.perHour)}/h) ?`} Les futurs coûts estimés des travaux l’utiliseront ; les travaux déjà chiffrés ne changent pas.</p><button type="button" class="button secondary" data-mc="cancel">Annuler</button><button type="button" class="button primary" data-mc="confirm-hourly" data-id="${e(id)}">Confirmer</button>`);}
    if(kind==='confirm-hourly'){const m=store.get('materiels',id),r=row(id);if(!m||!r)return;await store.upsert('materiels',hourlyCostPatch(m,r),{label:`Coût horaire ${m.nom} : ${r.perHour} €/h`});toast('Coût horaire mis à jour.','success');return after(id);}
    if(kind==='ask-client'){const r=row(id),sel=document.querySelector(`[data-mc-client="${CSS.escape(id)}"]`),client=sel?.value?store.get('clients',sel.value):null;if(!r)return;if(!client)return toast('Choisissez d’abord un client.','error');
      const perHa=r.refUnit==='ha'&&r.perHa!==null;const field=perHa?'hectareRate':'hourlyRate',value=perHa?r.perHa:r.perHour;if(value===null)return toast('Coût réel inconnu.','error');
      return confirmBox(id,`<p>Tarif ${perHa?'à l’hectare':'horaire'} de ${e(client.name||'ce client')} : ${client[field]?`${eur(Number(client[field]))} → `:''}${eur(value)}/${perHa?'ha':'h'} ? C’est le coût réel, sans main-d’œuvre ni marge : ajustez-le dans la fiche client si besoin.</p><button type="button" class="button secondary" data-mc="cancel">Annuler</button><button type="button" class="button primary" data-mc="confirm-client" data-id="${e(id)}" data-client="${e(client.id)}" data-field="${field}" data-value="${value}">Confirmer</button>`);}
    if(kind==='confirm-client'){const client=store.get('clients',c.dataset.client);if(!client)return;await store.upsert('clients',{...client,[c.dataset.field]:Number(c.dataset.value)},{label:`Tarif de ${client.name||'client'} mis à jour`});toast('Tarif du client enregistré.','success');return after(id);}
    if(kind==='save-rates'){
      const form=$('#mc-rates-form'),err=$('#mc-rates-error');if(!form||!validateForm(form))return;
      const res=validateRates(Object.fromEntries(new FormData(form)));if(res.error){err.textContent=res.error;err.hidden=false;return;}
      const assign={...machineRates(data()).assign};document.querySelectorAll('[data-mc-assign]').forEach(s=>{assign[s.dataset.mcAssign]=s.value;});
      await store.setPreferences({machineRates:{...res.value,underuseHours:res.value.underuseHours,assign,updatedAt:Date.now()}});toast('Barème enregistré.','success');return open();
    }
  }
  document.addEventListener('click',ev=>{const c=ev.target.closest('[data-mc]');if(!c||c.disabled)return;c.disabled=true;action(c.dataset.mc,c).catch(err=>toast(err.message,'error')).finally(()=>{c.disabled=false;});});
  return{open,equipmentHtml};
}

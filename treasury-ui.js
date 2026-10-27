// n° 86 — Écran « Trésorerie » (Plus › Gestion) : prévisionnel sur 12 mois, courbe, tableau mensuel,
// point bas et petit échéancier saisi. Module chargé à la demande (lazy-modules.js). Seules écritures :
// solde de départ et échéancier, dans les préférences locales (preferences.treasury). Masqué au rôle viewer.
import {escapeHtml as e} from './utils.js';
import {validateForm} from './form-chips-ui.js';
import {canSeeTreasury} from './permissions.js';
import {treasuryForecast,treasuryChart,treasurySettings,validateItem,validateOpening,monthKey,dayKey,monthLabel,addMonths,PERIODICITIES,DISCLAIMER} from './treasury.js';

const n0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0});
const eur=v=>v===null||v===undefined||!Number.isFinite(v)?'—':`${v<0?'−':''}${n0.format(Math.abs(v))} €`;
const SOURCES={contrat:'Contrat',vente:'Vente',facture:'Facture',pac:'Aides PAC',travail:'Travail prévu',entretien:'Entretien',echeancier:'Échéancier',
  fermage:'Foncier (fermage)',structure:'Marge nette (structure)',appro:'Stock (achat d’appro)',gnr:'Carburant (GNR)',sinistre:'Sinistre'};
const SHIFTS=[-3,-2,-1,1,2,3,4,6];

/** Texte du point bas, avec le prochain encaissement attendu (n° 86). */
export function lowPointText(low){
  if(!low)return'';
  const next=low.nextIncome?` Prochain encaissement attendu : ${SOURCES[low.nextIncome.source]||low.nextIncome.source} « ${low.nextIncome.line} », ${eur(low.nextIncome.amount)} en ${low.nextIncome.label}.`:' Aucun encaissement attendu ensuite sur l’horizon.';
  return`Point bas : ${eur(low.balance)} fin ${low.label}${low.negative?' : trésorerie négative, anticipez (report d’échéance, ouverture de crédit, vente).':'.'}${next}`;
}
/** Résultat du scénario « décaler un encaissement » : comparaison des points bas, sans écriture. */
export function scenarioText(base,simulated,line,shift){
  const to=addMonths(line.month,shift),out=simulated.months.length&&to>simulated.months.at(-1).key;
  const where=out?'au-delà des 12 mois':`en ${monthLabel(to<simulated.start?simulated.start:to)}`;
  const delta=simulated.low&&base.low?simulated.low.balance-base.low.balance:0;
  return`Si « ${line.label} » (${eur(line.amount)}) arrive ${where} au lieu de ${monthLabel(line.month)} : point bas ${eur(simulated.low?.balance??0)} fin ${simulated.low?.label||'—'}${delta?` (${delta<0?'−':'+'}${n0.format(Math.abs(delta))} € par rapport au prévisionnel)`:' (inchangé)'}. Simulation : rien n’est enregistré.`;
}

export function createTreasuryUI({store,modal,toast,bindChipChoices=()=>{},role=()=>'owner'}){
  const data=()=>store.snapshot?store.snapshot():store.state;

  function missingHtml(f){
    const m=f.missing,notes=[];
    if(f.openingMissing)notes.push('solde de départ non saisi (0 € par défaut)');
    if(m.works)notes.push(`${m.works} travail(aux) prévu(s) sans coût ni estimation`);
    if(m.contracts)notes.push(`${m.contracts} contrat(s) sans prix`);
    if(m.pac)notes.push('aides PAC non saisies (Marges par culture) : ajoutez-les à l’échéancier si besoin');
    if(m.rents)notes.push(`${m.rents} bail(aux) sans fermage calculable (Foncier)`);
    if(m.appro)notes.push(`${m.appro} entrée(s) de stock à venir sans prix`);
    if(m.fuel)notes.push(`${m.fuel} plein(s) de GNR sans montant`);
    const dup=(f.duplicates||[]).length?`<p class="notice info" role="note">Non repris pour éviter un double compte : ${f.duplicates.map(d=>`${e(d.label)} (${d.note?e(d.note):`déjà « ${e(d.item)} » dans l’échéancier`})`).join(' · ')}.</p>`:'';
    return (notes.length?`<p class="notice warning" role="note">Sources manquantes : ${notes.map(e).join(' · ')}.</p>`:'')+dup;
  }

  function tableHtml(f){
    const row=m=>`<tr class="${m.key===f.low?.key?'tr-low-row':''}"><th scope="row">${e(m.label)}</th><td>${e(eur(m.income))}</td><td>${e(eur(-m.expense))}</td><td class="${m.balance<0?'negative':''}"><strong>${e(eur(m.balance))}</strong></td></tr>${m.lines.length?`<tr class="tr-detail"><td colspan="4"><details><summary>${m.lines.length} flux</summary><ul>${m.lines.map(l=>`<li>${e(SOURCES[l.source]||l.source)} · ${e(l.label)} : <strong>${e(eur(l.amount))}</strong>${l.late?' <small>(en retard)</small>':''}</li>`).join('')}</ul></details></td></tr>`:''}`;
    return`<div class="econ-table-wrap"><table class="econ-table treasury-table"><thead><tr><th>Mois</th><th>Encaissements</th><th>Décaissements</th><th>Solde fin de mois</th></tr></thead><tbody>${f.months.map(row).join('')}</tbody></table></div>`;
  }

  function scheduleHtml(f,settings){
    const per=Object.fromEntries(PERIODICITIES.map(([id,label])=>[id,label]));
    const list=settings.items.length?`<ul class="stack-list tr-items">${settings.items.map(i=>`<li class="tr-item"><span><strong>${e(i.label)}</strong> · ${e(i.sign==='+'?'+':'−')}${e(eur(i.amount))} · ${e(per[i.periodicity])} dès ${e(monthLabel(i.startMonth))}</span><button type="button" class="button secondary" data-tr="remove" data-id="${e(i.id)}" aria-label="Supprimer ${e(i.label)}">Supprimer</button></li>`).join('')}</ul>`:'<p class="form-note">Aucune échéance saisie : annuités de prêt, fermages, MSA, lait, aides…</p>';
    const chips=(name,options,on)=>`<input type="hidden" name="${name}" value="${e(on)}"><div class="chip-choices" data-chip-target="${name}">${options.map(([v,l])=>`<button type="button" class="choice-chip${v===on?' is-on':''}" data-value="${e(v)}" aria-pressed="${v===on}">${e(l)}</button>`).join('')}</div>`;
    return`<details class="tr-schedule"${settings.items.length||f.openingMissing?' open':''}><summary>Solde de départ et échéancier</summary>
<form id="tr-opening-form" class="form-grid"><label class="span-2">Solde bancaire au début de ${e(monthLabel(f.start))} (€)<input name="openingBalance" type="number" step="any" inputmode="decimal" value="${e(settings.openingBalance??'')}" placeholder="ex. 12000"></label><p class="form-error span-2" id="tr-opening-error" role="alert" hidden></p><div class="mc-actions span-2"><button type="button" class="button secondary" data-tr="opening">Enregistrer le solde</button></div></form>
<h4>Échéancier</h4>${list}
<form id="tr-item-form" class="form-grid"><label class="span-2">Libellé *<input name="label" maxlength="80" required placeholder="ex. Annuité prêt tracteur"></label><label>Montant (€) *<input name="amount" type="number" min="0" step="any" inputmode="decimal" required></label><label>Mois de départ *<input name="startMonth" type="month" required value="${e(f.start)}"></label>
<div class="field-label span-2"><span>Sens</span>${chips('sign',[['-','Décaissement'],['+','Encaissement']],'-')}</div>
<div class="field-label span-2"><span>Périodicité</span>${chips('periodicity',PERIODICITIES.map(([id,l])=>[id,l]),'mensuelle')}</div>
<p class="form-error span-2" id="tr-item-error" role="alert" hidden></p><div class="mc-actions span-2"><button type="button" class="button primary" data-tr="add">Ajouter l’échéance</button></div></form></details>`;
  }

  // Scénario « décaler une vente ou un encaissement » : simulation seule, aucune écriture.
  function scenarioHtml(f){
    const incomes=f.lines.filter(l=>l.amount>0&&l.source!=='pac');
    if(!incomes.length)return'';
    return`<details class="tr-scenario"><summary>Scénario : décaler une vente ou un encaissement</summary><form id="tr-scenario-form" class="form-grid">
<label class="span-2">Encaissement<select name="line"><option value="">Choisir…</option>${incomes.map(l=>`<option value="${e(l.id)}">${e(monthLabel(l.month))} · ${e(SOURCES[l.source]||l.source)} · ${e(l.label)} · ${e(eur(l.amount))}</option>`).join('')}</select></label>
<label class="span-2">Décalage<select name="shift">${SHIFTS.map(n=>`<option value="${n}" ${n===2?'selected':''}>${n>0?`${n} mois plus tard`:`${-n} mois plus tôt`}</option>`).join('')}</select></label>
<p class="form-error span-2" id="tr-scenario-error" role="alert" hidden></p><div class="mc-actions span-2"><button type="button" class="button secondary" data-tr="simulate">Simuler</button></div>
<p class="form-note span-2" id="tr-scenario-result" role="status" aria-live="polite"></p></form></details>`;
  }

  function open(){
    if(!canSeeTreasury(role())){toast('La trésorerie n’est pas accessible en lecture seule.','info');return;}
    const state=data(),settings=treasurySettings(state),f=treasuryForecast(state,{start:monthKey(),today:dayKey()}),low=f.low;
    modal('Trésorerie','Prévisionnel sur 12 mois · estimation, non contractuelle',`
<div class="preview-summary">${[['Solde de départ',eur(f.opening??0)],['Encaissements prévus',eur(f.totals.income)],['Décaissements prévus',eur(-f.totals.expense)],['Point bas',low?`${eur(low.balance)} (${low.label})`:'—']].map(([l,v])=>`<div class="preview-stat"><strong>${e(v)}</strong><small>${e(l)}</small></div>`).join('')}</div>
${low?`<p class="notice ${low.negative?'danger':'info'}" role="${low.negative?'alert':'note'}">${e(lowPointText(low))}</p>`:''}
${missingHtml(f)}
<div class="cm-chart treasury-chart-wrap">${treasuryChart(f)}<p class="form-note"><span class="tr-key tr-key-in"></span> encaissements · <span class="tr-key tr-key-out"></span> décaissements · ligne : solde fin de mois</p></div>
${tableHtml(f)}
${scenarioHtml(f)}
${scheduleHtml(f,settings)}
<p class="form-note">${e(DISCLAIMER)}</p>`,
    `<button type="button" class="button secondary" data-action="open-statistics">Pilotage</button><button type="button" class="button primary" data-action="close-modal">Fermer</button>`,'large');
    const form=document.querySelector('#tr-item-form');if(form)bindChipChoices(form);
  }

  const save=patch=>{const t=data().preferences?.treasury||{};return store.setPreferences({treasury:{...t,...patch,updatedAt:Date.now()}});};
  const fail=(id,msg)=>{const err=document.querySelector(id);if(err){err.textContent=msg;err.hidden=false;}};

  async function action(kind,c){
    if(kind==='simulate'){
      const form=document.querySelector('#tr-scenario-form'),values=form?Object.fromEntries(new FormData(form)):{};
      const opts={start:monthKey(),today:dayKey()},base=treasuryForecast(data(),opts),line=base.lines.find(l=>l.id===values.line);
      if(!line)return fail('#tr-scenario-error','Choisissez l’encaissement à décaler.');
      const err=document.querySelector('#tr-scenario-error');if(err)err.hidden=true;
      const shift=Number(values.shift)||0,simulated=treasuryForecast(data(),{...opts,shifts:{[line.id]:shift}});
      const out=document.querySelector('#tr-scenario-result');if(out)out.textContent=scenarioText(base,simulated,line,shift);
      return;
    }
    if(kind==='opening'){
      const res=validateOpening(document.querySelector('#tr-opening-form [name="openingBalance"]')?.value);if(res.error)return fail('#tr-opening-error',res.error);
      await save({openingBalance:res.value});toast('Solde de départ enregistré.','success');return open();
    }
    if(kind==='add'){
      const form=document.querySelector('#tr-item-form');if(!form||!validateForm(form))return;
      const res=validateItem(Object.fromEntries(new FormData(form)));if(res.error)return fail('#tr-item-error',res.error);
      const items=treasurySettings(data()).items;if(items.length>=50)return fail('#tr-item-error','Échéancier plein (50 lignes au plus).');
      await save({items:[...items,{id:`ech_${Date.now().toString(36)}`,...res.value}]});toast('Échéance ajoutée.','success');return open();
    }
    if(kind==='remove'){
      const items=treasurySettings(data()).items,removed=items.find(i=>i.id===c.dataset.id);if(!removed)return;
      await save({items:items.filter(i=>i.id!==removed.id)});open();
      toast('Échéance supprimée.','info',{label:'Annuler',run:async()=>{await save({items:[...treasurySettings(data()).items,removed]});open();}});
    }
  }
  document.addEventListener('click',ev=>{const c=ev.target.closest('[data-tr]');if(!c||c.disabled)return;c.disabled=true;action(c.dataset.tr,c).catch(err=>toast(err.message,'error')).finally(()=>{c.disabled=false;});});
  return{open};
}

// n° 65 — Écran « Marges par culture » : €/ha, cascade SVG, aides PAC, prix d'équilibre, N-1 et N-2.
// Lecture seule hormis les aides €/ha (préférences de l'exploitation).
import {escapeHtml as e,formatNumber} from './utils.js';
import {validateForm} from './form-chips-ui.js';
import {waterfallChart} from './charts.js';
import {cropMargins,waterfallSteps,partialLabel,validateAids,AIDS_RULE} from './crop-margins.js';

const n0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}),n1=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1});
const eur=v=>v===null||v===undefined||!Number.isFinite(v)?'—':`${v<0?'−':''}${n0.format(Math.abs(v))} €`;
const ha=v=>v===null||v===undefined||!Number.isFinite(v)?'—':`${eur(v)}/ha`;

export function createCropMarginsUI({store,modal,toast}){
  const $=s=>document.querySelector(s);
  const state=()=>store.snapshot?store.snapshot():store.state;
  let selected='';

  function cell(label,value,cls=''){return`<div class="cm-cell ${cls}"><small>${e(label)}</small><strong>${e(value)}</strong></div>`;}

  function cultureCard(r){
    const eqUnit=r.yieldUnit==='q/ha'?'€/q':'€/t';
    const prev=r.previous.map(p=>`<span>${e(p.campaign)} : ${e(ha(p.directHa))}</span>`).join('');
    return`<article class="cm-card${r.key===selected?' is-open':''}" data-cm-culture="${e(r.key)}">
<header><div><h3>${e(r.culture)}</h3><small>${formatNumber(r.area)} ha · fiable à ${r.reliability} %${r.partial?` · <span class="cm-partial">${e(partialLabel(r.missing)||`${r.withoutProduct} parcelle(s) sans rendement ni prix`)}</span>`:''}</small></div><strong class="${r.directHa!==null&&r.directHa<0?'negative':''}">${e(ha(r.directHa))}</strong></header>
<div class="cm-grid">${cell('Produit',ha(r.productHa))}${cell('Charges opérationnelles',ha(r.operationalHa))}${cell('Marge brute',ha(r.grossHa),'is-key')}${cell('Mécanisation',ha(r.mechanizationHa))}${cell('Marge directe',ha(r.directHa),'is-key')}${cell('Avec aides PAC',ha(r.withAidsHa))}</div>
<p class="cm-history">Marge directe ${prev}</p>
<p class="form-note">Prix d’équilibre : ${r.breakEven===null?'— (rendement inconnu)':`${e(n0.format(r.breakEven))} ${eqUnit}`}${r.currentPrice!==null?` · prix retenu ${e(n0.format(r.currentPrice))} ${eqUnit}`:''} · rendement d’équilibre : ${r.breakEvenYield===null?'— (prix inconnu)':`${e(n1.format(r.breakEvenYield))} ${e(r.yieldUnit)}`}</p>
<div class="cm-chart">${waterfallChart(waterfallSteps(r),{caption:`Cascade de marge ${r.culture}`})||'<p class="form-note">Cascade indisponible : produit inconnu (rendement ou prix absent).</p>'}</div></article>`;
  }

  function open({campaign}={}){
    const m=cropMargins(state(),{campaign}),t=m.total,a=m.aids;
    if(!selected||!m.rows.some(r=>r.key===selected))selected=m.rows[0]?.key||'';
    const herd=m.herd;
    modal('Marges par culture',`Campagne ${m.campaign} · montants en €/ha`,`
<div class="cm-total"><div class="preview-summary">${[['Marge brute',ha(t.grossHa)],['Marge directe',ha(t.directHa)],['Avec aides PAC',ha(t.withAidsHa)]].map(([l,v])=>`<div class="preview-stat"><strong>${e(v)}</strong><small>${e(l)}</small></div>`).join('')}</div>
${m.missing?`<p class="notice warning cm-partial-note" role="status">${e(partialLabel(m.missing).replace(/^m/,'M'))} : les charges connues sont seules comptées.</p>`:''}</div>
<div class="cm-tabs" role="group" aria-label="Culture">${m.rows.map(r=>`<button type="button" class="choice-chip ${r.key===selected?'is-on':''}" aria-pressed="${r.key===selected}" data-cm-pick="${e(r.key)}">${e(r.culture)}</button>`).join('')}</div>
<div class="cm-list">${m.rows.map(cultureCard).join('')||'<div class="empty-state">Aucune parcelle en propre sur cette campagne.</div>'}</div>
<h3>Marge simplifiée du troupeau</h3>${herd?`<p>${herd.sales?`${herd.sales} vente(s) d’animaux : ${e(eur(herd.product))}`:'Aucune vente d’animaux saisie'} · charges des surfaces fourragères (${formatNumber(herd.area)} ha) : ${e(eur(herd.charges))} → marge ${e(eur(herd.margin))}${herd.missing?` · ${e(partialLabel(herd.missing))}`:''}</p><p class="form-note">Ventes d’animaux moins charges des prairies et fourrages. Le détail (achats, aliments, vétérinaire) est dans « Atelier bovin ».</p>`:'<p class="form-note">Ni prairie ni vente d’animaux sur cette campagne.</p>'}
<details class="cm-aids"${a.total===null?' open':''}><summary>Aides PAC (€/ha, saisies une fois)</summary><form id="cm-aids-form" class="form-grid">
<label>Aides découplées (DPB + redistributive)<input name="decoupled" type="number" min="0" max="2000" step="any" inputmode="decimal" value="${e(a.decoupled??'')}"></label>
<label>Éco-régime<input name="ecoScheme" type="number" min="0" max="2000" step="any" inputmode="decimal" value="${e(a.ecoScheme??'')}"></label>
<p class="form-error span-2" id="cm-aids-error" role="alert" hidden></p></form><p class="form-note">${e(AIDS_RULE)}${a.updatedAt?` Saisies le ${e(new Date(a.updatedAt).toLocaleDateString('fr-FR'))}.`:''}</p>
<button type="button" class="button secondary" id="cm-aids-save">Enregistrer les aides</button></details>
<details class="margin-rules"><summary>Comment ces marges sont calculées</summary><ul><li>Produit, charges et fiabilité viennent du même moteur que le Pilotage (marginModel).</li><li>Mécanisation = coût machine + carburant des travaux chiffrés ; charges opérationnelles = le reste (intrants, main-d’œuvre, forfait).</li><li>Marge directe = marge brute − mécanisation. Prix d’équilibre : charges et structure rapportées au volume (coût de revient).</li><li>Un travail sans coût n’est jamais compté 0 € : la marge est alors partielle.</li></ul></details>`,
`<button type="button" class="button secondary" data-action="pilotage-campaign" data-campaign="${e(m.campaign)}">Pilotage</button><button type="button" class="button primary" data-action="close-modal">Fermer</button>`,'large');
    document.querySelectorAll('[data-cm-pick]').forEach(b=>b.onclick=()=>{selected=b.dataset.cmPick;open({campaign:m.campaign});});
    $('#cm-aids-save').onclick=async()=>{
      const form=$('#cm-aids-form'),err=$('#cm-aids-error');if(!validateForm(form))return;
      const r=validateAids(Object.fromEntries(new FormData(form)));
      if(r.error){err.textContent=r.error;err.hidden=false;return;}
      await store.setPreferences({pacAidsHa:{...r.value,updatedAt:Date.now()}});
      toast('Aides PAC enregistrées.','success');open({campaign:m.campaign});
    };
  }
  return{open};
}

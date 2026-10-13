// n° 91 — Écran « Marge nette » : trois étages (brute, directe, nette), cascade SVG et fiche
// « Structure de l'exploitation » par campagne. Seule écriture : la fiche (préférences).
import {escapeHtml as e,campaignFor} from './utils.js';
import {validateForm} from './form-chips-ui.js';
import {waterfallChart} from './charts.js';
import {netMargin,netWaterfall,validateSheet,copySheet,STRUCTURE_CHARGES,STRUCTURE_AIDS,AIDS_DISCLAIMER,NET_RULES} from './net-margin.js';

const n0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0});
const eur=v=>v===null||v===undefined||!Number.isFinite(v)?'—':`${v<0?'−':''}${n0.format(Math.abs(v))} €`;
const ha=v=>v===null||v===undefined||!Number.isFinite(v)?'—':`${eur(v)}/ha`;
const shift=(c,n)=>{const y=Number(String(c).slice(0,4))+n;return`${y}/${String(y+1).slice(-2)}`;};

export function createNetMarginUI({store,modal,toast}){
  const data=()=>store.snapshot?store.snapshot():store.state;
  let current=campaignFor(),draft=null;

  const stats=t=>`<div class="preview-summary">${[['Marge brute',ha(t.grossHa)],['Marge directe (après matériel)',ha(t.directHa)],['Marge nette',ha(t.netHa)]].map(([l,v])=>`<div class="preview-stat"><strong>${e(v)}</strong><small>${e(l)}</small></div>`).join('')}</div>`;

  /** Encart du Pilotage. */
  function pilotageSection(campaign){
    const m=netMargin(data(),{campaign});if(!m.rows.length)return'';
    return`<h3>Marge nette</h3>${stats(m.total)}<p class="form-note">${m.total.net!==null?`Marge nette ${eur(m.total.net)} sur ${n0.format(m.area)} ha`:'Marge nette non calculable : produit inconnu.'}${m.sheet.exists?'':' · fiche de structure à remplir'}${m.aidsAreEstimates?' · aides estimées':''}.</p><button type="button" class="button secondary" data-action="open-net-margin" data-campaign="${e(campaign)}">Détail et charges de structure</button>`;
  }

  function sheetForm(m,items){
    const field=([key,label])=>`<label>${e(label)}<span class="nm-field"><input name="amount_${key}" type="number" min="0" step="any" inputmode="decimal" value="${e(items[key].amount??'')}" placeholder="€ / an"><select name="target_${key}" aria-label="Affectation ${e(label)}"><option value="">Prorata des ha</option>${m.rows.map(r=>`<option value="${e(r.culture)}"${items[key].target&&items[key].target===r.culture?' selected':''}>${e(r.culture)}</option>`).join('')}</select></span></label>`;
    return`<form id="nm-form" class="form-grid"><h4 class="span-2">Charges de structure</h4>${STRUCTURE_CHARGES.map(field).join('')}<h4 class="span-2">Aides PAC et autres aides</h4>${STRUCTURE_AIDS.map(field).join('')}<p class="form-error span-2" id="nm-error" role="alert" hidden></p></form>`;
  }

  function open({campaign}={}){
    if(campaign&&campaign!==current){current=campaign;draft=null;}
    const m=netMargin(data(),{campaign:current}),t=m.total,items=draft||m.sheet.items;
    const prev=copySheet(data(),shift(current,-1));
    modal('Marge nette',`Campagne ${m.campaign} · de la marge brute à la marge nette`,`
<div class="cm-tabs" role="group" aria-label="Campagne"><button type="button" class="choice-chip" data-nm="campaign" data-campaign="${e(shift(current,-1))}">← ${e(shift(current,-1))}</button><button type="button" class="choice-chip is-on" aria-pressed="true">${e(current)}</button><button type="button" class="choice-chip" data-nm="campaign" data-campaign="${e(shift(current,1))}">${e(shift(current,1))} →</button></div>
${stats(t)}
<p class="form-note">Fermages ${eur(m.rentTotal)}${m.rentMissing?` (${m.rentMissing} parcelle(s) sans loyer calculable)`:''} · charges de structure ${eur(m.chargesTotal)}${m.chargesSource==='forfait'?' (forfait €/ha du prix d’équilibre)':m.chargesSource===null?' (non renseignées)':''} · aides ${eur(m.aidsTotal)}${m.aidsSource==='marges'?' (aides €/ha de « Marges par culture »)':m.aidsSource===null?' (non renseignées)':''}.</p>
${m.aidsAreEstimates?`<p class="notice warning" role="note">${e(AIDS_DISCLAIMER)}</p>`:''}
${m.missing?`<p class="notice warning">${m.missing} travail(aux) sans coût : la marge est partielle.</p>`:''}
<div class="cm-chart">${waterfallChart(netWaterfall(t),{caption:'Cascade jusqu’à la marge nette'})||'<p class="form-note">Cascade indisponible : produit inconnu (rendement ou prix absent).</p>'}</div>
<h3>Par culture</h3><div class="econ-table-wrap"><table class="econ-table"><thead><tr><th>Culture</th><th>ha</th><th>Marge brute</th><th>Marge directe</th><th>Fermages</th><th>Structure</th><th>Aides</th><th>Marge nette</th></tr></thead><tbody>${m.rows.map(r=>`<tr><th scope="row">${e(r.culture)}${r.partial?' <small class="cm-partial">partielle</small>':''}</th><td>${n0.format(r.area)}</td><td>${ha(r.grossHa)}</td><td>${ha(r.directHa)}</td><td>${ha(-r.rentHa)}</td><td>${ha(-r.structureHa)}</td><td>${ha(r.aidsHa)}</td><td class="${r.netHa!==null&&r.netHa<0?'negative':''}"><strong>${ha(r.netHa)}</strong></td></tr>`).join('')||'<tr><td colspan="8">Aucune parcelle en propre sur cette campagne.</td></tr>'}</tbody></table></div>
<details class="nm-sheet"${m.sheet.exists?'':' open'}><summary>Structure de l’exploitation ${e(current)} (montants annuels)</summary>${sheetForm(m,items)}
<div class="mc-actions">${prev&&!m.sheet.exists?`<button type="button" class="button secondary" data-nm="copy">Reprendre ${e(shift(current,-1))}</button>`:''}<button type="button" class="button primary" data-nm="save">Enregistrer la fiche</button></div><p class="form-note">${e(AIDS_DISCLAIMER)}${m.sheet.updatedAt?` Fiche mise à jour le ${e(new Date(m.sheet.updatedAt).toLocaleDateString('fr-FR'))}.`:''}</p></details>
<details class="margin-rules"><summary>Comment la marge nette est calculée</summary><ul>${NET_RULES.map(r=>`<li>${e(r)}</li>`).join('')}</ul></details>`,
    `<button type="button" class="button secondary" data-action="open-crop-margins" data-campaign="${e(current)}">Marges par culture</button><button type="button" class="button secondary" data-action="open-land">Foncier</button><button type="button" class="button primary" data-action="close-modal">Fermer</button>`,'large');
  }

  async function action(kind,c){
    if(kind==='campaign')return open({campaign:c.dataset.campaign});
    if(kind==='copy'){const p=copySheet(data(),shift(current,-1));if(p){draft=p.items;open();toast('Montants repris : vérifiez-les puis enregistrez.','info');}return;}
    if(kind==='save'){
      const form=document.querySelector('#nm-form'),err=document.querySelector('#nm-error');if(!form||!validateForm(form))return;
      const res=validateSheet(Object.fromEntries(new FormData(form)));if(res.error){err.textContent=res.error;err.hidden=false;return;}
      const all={...(data().preferences?.structureByCampaign||{}),[current]:{...res.value,updatedAt:Date.now()}};
      await store.setPreferences({structureByCampaign:all});draft=null;toast('Fiche de structure enregistrée.','success');return open();
    }
  }
  document.addEventListener('click',ev=>{const c=ev.target.closest('[data-nm]');if(!c||c.disabled)return;c.disabled=true;action(c.dataset.nm,c).catch(err=>toast(err.message,'error')).finally(()=>{c.disabled=false;});});
  return{open,pilotageSection};
}

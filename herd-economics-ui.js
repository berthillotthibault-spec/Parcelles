// n° 80 — Interface de l'atelier bovin : carte du Pilotage, écran détaillé, ventes et achats d'animaux.
import {escapeHtml as e,localDate,campaignFor} from './utils.js';
import {validateForm} from './form-chips-ui.js';
import {saveFarmRecord,farmRecords} from './farm-records.js';
import {herdEconomics,validateAnimalRecord,SALE_KIND,PURCHASE_KIND} from './herd-economics.js';

const n0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}),n2=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2});
const eur=v=>v===null||v===undefined||!Number.isFinite(v)?'—':`${v<0?'−':''}${n0.format(Math.abs(v))} €`;
const eur2=v=>v===null||v===undefined?'—':`${n2.format(v)} €`;
const todayIso=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};

export function createHerdEconomicsUI({store,modal,toast}){
  const $=s=>document.querySelector(s);
  const data=()=>store.snapshot();
  const model=campaign=>herdEconomics(data(),{campaign,today:todayIso()});

  function pilotageCardHtml(campaign=campaignFor()){
    const h=model(campaign);if(h.empty)return'';
    return`<section class="herd-econ-card"><h3>Atelier bovin</h3><div class="preview-summary"><div class="preview-stat"><strong class="${h.margin<0?'negative':''}">${e(eur(h.margin))}</strong><small>marge brute${h.partial?' (partielle)':''}</small></div><div class="preview-stat"><strong>${e(h.marginPerUgb===null?'—':eur(h.marginPerUgb))}</strong><small>par UGB</small></div><div class="preview-stat"><strong>${e(eur2(h.grassPerAnimalDay))}</strong><small>herbe / animal / jour</small></div></div><button type="button" class="button secondary" data-action="open-herd-economics" data-campaign="${e(campaign)}">Détail de l’atelier</button></section>`;
  }

  function open({campaign=campaignFor()}={}){
    const h=model(campaign);
    const line=(label,value,note='')=>`<div class="list-row"><div><strong>${e(label)}</strong>${note?`<small>${e(note)}</small>`:''}</div><strong>${e(value)}</strong></div>`;
    const recs=[...h.sales.map(r=>({...r,kind:'Vente'})),...h.purchases.map(r=>({...r,kind:'Achat'}))].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    modal('Atelier bovin',`Campagne ${campaign} · du ${localDate(h.bounds.from)} au ${localDate(h.bounds.to)}`,`
<div class="preview-summary"><div class="preview-stat"><strong class="${h.margin<0?'negative':''}">${e(eur(h.margin))}</strong><small>marge brute</small></div><div class="preview-stat"><strong>${e(h.marginPerUgb===null?'—':eur(h.marginPerUgb))}</strong><small>marge par UGB${h.avgUgb?` (${n2.format(h.avgUgb)} UGB moyens)`:''}</small></div><div class="preview-stat"><strong>${e(eur2(h.grassPerAnimalDay))}</strong><small>coût de l’herbe par animal et par jour</small></div></div>
${h.partial?`<p class="notice warning">Marge partielle : ${[h.grassMissing?`${h.grassMissing} travaux de prairie sans coût`:'',h.feed.unpriced?`${h.feed.unpriced} sortie(s) d’aliment sans prix`:'',h.vetUnpriced?`${h.vetUnpriced} soin(s) sans coût`:''].filter(Boolean).join(', ')}.</p>`:''}
<div class="stack-list">${line('Ventes d’animaux',eur(h.product),`${h.soldHeads} animal(aux)${h.soldKg?` · ${n0.format(h.soldKg)} kg · ${n2.format(h.pricePerKg)} €/kg`:''}`)}${line('Achats d’animaux',eur(-h.bought),`${h.purchases.length} achat(s)`)}${line('Aliments',eur(-h.feed.total),`${h.feed.rows.length} sortie(s) de stock « Aliment » au PMP du jour`)}${line('Frais vétérinaires',eur(-h.vetCost),`${h.vetCount} enregistrement(s) du carnet sanitaire`)}${line('Coût des prairies',eur(-h.grassCost),`${n2.format(h.forageArea)} ha · ${n0.format(h.ugbDays)} jours UGB · ${eur2(h.grassPerUgbDay)} par jour UGB`)}</div>
<h3>Ventes et achats</h3><div class="stack-list">${recs.map(r=>`<div class="list-row"><div><strong>${e(r.kind)} · ${e(r.count)} animal(aux)${r.category?` · ${e(r.category)}`:''}</strong><small>${e(localDate(r.date))}${r.party?` · ${e(r.party)}`:''}${r.kg?` · ${e(n0.format(r.kg))} kg`:''}</small></div><strong>${e(eur(r.amount))}</strong></div>`).join('')||'<div class="empty-state">Aucune vente ni achat sur la campagne.</div>'}</div>
<p class="form-note">Marge brute = ventes − achats − aliments − vétérinaire − charges des prairies (moteur de marge). UGB : coefficients du pâturage. Pas de lien avec la BDNI : les mouvements officiels restent à déclarer à l’EDE.</p>`,
      `<button type="button" class="button secondary" data-action="pilotage-campaign" data-campaign="${e(campaign)}">Pilotage</button><button type="button" class="button secondary" id="herd-econ-purchase">Achat</button><button type="button" class="button primary" id="herd-econ-sale">Vente d’animaux</button>`,'large');
    $('#herd-econ-sale').onclick=()=>form(SALE_KIND,campaign);
    $('#herd-econ-purchase').onclick=()=>form(PURCHASE_KIND,campaign);
  }

  function form(kind,campaign){
    const sale=kind===SALE_KIND;
    modal(sale?'Vente d’animaux':'Achat d’animaux','Montant total HT.',`<form id="herd-econ-form" class="form-grid"><label>Date *<input name="date" type="date" required value="${e(todayIso())}"></label><label>Nombre *<input name="count" type="number" min="1" step="1" required inputmode="numeric"></label><label>Poids total (kg)<input name="kg" type="number" min="0" step="any" inputmode="decimal"></label><label>Montant (€ HT) *<input name="amount" type="number" min="0" step="any" required inputmode="decimal"></label><label>Catégorie<input name="category" list="herd-econ-cats" placeholder="Broutards, réformes…"></label><label>${sale?'Acheteur':'Vendeur'}<input name="party"></label><datalist id="herd-econ-cats">${['Broutards','Vaches de réforme','Génisses','Veaux','Taurillons','Bœufs'].map(c=>`<option value="${c}">`).join('')}</datalist><p class="form-error span-2" id="herd-econ-error" role="alert" hidden></p></form>`,
      `<button type="button" class="button secondary" data-action="open-herd-economics" data-campaign="${e(campaign)}">Annuler</button><button type="button" class="button primary" id="herd-econ-save">Enregistrer</button>`,'small');
    $('#herd-econ-save').onclick=async()=>{
      const f=$('#herd-econ-form');if(!validateForm(f))return;const r=validateAnimalRecord(Object.fromEntries(new FormData(f)));
      if(r.error){const err=$('#herd-econ-error');err.textContent=r.error;err.hidden=false;return;}
      await saveFarmRecord(store,kind,{...r.value,name:`${sale?'Vente':'Achat'} ${r.value.count} animal(aux) ${r.value.date}`});
      toast(sale?'Vente enregistrée.':'Achat enregistré.','success');open({campaign:campaignFor(r.value.date)});
    };
  }
  return{open,pilotageCardHtml,records:()=>farmRecords(data(),SALE_KIND)};
}

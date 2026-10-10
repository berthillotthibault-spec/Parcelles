// n° 89 — interface du simulateur « Et si… » : curseurs en direct, matrice 5 × 5, assolement.
// Simulation pure : aucune écriture.
import {escapeHtml as e} from './utils.js';
import {simulationBase,simulate,sensitivityMatrix,describeScenario,compareRotationChoices,LIMITS} from './simulator.js';

const n0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}),n2=new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});
const eur=v=>v===null||v===undefined||!Number.isFinite(v)?'—':`${v<0?'−':''}${n0.format(Math.abs(v))} €`;
const signed=v=>`${v>0?'+':v<0?'−':''}${Math.abs(v)}`;

export function createSimulatorUI({modal,state}){
  const $=s=>document.querySelector(s);
  function open({campaign,culture=''}={}){
    const data=state(),cultures=[...new Set((data.parcelles||[]).filter(p=>!p.deletedAt&&!p.archived).map(p=>p.culture||'Non renseignée'))].sort((a,b)=>a.localeCompare(b,'fr'));
    let base=simulationBase(data,{campaign,culture});const hyp={yieldPct:0,pricePct:0,fertPct:0,gnrPrice:base.gnrPrice};
    const slider=(name,label,[lo,hi],step,unit,value)=>`<label class="sim-slider"><span>${e(label)} <output data-out="${name}">${e(unit==='€/L'?`${n2.format(value)} €/L`:`${signed(value)} %`)}</output></span><input type="range" name="${name}" min="${lo}" max="${hi}" step="${step}" value="${value}" aria-label="${e(label)}"></label>`;
    const rotation=compareRotationChoices(data,{campaign:base.campaign});
    const choice=(label,x)=>`<div class="preview-stat"><strong>${e(eur(x.margin))}</strong><small>${e(label)}${x.unknownArea?` · ${n0.format(x.unknownArea)} ha sans historique`:''}</small><small>${e(x.cultures.slice(0,4).map(c=>`${c.culture} ${n0.format(c.area)} ha`).join(', '))}</small></div>`;
    modal('Et si…',`Simulation sur la campagne ${base.campaign}, aucune donnée n’est modifiée.`,`<div id="sim-result" aria-live="polite"></div><form id="sim-form" class="sim-form"><label>Périmètre<select name="culture"><option value="">Toute l’exploitation</option>${cultures.map(c=>`<option ${c===culture?'selected':''}>${e(c)}</option>`).join('')}</select></label>
${slider('yieldPct','Rendement',LIMITS.yieldPct,5,'%',0)}${slider('pricePct','Prix de vente',LIMITS.pricePct,5,'%',0)}${slider('fertPct','Prix des engrais',LIMITS.fertPct,5,'%',0)}${slider('gnrPrice','Prix du GNR',LIMITS.gnrPrice,0.05,'€/L',Number(base.gnrPrice.toFixed(2)))}</form>
<h3>Sensibilité rendement × prix</h3><div id="sim-matrix"></div>
<h3>Assolement de la campagne ${e(rotation.next)}</h3><p class="form-note">Marge estimée avec les marges/ha historiques par culture (3 dernières campagnes fiables à 50 % au moins).</p><div class="preview-summary">${choice(rotation.hasPlan?'Assolement prévu':'Aucun assolement prévu',rotation.planned)}${choice('Cultures actuelles reconduites',rotation.kept)}</div>
<div class="stack-list">${rotation.history.map(h=>`<div class="list-row"><div><strong>${e(h.culture)}</strong><small>${e(h.campaigns.join(', '))}</small></div><strong>${e(eur(h.marginHa))}/ha</strong></div>`).join('')||'<div class="empty-state">Pas encore d’historique de marge fiable par culture.</div>'}</div>
<p class="form-note" id="sim-hypotheses"></p>`,`<button type="button" class="button primary" data-action="close-modal">Fermer</button>`,'large');
    const form=$('#sim-form');
    const update=()=>{
      const r=simulate(base,hyp);
      $('#sim-hypotheses').textContent=`${describeScenario(hyp)} Base : produit attendu ${eur(base.margin===null?null:base.product)}, charges ${eur(base.margin===null?null:base.charges)} dont engrais ${eur(base.fert)}, ${n0.format(base.litres)} L de GNR saisis à ${n2.format(base.gnrPrice)} €/L. Fiabilité ${base.reliability} %.${base.litres?'':' Consommation de GNR non saisie : le curseur GNR est sans effet.'}${base.fert?'':' Aucun travail de fertilisation chiffré : le curseur engrais est sans effet.'}`;
      $('#sim-result').innerHTML=base.margin===null?`<p class="notice warning">Rendement ou prix absents${base.culture?` pour ${e(base.culture)}`:''} : renseignez l’économie des parcelles pour simuler.</p>`
        :`<div class="sim-result ${r.delta<0?'is-down':r.delta>0?'is-up':''}"><span>Marge simulée</span><strong>${e(eur(r.margin))}</strong><small>${r.delta===0?'identique à la base':`${r.delta>0?'+':'−'}${e(eur(Math.abs(r.delta)))} par rapport à ${e(eur(base.margin))}`}${r.marginHa!==null?` · ${e(eur(r.marginHa))}/ha`:''}</small></div>`;
      const m=sensitivityMatrix(base,{fertPct:hyp.fertPct,gnrPrice:hyp.gnrPrice});
      $('#sim-matrix').innerHTML=m?`<div class="sim-matrix-wrap"><table class="sim-matrix"><caption class="sr-only">Marge selon le rendement (lignes) et le prix (colonnes)</caption><thead><tr><th scope="col">Rdt \\ Prix</th>${m.steps.map(p=>`<th scope="col">${signed(p)} %</th>`).join('')}</tr></thead><tbody>${m.rows.map((row,i)=>`<tr><th scope="row">${signed(m.steps[i])} %</th>${row.map(c=>`<td class="is-${c.level}${c.yieldPct===0&&c.pricePct===0?' is-base':''}">${e(eur(c.margin))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'';
    };
    form.addEventListener('input',event=>{
      const t=event.target;if(t.name==='culture')return;
      hyp[t.name]=Number(t.value);const out=form.querySelector(`[data-out="${t.name}"]`);if(out)out.textContent=t.name==='gnrPrice'?`${n2.format(hyp.gnrPrice)} €/L`:`${signed(hyp[t.name])} %`;update();
    });
    form.querySelector('[name="culture"]').onchange=event=>open({campaign:base.campaign,culture:event.target.value});
    update();
  }
  return{open};
}

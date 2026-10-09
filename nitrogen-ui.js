// n° 63 — Plus › Azote : PPF par parcelle, cahier d’enregistrement, alertes et PDF.
import {campaignFor,escapeHtml,formatNumber,isoDate,localDate,normalize} from './utils.js';
import {validateForm} from './form-chips-ui.js';
import {flowPdf,pdfFile,sharePdf} from './pdf-lite.js';
import {
  FERTILIZER_LIBRARY,FERTILIZER_TYPES,NITROGEN_DISCLAIMER,NITROGEN_REFERENCES,SEASON_LABELS,
  nitrogenOverview,nitrogenReferences,normalizeComposition,num,parcelPlan,planPdfBlocks,registerPdfBlocks,rotationFor
} from './nitrogen.js';

const e=escapeHtml;
const n0=v=>v===null||v===undefined?'—':formatNumber(v);
const shift=(campaign,delta)=>{const y=Number(String(campaign).slice(0,4))+delta;return`${y}/${String(y+1).slice(-2)}`;};

export function createNitrogenUI({store,modal,toast,bindChipChoices}){
  const $=selector=>document.querySelector(selector);
  const today=()=>isoDate(new Date());
  let campaign=campaignFor();

  function gaugeBar(p){
    const g=p.gauge,pct=g.ratio===null?0:Math.min(100,Math.round(g.ratio*100/1.5));
    return`<div class="nz-gauge is-${g.status}" role="img" aria-label="${e(g.label)}"><span style="width:${pct}%"></span><i style="left:${Math.round(100/1.5)}%" aria-hidden="true"></i></div><small class="nz-gauge-label">${e(g.label)}</small>`;
  }
  function planCard(p){
    const terms=p.ref?`${normalize(p.ref.label)===normalize(p.culture)?'':`${e(p.ref.label)} · `}objectif ${p.objective?`${formatNumber(p.objective.value)} ${e(p.ref.unit)} (${e(p.objective.method)}${p.objective.count?`, ${p.objective.count} campagne${p.objective.count>1?'s':''}`:''})`:'—'}`:p.culture?'Culture sans référence : à compléter dans les références':'Culture non renseignée';
    return`<li class="nz-card${p.complete?'':' is-incomplete'}" data-parcel="${e(p.parcel.id)}">
      <div class="nz-card-head"><strong>${e(p.parcel.nom)}</strong>${p.zone?'<span class="nz-tag">Zone vulnérable</span>':''}</div>
      <p class="nz-card-sub">${e(p.culture||'—')} · ${terms}</p>
      <dl class="nz-terms">
        <div><dt>Besoin</dt><dd>${n0(p.besoin)}</dd></div><div><dt>Reliquat</dt><dd>${n0(p.rsh)}</dd></div><div><dt>Sol</dt><dd>${n0(p.mh)}</dd></div>
        <div><dt>Précédent</dt><dd>${n0(p.precedent.effect)}</dd></div><div><dt>Couvert</dt><dd>${n0(p.cover.effect)}</dd></div><div class="is-dose"><dt>Dose X</dt><dd>${p.dose===null?'—':`${formatNumber(p.dose)} kg N/ha`}</dd></div>
      </dl>
      ${gaugeBar(p)}
      ${p.missing.length?`<p class="nz-missing">À compléter : ${e(p.missing.join(', '))}</p>`:''}
      <button class="small-button nz-edit" type="button" data-nz="plan" data-id="${e(p.parcel.id)}">${p.rsh===null?'Saisir le reliquat':'Modifier'}</button>
    </li>`;
  }
  function registerRow(r){
    return`<li class="nz-reg-row"><div><strong>${e(localDate(r.date))} · ${e(r.parcel?.nom||'Parcelle inconnue')}</strong><small>${e(r.product||'Produit non renseigné')}${r.fert?` · type ${e(r.fert.type)}`:''} · ${r.dose!==null?`${formatNumber(r.dose)} ${e(r.doseUnit)}`:'dose ?'}${r.quantity!==null?` · ${formatNumber(r.quantity)} au total`:''}${r.missing.length?` · manque : ${e(r.missing.join(', '))}`:''}</small></div><span class="nz-reg-n">${r.nEff===null?'—':`${formatNumber(r.nEff)}`}<small>kg N eff./ha</small></span></li>`;
  }

  function open(options={}){
    if(options.campaign)campaign=options.campaign;
    const o=nitrogenOverview(store.state,{today:today(),campaign});
    const chips=[shift(campaignFor(),-1),campaignFor(),shift(campaignFor(),1)].map(c=>`<button type="button" class="choice-chip${c===campaign?' is-on':''}" data-nz="campaign" data-value="${e(c)}" aria-pressed="${c===campaign}">${e(c)}</button>`).join('');
    const alerts=o.alerts.length?`<ul class="nz-alerts" role="list">${o.alerts.map(a=>`<li class="nz-alert">${a.workId?`<button type="button" class="nz-alert-button" data-action="edit-work" data-id="${e(a.workId)}">`:'<div>'}<strong>${e(a.label)}</strong><small>${e(a.note)}</small>${a.workId?'</button>':'</div>'}</li>`).join('')}</ul>`:`<p class="nz-ok">Aucun épandage prévu en période d’interdiction · ${formatNumber(o.organic.perHa)} kg N organique/ha SAU (plafond ${formatNumber(o.organic.cap)}).</p>`;
    modal('Azote : PPF et cahier',`Méthode du bilan simplifiée, campagne ${campaign}.`,
      `<div class="nitrogen">
        <div class="chip-choices nz-campaigns" role="group" aria-label="Campagne">${chips}</div>
        <p class="compliance-disclaimer"><strong>Indicatif.</strong> ${e(NITROGEN_DISCLAIMER)}</p>
        <h3>Alertes</h3>${alerts}
        <h3>Plan prévisionnel par parcelle</h3>
        ${o.plans.length?`<ul class="nz-cards" role="list">${o.plans.map(planCard).join('')}</ul>`:'<div class="empty-state">Aucune culture renseignée pour cette campagne : complétez l’assolement.</div>'}
        <h3>Cahier d’enregistrement</h3>
        <p class="form-note">Rempli automatiquement à partir des travaux de fertilisation terminés de la campagne.</p>
        ${o.register.length?`<ul class="nz-register" role="list">${o.register.map(registerRow).join('')}</ul>`:'<div class="empty-state">Aucun apport terminé pour cette campagne.</div>'}
        <p class="nz-source">Table de références ${e(o.refs.label)}. Source : ${e(o.refs.source)} <strong>${e(o.refs.verify)}</strong></p>
      </div>`,
      `<button class="button secondary" type="button" data-nz="references">Références</button><button class="button secondary" type="button" data-nz="pdf-register">PDF du cahier</button><button class="button primary" type="button" data-nz="pdf-plan">PDF du PPF</button>`,'large nitrogen-modal');
    bind();
  }

  function bind(){
    for(const b of document.querySelectorAll('[data-nz]'))b.onclick=()=>{
      const k=b.dataset.nz;
      if(k==='campaign')open({campaign:b.dataset.value});
      else if(k==='plan')openPlan(b.dataset.id);
      else if(k==='references')openReferences();
      else if(k==='pdf-plan')pdf('plan');
      else if(k==='pdf-register')pdf('register');
      else if(k==='back')open();
    };
  }

  async function pdf(kind){
    try{
      const blocks=kind==='plan'?planPdfBlocks(store.state,{today:today(),campaign}):registerPdfBlocks(store.state,{today:today(),campaign});
      const name=`${kind==='plan'?'PPF azote':'Cahier azote'} ${campaign}`;
      const file=pdfFile(flowPdf(blocks,{title:name,footer:`${name} · document indicatif`}),name);
      const result=await sharePdf(file,{title:name});
      if(result!=='cancelled')toast(result==='shared'?'PDF partagé.':'PDF téléchargé.','success');
    }catch(error){toast(`PDF impossible : ${error.message}`,'error');}
  }

  const back='<button class="button secondary" type="button" data-nz="back">Retour</button>';

  function openPlan(parcelId){
    const parcel=store.get('parcelles',parcelId);if(!parcel)return open();
    const plan=parcelPlan(store.state,parcel,campaign,{today:today()}),ppf=plan.rotation?.ppf||{};
    const zone=parcel.zoneVulnerable===true?'true':parcel.zoneVulnerable===false?'false':'';
    const chip=(v,l)=>`<button type="button" class="choice-chip${zone===v?' is-on':''}" data-value="${v}" aria-pressed="${zone===v}">${l}</button>`;
    const hist=plan.history.length?plan.history.map(h=>`${h.campaign} : ${formatNumber(h.value)} (${h.source})`).join(' · '):'aucun rendement enregistré';
    modal(`PPF · ${parcel.nom}`,`${plan.culture||'Culture non renseignée'} · campagne ${campaign}`,
      `<form id="nz-plan-form" class="form-grid" novalidate>
        <label>Reliquat sortie hiver (kg N/ha) *<input name="rsh" type="number" inputmode="decimal" min="0" max="400" step="1" required value="${e(ppf.rsh??'')}"></label>
        <label>Objectif de rendement${plan.ref?` (${e(plan.ref.unit)})`:''}<input name="yieldTarget" type="number" inputmode="decimal" min="0" max="500" step="0.1" placeholder="${plan.objective?e(formatNumber(plan.objective.value)):''}" value="${e(ppf.yieldTarget??'')}"></label>
        <label>Fournitures du sol (kg N/ha)<input name="mh" type="number" inputmode="decimal" min="0" max="300" step="1" placeholder="${e(nitrogenReferences(store.state).mh)}" value="${e(ppf.mh??'')}"></label>
        <div class="field-label span-2"><span>Parcelle en zone vulnérable</span><input type="hidden" name="zoneVulnerable" value="${zone}"><div class="chip-choices" data-chip-target="zoneVulnerable">${chip('true','Oui')}${chip('false','Non')}${chip('','Comme l’exploitation')}</div></div>
        <p class="form-note span-2">Rendements des 5 dernières campagnes : ${e(hist)}. Laissez l’objectif vide pour la moyenne olympique. Précédent : ${e(plan.precedent.culture||'non renseigné')} (${n0(plan.precedent.effect)} kg N/ha).</p>
        <p class="form-error span-2 hidden" role="alert"></p>
      </form>`,
      `${back}<button class="button primary" id="nz-plan-save">Enregistrer</button>`,'small nitrogen-form-modal');
    const form=$('#nz-plan-form');bindChipChoices?.(form);bind();
    $('#nz-plan-save').onclick=async()=>{
      if(!validateForm(form))return;
      const v=Object.fromEntries(new FormData(form));
      const next={rsh:num(v.rsh),yieldTarget:num(v.yieldTarget),mh:num(v.mh),updatedAt:Date.now()};
      try{
        const rotation=rotationFor(store.state,parcel.id,campaign);
        await store.upsert('rotations',{...(rotation||{parcelId:parcel.id,campaignId:campaign,culture:plan.culture||parcel.culture||''}),ppf:{...(rotation?.ppf||{}),...next}},{label:`PPF ${campaign} : ${parcel.nom}`});
        const zv=v.zoneVulnerable==='true'?true:v.zoneVulnerable==='false'?false:null;
        if((parcel.zoneVulnerable??null)!==zv)await store.upsert('parcelles',{...store.get('parcelles',parcel.id),zoneVulnerable:zv},{label:`Zone vulnérable : ${parcel.nom}`});
        toast('PPF enregistré.','success');open();
      }catch(error){const err=form.querySelector('.form-error');err.textContent=error.message;err.classList.remove('hidden');}
    };
  }

  function openReferences(){
    const r=nitrogenReferences(store.state);
    const rows=r.cultures.map(c=>`<tr><th scope="row">${e(c.label)}<small>${e(SEASON_LABELS[c.season])}</small></th><td><label class="nz-cell"><span class="sr-only">Besoin unitaire ${e(c.label)}</span><input name="b:${e(c.key)}" type="number" inputmode="decimal" min="0" max="100" step="0.1" value="${e(c.b)}"></label></td><td><label class="nz-cell"><span class="sr-only">Rendement par défaut ${e(c.label)}</span><input name="y:${e(c.key)}" type="number" inputmode="decimal" min="1" max="500" step="0.1" value="${e(c.yield)}"></label><small>${e(c.unit)}</small></td></tr>`).join('');
    const ban=r.banPeriods.map(p=>`<li>${e(p.type)} · ${e(SEASON_LABELS[p.season])} : du ${e(p.from.split('-').reverse().join('/'))} au ${e(p.to.split('-').reverse().join('/'))}</li>`).join('');
    modal('Références azote',`Table ${r.label}`,
      `<form id="nz-ref-form" novalidate>
        <p class="compliance-disclaimer"><strong>À vérifier.</strong> ${e(r.verify)} Source : ${e(r.source)}</p>
        <div class="table-wrap"><table class="nz-ref-table"><thead><tr><th>Culture</th><th>Besoin b (kg N/unité)</th><th>Rendement par défaut</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="form-grid"><label>Fournitures du sol par défaut (kg N/ha)<input name="mh" type="number" inputmode="decimal" min="0" max="300" step="1" value="${e(r.mh)}"></label>
        <label>Plafond d’azote organique (kg N/ha SAU)<input name="organicCap" type="number" inputmode="decimal" min="1" max="400" step="1" value="${e(r.organicCap)}"></label></div>
        <h3>Périodes d’interdiction d’épandage</h3><ul class="nz-ban">${ban}</ul>
        <p class="form-note">${Object.values(FERTILIZER_TYPES).map(e).join(' · ')}.</p>
        <h3>Fertilisants intégrés</h3><ul class="nz-ban">${FERTILIZER_LIBRARY.map(f=>`<li>${e(f.name)} : N ${formatNumber(f.N)} %, P₂O₅ ${formatNumber(f.P2O5)} %, K₂O ${formatNumber(f.K2O)} %, SO₃ ${formatNumber(f.SO3)} % · type ${e(f.type)} · Keq ${formatNumber(f.keq)}</li>`).join('')}</ul>
        <p class="form-note">Pour un autre engrais, renseignez sa composition dans Stock (Modifier › Composition).</p>
        <p class="form-error hidden" role="alert"></p>
      </form>`,
      `${back}<button class="button secondary" type="button" id="nz-ref-reset">Valeurs d’origine</button><button class="button primary" id="nz-ref-save">Enregistrer</button>`,'large nitrogen-form-modal');
    bind();
    const form=$('#nz-ref-form');
    const save=async references=>{await store.setExploitation({azote:{...(store.state.exploitation?.azote||{}),references}});toast('Références azote enregistrées.','success');open();};
    $('#nz-ref-reset').onclick=()=>save({});
    $('#nz-ref-save').onclick=async()=>{
      if(!validateForm(form))return;
      const v=Object.fromEntries(new FormData(form)),cultures={};
      for(const c of NITROGEN_REFERENCES.cultures){
        const b=num(v[`b:${c.key}`]),y=num(v[`y:${c.key}`]),x={};
        if(b!==null&&b!==c.b)x.b=b;if(y!==null&&y!==c.yield)x.yield=y;
        if(Object.keys(x).length)cultures[c.key]=x;
      }
      const mh=num(v.mh),cap=num(v.organicCap),current=store.state.exploitation?.azote?.references||{};
      try{await save({...current,cultures,...(mh!==null&&mh!==NITROGEN_REFERENCES.mh?{mh}:{mh:null}),...(cap!==null&&cap!==NITROGEN_REFERENCES.organicCap?{organicCap:cap}:{organicCap:null})});}
      catch(error){const err=form.querySelector('.form-error');err.textContent=error.message;err.classList.remove('hidden');}
    };
  }

  // Champs facultatifs « Composition » du formulaire de stock (app.js › openStockForm).
  function stockFieldsHtml(item={}){
    const f=normalizeComposition(item.fertilizer)||{};
    const field=(name,label,value,attrs='min="0" max="100" step="0.01"')=>`<label>${label}<input name="fz_${name}" type="number" inputmode="decimal" ${attrs} value="${e(value??'')}"></label>`;
    return`<details class="span-2 nz-stock"${item.fertilizer?' open':''}><summary>Composition (engrais, facultatif)</summary><div class="form-grid">
      ${field('N','N (%)',f.N)}${field('P2O5','P₂O₅ (%)',f.P2O5)}${field('K2O','K₂O (%)',f.K2O)}${field('SO3','SO₃ (%)',f.SO3)}
      <label>Type de fertilisant<select name="fz_type">${Object.entries(FERTILIZER_TYPES).map(([k,l])=>`<option value="${k}"${(f.type||'III')===k?' selected':''}>${e(l)}</option>`).join('')}</select></label>
      ${field('keq','Coefficient d’équivalence (0 à 1)',f.keq,'min="0" max="1" step="0.01"')}
      <p class="form-note span-2">Sert au PPF et au cahier azote. Sans composition, la bibliothèque intégrée (ammonitrate, urée, solution azotée, fumier et lisier bovins) est utilisée d’après le nom.</p>
    </div></details>`;
  }
  function readStockFields(values){
    const raw={};for(const k of Object.keys(values))if(k.startsWith('fz_')){raw[k.slice(3)]=values[k];delete values[k];}
    values.fertilizer=normalizeComposition(raw);
    return values;
  }

  return{open,openPlan,openReferences,stockFieldsHtml,readStockFields};
}

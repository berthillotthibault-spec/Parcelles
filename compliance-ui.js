// n° 55 — Plus › Conformité : voyants par obligation, action corrective et dossier de contrôle.
import {escapeHtml,isoDate,normalize} from './utils.js';
import {
  COMPLIANCE_DISCLAIMER,complianceChecks,complianceSettings,complianceSummary,controlDossierHtml,phytoOperators,sprayers
} from './compliance.js';
import {active} from './farm-memory.js';

const e=escapeHtml;
// Actions globales existantes (gestionnaire délégué d’app.js).
const GLOBAL_ACTIONS={phytoRegister:'open-phyto-register',register:'open-traceability',documents:'open-documents',rotations:'open-rotations',nitrogen:'open-nitrogen',pac:'open-pac',covers:'open-covers',herdHealth:'open-herd-health'};
const ITEMS_SHOWN=5;

export function createComplianceUI({store,modal,closeModal,toast,bindChipChoices,openPrintableReport}){
  const $=selector=>document.querySelector(selector);
  const today=()=>isoDate(new Date());

  function actionButton(check){
    const a=check.action;if(!a)return'';
    if(GLOBAL_ACTIONS[a.type])return`<button class="small-button compliance-fix" data-action="${GLOBAL_ACTIONS[a.type]}">${e(a.label)}</button>`;
    return`<button class="small-button compliance-fix" type="button" data-compliance="${e(a.type)}">${e(a.label)}</button>`;
  }
  function itemRow(item){
    const status=item.status?`<span class="compliance-mini is-${item.status}">${e({ko:'À corriger',warn:'À vérifier',ok:'À jour'}[item.status]||'')}</span>`:'';
    const text=`<span class="compliance-item-text"><strong>${e(item.label)}</strong><small>${e(item.note||'')}</small></span>${status}`;
    return item.action&&item.id?`<li><button class="compliance-item is-button" data-action="${e(item.action)}" data-id="${e(item.id)}">${text}<b aria-hidden="true">›</b></button></li>`:`<li><div class="compliance-item">${text}</div></li>`;
  }
  function row(check){
    const items=check.items||[],shown=items.slice(0,ITEMS_SHOWN),more=items.length-shown.length;
    return`<li class="compliance-row is-${check.status}" data-check="${e(check.id)}">
      <span class="compliance-dot" aria-hidden="true"></span>
      <div class="compliance-main">
        <div class="compliance-head"><strong>${e(check.label)}</strong><span class="compliance-status is-${check.status}">${e(check.statusLabel)}</span></div>
        <p>${e(check.detail)}</p>
        ${check.hint&&check.status!=='ok'?`<p class="compliance-hint">${e(check.hint)}</p>`:''}
        ${shown.length?`<ul class="compliance-items">${shown.map(itemRow).join('')}</ul>${more>0?`<p class="compliance-more">… et ${more} autre${more>1?'s':''}.</p>`:''}`:''}
        ${actionButton(check)}
      </div>
    </li>`;
  }

  function open(){
    const data=store.state,checks=complianceChecks(data,{today:today()}),summary=complianceSummary(checks),c=summary.counts;
    const chips=[['ko','à corriger'],['warn','à vérifier'],['unknown','non suivi'+(c.unknown>1?'s':'')],['ok','à jour']].map(([k,l])=>`<span class="compliance-count is-${k}"><b>${c[k]}</b> ${l}</span>`).join('');
    modal('Prêt pour un contrôle ?','Registres, certificats et règles de culture, d’après vos saisies.',
      `<div class="compliance">
        <div class="compliance-summary is-${summary.status}" role="status"><strong>${e(summary.headline)}</strong><div class="compliance-counts">${chips}</div></div>
        <p class="compliance-disclaimer"><strong>Indicatif.</strong> ${e(COMPLIANCE_DISCLAIMER)}</p>
        <ul class="compliance-list">${checks.map(row).join('')}</ul>
      </div>`,
      `<button class="button primary compliance-dossier" id="compliance-dossier">Dossier de contrôle</button><button class="text-button compliance-settings-link" type="button" data-compliance="settings">Réglages de la conformité</button>`,
      'compliance-modal');
    bind();
  }

  function bind(){
    for(const button of document.querySelectorAll('[data-compliance]'))button.onclick=()=>{
      const type=button.dataset.compliance;
      if(type==='settings')openSettings();else if(type==='sprayer')openSprayer();else if(type==='certiphyto')openCertiphyto();
    };
    const dossier=$('#compliance-dossier');if(dossier)dossier.onclick=printDossier;
  }

  // window.open(…,'noopener') renvoie toujours null : on ne peut pas savoir si l’onglet a été
  // bloqué, d’où le téléchargement proposé en secours dans le toast.
  function printDossier(){
    let html;
    try{html=controlDossierHtml(store.state,{today:today()});}
    catch(error){toast(`Dossier impossible : ${error.message}`,'error');return;}
    let win=false;try{win=openPrintableReport(html);}catch{}
    toast(win?'Dossier de contrôle ouvert dans un nouvel onglet : « Imprimer / PDF ».':'Dossier de contrôle prêt : imprimez-le ou obtenez le PDF.','success',{label:'Télécharger',run:()=>download(html)});
  }
  function download(html){
    const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'})),a=document.createElement('a');
    a.href=url;a.download=`dossier-controle-${today()}.html`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }

  const showError=(form,text)=>{const node=form.querySelector('.form-error');if(node){node.textContent=text;node.classList.remove('hidden');}};
  const back=`<button class="button secondary" type="button" data-compliance-back>Retour</button>`;
  function bindBack(){for(const b of document.querySelectorAll('[data-compliance-back]'))b.onclick=open;}
  async function saveSettings(patch){
    const current=store.state.exploitation?.conformite||{};
    await store.setExploitation({conformite:{...current,...patch}});
  }

  function openSettings(){
    const s=complianceSettings(store.state);
    const chip=(v,l)=>`<button type="button" class="choice-chip${String(s.zoneVulnerable)===v?' is-on':''}" data-value="${v}" aria-pressed="${String(s.zoneVulnerable)===v}">${l}</button>`;
    modal('Réglages de la conformité','Seuils retenus pour les voyants. Adaptez-les aux règles de votre département.',
      `<form id="compliance-settings" class="form-grid" novalidate>
        <div class="field-label span-2"><span>Exploitation en zone vulnérable nitrates *</span><input type="hidden" name="zoneVulnerable" value="${s.zoneVulnerable}"><div class="chip-choices" data-chip-target="zoneVulnerable">${chip('true','Oui')}${chip('false','Non')}</div></div>
        <label>Contrôle du pulvérisateur tous les (ans) *<input name="sprayerControlYears" type="number" inputmode="numeric" min="1" max="10" step="1" value="${s.sprayerControlYears}"></label>
        <label>Même culture au plus (campagnes consécutives) *<input name="rotationMaxSame" type="number" inputmode="numeric" min="1" max="10" step="1" value="${s.rotationMaxSame}"></label>
        <label class="span-2">Prévenir avant une échéance (jours) *<input name="warnDays" type="number" inputmode="numeric" min="0" max="365" step="1" value="${s.warnDays}"></label>
        <p class="form-note span-2">Valeurs indicatives : 3 ans pour le contrôle périodique des pulvérisateurs ; pour la rotation (BCAE 7), reportez la règle de la campagne en cours.</p>
        <p class="form-error span-2 hidden" role="alert"></p>
      </form>`,
      `${back}<button class="button primary compliance-save" id="compliance-settings-save">Enregistrer</button>`,'small compliance-form-modal');
    const form=$('#compliance-settings');bindChipChoices?.(form);bindBack();
    $('#compliance-settings-save').onclick=async()=>{
      const v=Object.fromEntries(new FormData(form));
      const fields=[['sprayerControlYears','contrôle du pulvérisateur',1,10],['rotationMaxSame','même culture au plus',1,10],['warnDays','prévenir avant une échéance',0,365]];
      for(const [name,label,min,max] of fields){
        const raw=String(v[name]??'').trim(),n=Number(raw);
        if(!raw)return showError(form,`Champ obligatoire : ${label}.`);
        if(!Number.isInteger(n)||n<min||n>max)return showError(form,`Valeur à corriger : ${label} (entre ${min} et ${max}).`);
      }
      try{
        await saveSettings({zoneVulnerable:v.zoneVulnerable==='true',sprayerControlYears:Number(v.sprayerControlYears),rotationMaxSame:Number(v.rotationMaxSame),warnDays:Number(v.warnDays)});
        toast('Réglages de la conformité enregistrés.','success');open();
      }catch(error){showError(form,error.message);}
    };
  }

  function openSprayer(){
    const list=sprayers(store.state),machines=active(store.state,'materiels');
    const rows=list.map(m=>`<label class="span-2">Dernier contrôle : ${e(m.nom||'Pulvérisateur')}<input type="date" name="control:${e(m.id)}" value="${e(m.controleDate||'')}" max="${today()}"></label>`).join('');
    const others=machines.filter(m=>!list.includes(m));
    const add=others.length?`<label class="span-2">${list.length?'Autre pulvérisateur':'Pulvérisateur *'}<select name="newId"><option value="">Choisir dans le matériel…</option>${others.map(m=>`<option value="${e(m.id)}">${e(m.nom||'Matériel')}</option>`).join('')}</select></label><label class="span-2">Date de son dernier contrôle${list.length?'':' *'}<input type="date" name="newDate" max="${today()}"></label>`:'';
    const empty=!list.length&&!others.length;
    modal('Contrôle du pulvérisateur','Date du dernier contrôle périodique (rapport de l’organisme d’inspection).',
      empty?`<div class="empty-state">Aucun matériel enregistré. Ajoutez d’abord votre pulvérisateur dans Matériel.</div>`:`<form id="compliance-sprayer" class="form-grid" novalidate>${rows}${add}<p class="form-error span-2 hidden" role="alert"></p></form>`,
      empty?`${back}<button class="button primary compliance-save" data-action="open-equipment">Ouvrir le matériel</button>`:`${back}<button class="button primary compliance-save" id="compliance-sprayer-save">Enregistrer</button>`,'small compliance-form-modal');
    bindBack();if(empty)return;
    const form=$('#compliance-sprayer');
    $('#compliance-sprayer-save').onclick=async()=>{
      const v=Object.fromEntries(new FormData(form)),updates=[];
      for(const m of list){const date=String(v[`control:${m.id}`]||'');if(date!==(m.controleDate||''))updates.push({...m,controleDate:date||null});}
      if(v.newId||v.newDate){
        if(!v.newId)return showError(form,'Champ obligatoire : pulvérisateur.');
        if(!v.newDate)return showError(form,'Champ obligatoire : date de son dernier contrôle.');
        const m=machines.find(x=>x.id===v.newId);if(m)updates.push({...m,controleDate:v.newDate});
      }else if(!list.length)return showError(form,'Champ obligatoire : pulvérisateur.');
      if(updates.some(u=>u.controleDate&&u.controleDate>today()))return showError(form,'La date du contrôle ne peut pas être dans le futur.');
      try{
        for(const u of updates)await store.upsert('materiels',u,{label:`Contrôle pulvérisateur renseigné : ${u.nom||'matériel'}`});
        toast(updates.length?'Contrôle du pulvérisateur enregistré.':'Aucune modification.','success');open();
      }catch(error){showError(form,error.message);}
    };
  }

  function openCertiphyto(){
    const s=complianceSettings(store.state),known=new Map(s.certiphytos.map(c=>[normalize(c.nom),c]));
    const names=[...new Set([...phytoOperators(store.state),...s.certiphytos.map(c=>c.nom)])];
    const rows=names.map((nom,i)=>`<input type="hidden" name="nom:${i}" value="${e(nom)}"><label class="span-2">Certiphyto de ${e(nom)} : valable jusqu’au<input type="date" name="date:${i}" value="${e(known.get(normalize(nom))?.expiresAt||'')}"></label>`).join('');
    modal('Certiphyto des opérateurs','Date de fin de validité indiquée sur chaque certificat individuel.',
      `<form id="compliance-certiphyto" class="form-grid" novalidate>${rows}<label>Autre personne<input name="extraNom" maxlength="60" autocomplete="name" placeholder="Prénom Nom"></label><label>Valable jusqu’au<input type="date" name="extraDate"></label><p class="form-note span-2">Les opérateurs viennent des traitements saisis sur les 12 derniers mois. Laissez vide une date inconnue.</p><p class="form-error span-2 hidden" role="alert"></p></form>`,
      `${back}<button class="button primary compliance-save" id="compliance-certiphyto-save">Enregistrer</button>`,'small compliance-form-modal');
    bindBack();
    const form=$('#compliance-certiphyto');
    $('#compliance-certiphyto-save').onclick=async()=>{
      const v=Object.fromEntries(new FormData(form)),list=names.map((_,i)=>({nom:String(v[`nom:${i}`]||'').trim(),expiresAt:String(v[`date:${i}`]||'')})).filter(c=>c.nom&&c.expiresAt);
      const extraNom=String(v.extraNom||'').replace(/\s+/g,' ').trim();
      if(v.extraDate&&!extraNom)return showError(form,'Champ obligatoire : nom de l’autre personne.');
      if(extraNom&&!v.extraDate)return showError(form,`Champ obligatoire : date de validité pour ${extraNom}.`);
      if(extraNom){const i=list.findIndex(c=>normalize(c.nom)===normalize(extraNom));const entry={nom:extraNom,expiresAt:v.extraDate};if(i>=0)list[i]=entry;else list.push(entry);}
      try{
        await saveSettings({certiphytos:list});
        toast(list.length?`Certiphyto à jour : ${list.length} personne${list.length>1?'s':''}.`:'Certiphyto mis à jour.','success');open();
      }catch(error){showError(form,error.message);}
    };
  }

  return{open,printDossier};
}


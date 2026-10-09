// n° 58 — Plus › Assistant PAC : déclaration par îlot (CSV), contrôle BCAE 7, rappel BCAE 6 et
// simulateur d’éco-régime. Simulation seulement : lien vers Telepac, aucune transmission.
import {campaignFor,downloadBlob,escapeHtml,formatNumber,isoDate} from './utils.js';
import {validateForm} from './form-chips-ui.js';
import {
  PAC_CATEGORIES,PAC_CODES,PAC_DISCLAIMER,PAC_SOURCE,PAC_VERIFY,TELEPAC_URL,BCAE7_COLORS,
  bcae6Summary,bcae7Summary,declarationCsv,declarationRows,ecoRegime
} from './pac.js';

const e=escapeHtml;
const ha=v=>`${formatNumber(Math.round(v*100)/100)} ha`;
const pct=v=>`${formatNumber(Math.round(v*100))} %`;
const shift=(c,d)=>{const y=Number(String(c).slice(0,4))+d;return`${y}/${String(y+1).slice(-2)}`;};

export function createPacUI({store,modal,toast,bindChipChoices,showMapMode}){
  const $=selector=>document.querySelector(selector);
  const today=()=>isoDate(new Date());
  let campaign=campaignFor();

  function declarationHtml(rows){
    if(!rows.length)return'<div class="empty-state">Aucune parcelle en propre.</div>';
    return`<ul class="pac-decl" role="list">${rows.map(r=>`<li class="pac-decl-row">
      <span class="pac-ilot" title="Îlot">${r.ilot?`Îlot ${e(r.ilot)}`:'Îlot ?'}</span>
      <div class="pac-decl-main"><strong>${e(r.parcel.nom)}</strong><small>${e(r.culture||'Culture non renseignée')} · ${ha(r.surface)}${r.prairie?` · prairie ${e(r.prairie)}`:''}</small></div>
      <span class="pac-code${r.code?'':' is-missing'}"><b>${e(r.code||'—')}</b><small>${e(r.codeSource||'à saisir')}</small></span>
      <button class="small-button pac-edit" type="button" data-pac="edit" data-id="${e(r.parcel.id)}" aria-label="Modifier la déclaration de ${e(r.parcel.nom)}">Modifier</button>
    </li>`).join('')}</ul>`;
  }
  function bcaeHtml(s,b6){
    const items=s.faulty.map(r=>`<li><strong>${e(r.parcel.nom)}</strong> · ${e(r.culture)} sur ${s.rules.bcae7.years} campagnes</li>`).join('');
    const legend=Object.entries(BCAE7_COLORS).map(([k,v])=>`<span class="pac-legend-item"><i style="background:${v.color}" aria-hidden="true"></i>${e(v.label)}</span>`).join('');
    return`<div class="pac-status is-${s.status}" role="status"><strong>${s.status==='ok'?'Rotation conforme d’après vos saisies':s.status==='na'?'Aucune terre arable concernée':s.status==='ko'?'Rotation à corriger':'Rotation à vérifier'}</strong>
      <p>${s.area?`${pct(s.share)} des terres arables (${ha(s.changedArea)} sur ${ha(s.area)}) ont changé de culture cette campagne : seuil ${pct(s.rules.bcae7.minChangedShare)} ${s.shareOk?'atteint':'non atteint'}.`:''}${s.unknownArea?` Historique incomplet sur ${ha(s.unknownArea)} : saisissez les cultures des campagnes précédentes.`:''}</p>
      <div class="pac-bar" role="img" aria-label="Part de terres arables changées : ${pct(s.share)}"><span style="width:${Math.min(100,Math.round(s.share*100))}%"></span><i style="left:${Math.round(s.rules.bcae7.minChangedShare*100)}%" aria-hidden="true"></i></div></div>
      ${items?`<p>Parcelles sans changement de culture sur ${s.rules.bcae7.years} campagnes :</p><ul class="pac-faulty">${items}</ul>`:'<p>Aucune terre arable avec la même culture sur 3 campagnes.</p>'}
      <div class="pac-legend">${legend}</div>
      <button class="button secondary pac-map" type="button" data-pac="map">Voir sur la carte</button>
      <p class="pac-reminder"><strong>Rappel BCAE 6.</strong> ${e(b6.text)} D’après l’assolement : ${ha(b6.coveredArea)} sur ${ha(b6.area)} de terres arables couverts${b6.uncovered.length?` ; à couvrir : ${e(b6.uncovered.map(r=>r.parcel.nom).join(', '))}`:''}.</p>`;
  }
  function ecoHtml(eco){
    const comp=eco.components.map(c=>`<li><span>${e(c.label)}</span><strong>${c.unit==='points'?`${formatNumber(c.value)} point${c.value>1?'s':''}`:pct(c.value)}</strong><small>standard ${c.unit==='points'?c.target.standard:pct(c.target.standard)} · supérieur ${c.unit==='points'?c.target.superieur:pct(c.target.superieur)}</small></li>`).join('');
    const cats=eco.categories.filter(c=>c.area>0).map(c=>`<li>${e(c.label)} : ${ha(c.area)} (${pct(c.share)}) · ${c.points} pt${c.points>1?'s':''}</li>`).join('');
    return`<div class="pac-eco is-level-${eco.level}" role="status"><span class="pac-eco-tag">Simulation</span><strong>${e(eco.level===2?'Niveau supérieur atteint':eco.levelLabel)}</strong>
      <p>${e(eco.advice.text)}</p>
      <p class="pac-eco-amount">Estimation : ${eco.amountHa?`${formatNumber(eco.amountHa)} €/ha, soit environ ${formatNumber(eco.amountTotal)} € sur ${ha(eco.sau)}`:`0 €/ha${eco.nextAmountHa?` (niveau standard : ${formatNumber(eco.nextAmountHa)} €/ha)`:''}`}.</p></div>
      ${comp?`<ul class="pac-components">${comp}</ul>`:''}
      ${cats?`<details class="pac-details"><summary>Détail de l’assolement des terres arables</summary><ul>${cats}</ul></details>`:''}`;
  }

  function open(options={}){
    if(options.campaign)campaign=options.campaign;
    const data=store.state,rows=declarationRows(data,campaign,{today:today()}),s=bcae7Summary(data,campaign,{today:today()}),b6=bcae6Summary(data,campaign,{today:today()}),eco=ecoRegime(data,campaign,{today:today()});
    const chips=[shift(campaignFor(),-1),campaignFor(),shift(campaignFor(),1)].map(c=>`<button type="button" class="choice-chip${c===campaign?' is-on':''}" data-pac="campaign" data-value="${e(c)}" aria-pressed="${c===campaign}">${e(c)}</button>`).join('');
    modal('Assistant PAC',`Campagne ${campaign} · déclaration ${eco.rules.declaration}${eco.rules.exact?'':` (règles ${eco.rules.campaign})`}`,
      `<div class="pac">
        <div class="chip-choices pac-campaigns" role="group" aria-label="Campagne">${chips}</div>
        <p class="compliance-disclaimer"><strong>Simulation.</strong> ${e(PAC_DISCLAIMER)}</p>
        <section class="pac-block"><h3>Déclaration par îlot</h3><p class="form-note">À recopier dans Telepac. Code culture déduit de la culture, du RPG ou saisi.</p>${declarationHtml(rows)}</section>
        <section class="pac-block"><h3>Contrôle BCAE 7</h3>${bcaeHtml(s,b6)}</section>
        <section class="pac-block"><h3>Éco-régime, voie des pratiques</h3>${ecoHtml(eco)}</section>
        <p class="nz-source">Règles ${e(eco.rules.version)} du ${e(eco.rules.date.split('-').reverse().join('/'))}. Source : ${e(PAC_SOURCE)} <strong>${e(PAC_VERIFY)}</strong></p>
      </div>`,
      `<a class="button secondary pac-telepac" href="${TELEPAC_URL}" target="_blank" rel="noopener noreferrer">Ouvrir Telepac</a><button class="button primary" type="button" data-pac="csv">Exporter le CSV</button>`,'large pac-modal');
    bind();
  }

  function bind(){
    for(const b of document.querySelectorAll('[data-pac]'))b.onclick=()=>{
      const k=b.dataset.pac;
      if(k==='campaign')open({campaign:b.dataset.value});
      else if(k==='edit')openEdit(b.dataset.id);
      else if(k==='csv')exportCsv();
      else if(k==='map')showMapMode?.('bcae7');
      else if(k==='back')open();
    };
  }

  function exportCsv(){
    const rows=declarationRows(store.state,campaign,{today:today()});
    downloadBlob(`declaration-pac-${campaign.replace('/','-')}.csv`,new Blob([declarationCsv(rows,campaign)],{type:'text/csv;charset=utf-8'}));
    toast('CSV de la déclaration téléchargé (à recopier dans Telepac).','success');
  }

  function openEdit(parcelId){
    const row=declarationRows(store.state,campaign,{today:today()}).find(r=>r.parcel.id===parcelId);if(!row)return open();
    const prairie=row.rotation?.pac?.prairie||'';
    const chip=(name,current,v,l)=>`<button type="button" class="choice-chip${current===v?' is-on':''}" data-value="${v}" aria-pressed="${current===v}">${l}</button>`;
    const interrang=row.parcel.interrangCouvert===true?'true':row.parcel.interrangCouvert===false?'false':'';
    modal(`Déclaration · ${row.parcel.nom}`,`${row.culture||'Culture non renseignée'} · ${ha(row.surface)} · campagne ${campaign}`,
      `<form id="pac-form" class="form-grid" novalidate>
        <label class="span-2">Code culture PAC<input name="code" list="pac-codes" maxlength="3" pattern="[A-Za-z0-9]{3}" autocapitalize="characters" value="${e(row.rotation?.pac?.code||'')}" placeholder="${e(row.code||'')}"><datalist id="pac-codes">${PAC_CODES.map(c=>`<option value="${c.code}">${e(c.label)}</option>`).join('')}</datalist></label>
        <div class="field-label span-2"><span>Prairie</span><input type="hidden" name="prairie" value="${e(prairie)}"><div class="chip-choices" data-chip-target="prairie">${chip('prairie',prairie,'permanente','Permanente')}${chip('prairie',prairie,'temporaire','Temporaire')}${chip('prairie',prairie,'','Automatique')}</div></div>
        ${row.kind==='PERENNE'?`<div class="field-label span-2"><span>Interrang couvert</span><input type="hidden" name="interrang" value="${interrang}"><div class="chip-choices" data-chip-target="interrang">${chip('i',interrang,'true','Oui')}${chip('i',interrang,'false','Non')}</div></div>`:''}
        <p class="form-note span-2">Laissez le code vide pour reprendre le code proposé (${e(row.code||'aucun')}, ${e(row.codeSource||'—')}). Catégorie retenue : ${e(PAC_CATEGORIES[row.category]||'non classée')}.</p>
        <p class="form-error span-2 hidden" role="alert"></p>
      </form>`,
      `<button class="button secondary" type="button" data-pac="back">Retour</button><button class="button primary" id="pac-save">Enregistrer</button>`,'small pac-form-modal');
    const form=$('#pac-form');bindChipChoices?.(form);bind();
    $('#pac-save').onclick=async()=>{
      if(!validateForm(form))return;
      const v=Object.fromEntries(new FormData(form)),pac={code:String(v.code||'').trim().toUpperCase(),prairie:v.prairie||''};
      try{
        const r=row.rotation;
        await store.upsert('rotations',{...(r||{parcelId:row.parcel.id,campaignId:campaign,culture:row.culture||row.parcel.culture||''}),pac},{label:`Déclaration PAC ${campaign} : ${row.parcel.nom}`});
        if(row.kind==='PERENNE'&&v.interrang){const next=v.interrang==='true';if(row.parcel.interrangCouvert!==next)await store.upsert('parcelles',{...store.get('parcelles',row.parcel.id),interrangCouvert:next},{label:`Interrang : ${row.parcel.nom}`});}
        toast('Déclaration enregistrée.','success');open();
      }catch(error){const err=form.querySelector('.form-error');err.textContent=error.message;err.classList.remove('hidden');}
    };
  }

  return{open,openEdit};
}

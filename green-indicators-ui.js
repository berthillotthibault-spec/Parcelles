// n° 71 — Écran « Mon exploitation en chiffres verts » (Plus › Gestion), chargé à la demande
// (lazy-modules.js) : chiffres clés, jauge par thème HVE, pistes de progrès, CO2 estimé et fiche
// imprimable. Aucune nouvelle saisie : seules deux références IFT facultatives sont réglables, et pas
// en lecture seule. Boutons repérés par data-green : un seul écouteur délégué, installé une fois.
import {escapeHtml as e,isoDate,localDate} from './utils.js';
import {roleCan} from './permissions.js';
import {CO2_FACTORS,campaignChoices,greenIndicators,greenSettings,greenSheetHtml,improvementTips,keyFigures,themeSentence,validateGreenSettings} from './green-indicators.js';
import {assetBase,openPrintable} from './dossier-ui.js';

const STATUS={ok:'atteint',partial:'partiel',low:'à travailler',missing:'donnée incomplète'};
// Raccourcis vers les écrans sources (actions globales du délégué d'app.js).
const SOURCES={iae:['open-hedges','Haies et IAE'],prairies:['open-pac','Assistant PAC'],cultures:['open-pac','Assistant PAC'],ift:['ift-open','IFT'],azote:['open-nitrogen','Azote'],gnr:['open-fuel','Carburant GNR'],intrants:['open-crop-margins','Marges par culture']};

export function createGreenIndicatorsUI({store,modal,toast,role=()=>'owner',catalogLookup=()=>null}){
  const $=s=>document.querySelector(s);
  const data=()=>store.snapshot();
  const today=()=>isoDate(new Date());
  const canEdit=()=>roleCan(role(),'write')&&!store.tabReadOnly;
  let campaign=null;

  function gauge(t){
    if(t.na)return`<p class="form-note">${e(t.naReason)}</p>`;
    const pctW=Math.round(Math.min(1,t.points/t.max)*100);
    return`<div class="gs-bar" role="meter" aria-label="${e(themeSentence(t))}" aria-valuemin="0" aria-valuemax="${t.max}" aria-valuenow="${t.points}"><span style="width:${pctW}%;background:var(${t.reached?'--success':'--warning'})"></span></div>`;
  }
  function themeCard(t){
    const rows=t.items.map(i=>`<div class="list-row"><div><strong>${e(i.label)}</strong><small>${e(i.display)}${i.missing?' · donnée incomplète':''}${i.hint?` · ${e(i.hint)}`:''}</small></div><strong aria-label="${i.points} sur ${i.max} points, ${STATUS[i.status]}">${i.points}/${i.max}</strong></div>`).join('');
    return`<section class="panel" aria-labelledby="gi-${t.key}"><h3 id="gi-${t.key}">${e(t.label)}</h3><p><strong>${e(themeSentence(t))}</strong>${t.incomplete&&!t.na?' <small class="form-note">(certaines données manquent : score à confirmer)</small>':''}</p>${gauge(t)}${rows?`<div class="stack-list">${rows}</div>`:''}</section>`;
  }

  function open(opts={}){
    if(opts.campaign)campaign=opts.campaign;
    const choices=campaignChoices(today());campaign=choices.includes(campaign)?campaign:choices[0];
    let r;try{r=greenIndicators(data(),{campaign,today:today(),catalog:catalogLookup});}catch(error){toast(`Calcul impossible : ${error.message}`,'error');return;}
    const ref=r.referential,tips=improvementTips(r),settings=greenSettings(data()),edit=canEdit();
    const figures=keyFigures(r).map(k=>{const src=SOURCES[k.key];return`<div class="preview-stat"><strong>${e(k.value)}</strong><small>${e(k.label)}</small><small style="display:block;margin-top:4px">${e(k.detail)}</small>${src?`<button type="button" class="text-button" data-action="${src[0]}">${e(src[1])} ›</button>`:''}</div>`;}).join('');
    const co2=r.carbon.lines.map(l=>`<div class="list-row"><div><strong>${e(l.label)}</strong><small>${e(Number(l.base||0).toLocaleString('fr-FR',{maximumFractionDigits:0}))} ${e(l.baseUnit)} × ${e(String(l.factor.value).replace('.',','))} ${e(l.factor.unit)} · ${e(l.factor.source)}</small></div><strong>${e(l.kg.toLocaleString('fr-FR'))} kg</strong></div>`).join('');
    const body=`<p class="notice warning" role="note"><strong>Auto-diagnostic, pas une certification.</strong> ${e(r.disclaimer)}</p>
<label class="span-2">Campagne <select id="gi-campaign">${choices.map(c=>`<option value="${e(c)}" ${c===campaign?'selected':''}>${e(c)}</option>`).join('')}</select></label>
${r.empty?'<p class="notice info" role="note">Aucune parcelle en propriété ou en fermage : ajoutez vos parcelles pour obtenir des indicateurs.</p>':''}
<h3>Chiffres clés</h3><div class="preview-summary">${figures}</div>
<h3>Grille HVE simplifiée · ${r.reached}/${r.scored} thème${r.scored>1?'s':''} au seuil de ${ref.threshold} points</h3>
${r.themes.map(themeCard).join('')}
${tips.length?`<h3>Pistes de progrès</h3><ol class="stack-list">${tips.map(t=>`<li><strong>${e(t.theme)} · ${e(t.label)}</strong> (jusqu’à +${t.gain} point${t.gain>1?'s':''}) : ${e(t.hint)}</li>`).join('')}</ol>`:''}
<h3>CO2 estimé : ${e(r.carbon.tonnes.toLocaleString('fr-FR'))} t CO2e${r.carbon.perHa===null?'':` (${e(r.carbon.perHa.toLocaleString('fr-FR'))} kg/ha)`}</h3><div class="stack-list">${co2}</div>
<p class="form-note">Facteurs fixes au ${e(localDate(CO2_FACTORS.date))}. ${e(r.carbon.scope)}</p>
<details><summary>Références IFT du territoire (facultatif)</summary><form id="gi-settings" class="form-grid">
<label>IFT herbicide de référence<input name="iftRefHerbicide" type="number" min="0" max="20" step="any" inputmode="decimal" value="${e(settings.iftRefHerbicide??'')}" ${edit?'':'disabled'}></label>
<label>IFT hors herbicide de référence<input name="iftRefOther" type="number" min="0" max="20" step="any" inputmode="decimal" value="${e(settings.iftRefOther??'')}" ${edit?'':'disabled'}></label>
<p class="form-note span-2">Valeurs de la région et de l’orientation (DRAAF, chambre d’agriculture). Sans référence, des seuils absolus prudents s’appliquent.${edit?'':' Lecture seule : modification réservée aux rôles qui peuvent saisir.'}</p>
<p class="form-error span-2" id="gi-error" role="alert" hidden></p>${edit?'<div class="span-2"><button type="button" class="button secondary" data-green="save-settings">Enregistrer les références</button></div>':''}</form></details>
<p class="form-note">${e(ref.label)} · version ${e(ref.version)} du ${e(localDate(ref.date))}. ${e(ref.note)} ${e(r.inputs.reference.note)}</p>`;
    modal('Mon exploitation en chiffres verts',`Auto-diagnostic environnemental · campagne ${campaign} · référentiel ${ref.version}`,body,
      `<button type="button" class="button primary" data-green="print">Fiche imprimable</button>`,'large');
    const select=$('#gi-campaign');if(select)select.onchange=()=>open({campaign:select.value});
  }

  async function saveSettings(){
    if(!canEdit())return toast('Lecture seule : références non modifiables.','info');
    const form=$('#gi-settings');if(!form)return;
    const res=validateGreenSettings(Object.fromEntries(new FormData(form)));
    if(res.error){const el=$('#gi-error');if(el){el.textContent=res.error;el.hidden=false;}return;}
    await store.setPreferences({greenIndicators:{...res.value,updatedAt:Date.now()}});
    toast('Références IFT enregistrées.','success');open();
  }

  function print(){
    let html;const d=data();
    try{html=greenSheetHtml(greenIndicators(d,{campaign,today:today(),catalog:catalogLookup}),{farm:d.exploitation||{},assetBase:assetBase()});}
    catch(error){toast(`Fiche impossible : ${error.message}`,'error');return;}
    const how=openPrintable(html,`Chiffres verts ${campaign}`);
    toast(how==='window'?'Fiche ouverte dans un nouvel onglet : « Imprimer / PDF ».':'Fiche prête : imprimez-la ou obtenez le PDF.','success');
  }

  async function action(name){
    if(name==='print')return print();
    if(name==='save-settings')return saveSettings();
  }
  document.addEventListener('click',ev=>{const c=ev.target.closest('[data-green]');if(!c||c.disabled)return;c.disabled=true;Promise.resolve(action(c.dataset.green)).catch(error=>toast(error.message,'error')).finally(()=>{c.disabled=false;});});
  return{open};
}

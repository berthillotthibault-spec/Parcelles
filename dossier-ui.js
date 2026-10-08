// Interface du dossier de campagne (n° 83) : choix du destinataire, de la campagne et du contenu,
// puis ouverture du document imprimable. Si window.open est bloqué (PWA iOS, bloqueur de
// fenêtres), le document s’affiche dans une visionneuse plein écran avec une iframe d’impression.
// Boutons repérés par data-dossier : un seul écouteur délégué, installé une fois.
import {escapeHtml as e,campaignFor} from './utils.js';
import {DOSSIER_PRESETS,DOSSIER_SECTIONS,dossierCampaigns,dossierHtml,presetById} from './dossier.js';
import {flowPdf,htmlBlocks,isTouchDevice,pdfFile,sharePdf} from './pdf-lite.js';

const PREF_KEY='parcelles:dossier-preset';
const readPref=()=>{try{return globalThis.localStorage?.getItem(PREF_KEY)||'';}catch{return'';}};
const writePref=v=>{try{globalThis.localStorage?.setItem(PREF_KEY,v);}catch{}};
const standaloneIos=()=>{try{return /iPad|iPhone|iPod/.test(navigator.userAgent)&&(navigator.standalone===true||matchMedia('(display-mode: standalone)').matches);}catch{return false;}};
export const assetBase=()=>{try{return new URL('./',location.href).href;}catch{return'';}};

let viewerReturnFocus=null,viewerPdf=null;
function closeViewer(){const v=document.querySelector('.dz-viewer');viewerPdf=null;if(!v)return;v.remove();document.removeEventListener('keydown',viewerKey,true);if(viewerReturnFocus?.isConnected)viewerReturnFocus.focus?.({preventScroll:true});viewerReturnFocus=null;}
function viewerKey(event){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeViewer();}}

// PDF « texte » générique d’un document imprimable HTML (titres, paragraphes, tableaux).
export function genericPdf(html,title='Document'){
  const doc=new DOMParser().parseFromString(String(html),'text/html'),name=title||doc.title||'Document';
  return flowPdf(htmlBlocks(doc),{title:name,footer:name.slice(0,110)});
}
// Visionneuse : le document reste dans l’application. Bouton PDF (vrai fichier, partage iOS ou
// téléchargement) ; « Imprimer » via l’iframe seulement sur ordinateur (inopérant dans l’app iOS).
// pdf = {name, make:()=>Uint8Array} facultatif ; sinon PDF générique tiré du HTML.
export function showPrintable(html,title='Document',{pdf=null}={}){
  closeViewer();viewerReturnFocus=document.activeElement;
  const touch=isTouchDevice();
  viewerPdf={name:pdf?.name||`${title}.pdf`,make:pdf?.make||(()=>genericPdf(html,title)),title,bytes:null};
  const root=document.createElement('div');root.className='dz-viewer';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label',title);
  root.innerHTML=`<header class="dz-viewer-bar"><strong>${e(title)}</strong><div class="dz-viewer-actions"><button type="button" class="button primary" data-dossier="viewer-pdf" aria-label="${e(touch?`Partager ou imprimer le PDF : ${title}`:`Télécharger le PDF : ${title}`)}">${touch?'Partager / imprimer le PDF':'Télécharger le PDF'}</button>${touch?'':'<button type="button" class="button secondary" data-dossier="viewer-print">Imprimer</button>'}<button type="button" class="button secondary dz-viewer-close" data-dossier="viewer-close" aria-label="Fermer le document">Fermer</button></div></header><iframe class="dz-viewer-frame" title="${e(title)}"></iframe>`;
  document.body.append(root);root.querySelector('iframe').srcdoc=String(html).replace('</head>','<style>.dz-toolbar,#print{display:none!important}</style></head>');document.addEventListener('keydown',viewerKey,true);root.querySelector('[data-dossier="viewer-close"]').focus({preventScroll:true});
  return root;
}

// Ouvre un document imprimable dans un nouvel onglet (ordinateur) ; sur téléphone ou tablette, et si
// l’onglet est bloqué, visionneuse intégrée avec le bouton PDF.
export function openPrintable(html,title='Document',options={}){
  if(!standaloneIos()&&!isTouchDevice()){
    try{const blob=new Blob([html],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(blob),win=window.open(url,'_blank');setTimeout(()=>URL.revokeObjectURL(url),120000);if(win){try{win.opener=null;}catch{}return'window';}URL.revokeObjectURL(url);}catch{}
  }
  showPrintable(html,title,options);return'viewer';
}
// Remise du PDF de la visionneuse : génération synchrone puis partage DANS le geste (exigence iOS).
export function deliverViewerPdf(toast){
  const v=viewerPdf;if(!v)return;
  try{if(!v.bytes)v.bytes=v.make();}catch(error){toast?.(error?.message||'Impossible de préparer le PDF.','error');return;}
  const file=pdfFile(v.bytes,v.name);
  sharePdf(file,{title:v.title,preferShare:isTouchDevice()}).then(how=>{if(how==='downloaded')toast?.(`PDF téléchargé : ${file.name}`,'success');}).catch(()=>toast?.('Partage du PDF impossible.','error'));
}

export function createDossierUI({store,modal,closeModal,toast}){
  const state=()=>store.state||store.snapshot();
  let campaignChoice=campaignFor();

  function sectionBoxes(preset){
    return DOSSIER_SECTIONS.map(s=>`<label class="dossier-check"><input type="checkbox" name="section" value="${e(s.id)}"${preset.sections.includes(s.id)?' checked':''}><span>${e(s.label)}</span></label>`).join('');
  }

  function open(campaign=null){
    const data=state(),campaigns=dossierCampaigns(data);campaignChoice=campaign&&campaigns.includes(campaign)?campaign:campaigns.includes(campaignChoice)?campaignChoice:campaigns[0];
    const preset=presetById(readPref());
    const body=`<form id="dossier-form" class="form-grid dossier-form" novalidate>
<div class="span-2"><span class="field-label" id="dossier-preset-label">Destinataire *</span><input type="hidden" name="preset" value="${e(preset.id)}"><div class="chip-choices" role="group" aria-labelledby="dossier-preset-label">${DOSSIER_PRESETS.map(p=>`<button type="button" class="choice-chip${p.id===preset.id?' is-on':''}" data-dossier="preset" data-value="${e(p.id)}" aria-pressed="${p.id===preset.id}">${e(p.label)}</button>`).join('')}</div><p class="cost-detail" data-dossier-lead aria-live="polite">${e(preset.lead)}</p></div>
<label class="span-2">Campagne *<select name="campaign">${campaigns.map(c=>`<option value="${e(c)}"${c===campaignChoice?' selected':''}>${e(c)}${c===campaignFor()?' (en cours)':''}</option>`).join('')}</select></label>
<fieldset class="span-2 dossier-sections"><legend>Contenu *</legend><div data-dossier-sections>${sectionBoxes(preset)}</div></fieldset>
<label class="span-2">Signataire<input name="signer" autocomplete="name" placeholder="Ex. Prénom Nom, gérant" maxlength="80"></label>
<p class="span-2 cost-detail">Le dossier s’ouvre prêt à imprimer (A4), avec un bouton pour obtenir un vrai fichier PDF à partager, imprimer ou enregistrer, y compris sur iPhone. Il est généré sur cet appareil, même hors connexion. Montants indicatifs, calculés à partir des données saisies.</p>
<p class="span-2 form-error hidden" role="alert"></p></form>`;
    modal('Dossier de campagne','Un document soigné pour la banque, le centre de gestion ou la coopérative',body,`<button type="button" class="button secondary" data-action="close-modal">Annuler</button><button type="button" class="button primary dossier-generate" data-dossier="generate">Générer le dossier</button>`,'small');
  }

  function choosePreset(control){
    const form=control.closest('form'),p=presetById(control.dataset.value);form.querySelector('[name="preset"]').value=p.id;
    form.querySelectorAll('[data-dossier="preset"]').forEach(c=>{const on=c===control;c.classList.toggle('is-on',on);c.setAttribute('aria-pressed',String(on));});
    form.querySelector('[data-dossier-lead]').textContent=p.lead;form.querySelector('[data-dossier-sections]').innerHTML=sectionBoxes(p);form.querySelector('.form-error')?.classList.add('hidden');
  }

  function generate(){
    const form=document.getElementById('dossier-form');if(!form)return;const err=form.querySelector('.form-error');
    const preset=form.preset.value,campaign=form.campaign.value,sections=[...form.querySelectorAll('[name="section"]:checked')].map(i=>i.value);
    const fail=message=>{err.textContent=message;err.classList.remove('hidden');};
    if(!preset)return fail('Champ obligatoire : Destinataire');
    if(!campaign)return fail('Champ obligatoire : Campagne');
    if(!sections.length)return fail('Champ obligatoire : Contenu (au moins une partie)');
    campaignChoice=campaign;writePref(preset);
    const p=presetById(preset),html=dossierHtml(state(),{campaign,preset,sections,assetBase:assetBase(),signer:form.signer.value}),title=`Dossier de campagne ${campaign} · ${p.label}`;
    closeModal();const how=openPrintable(html,title);
    toast(how==='window'?`Dossier ${p.label} ${campaign} ouvert dans un nouvel onglet.`:`Dossier ${p.label} ${campaign} prêt : imprimez-le ou obtenez le PDF.`,'success');
  }

  document.addEventListener('click',event=>{
    const control=event.target.closest('[data-dossier]');if(!control)return;const kind=control.dataset.dossier;
    if(kind==='preset'){event.preventDefault();choosePreset(control);}
    else if(kind==='generate'){event.preventDefault();try{generate();}catch(error){toast(error.message||'Impossible de générer le dossier.','error');}}
    else if(kind==='viewer-close'){event.preventDefault();closeViewer();}
    else if(kind==='viewer-pdf'){event.preventDefault();deliverViewerPdf(toast);}
    else if(kind==='viewer-print'){event.preventDefault();const f=document.querySelector('.dz-viewer-frame');try{f?.contentWindow?.focus();f?.contentWindow?.print();}catch{toast('Impression indisponible dans ce navigateur.','error');}}
  });
  document.addEventListener('change',event=>{if(event.target.closest?.('#dossier-form'))document.querySelector('#dossier-form .form-error')?.classList.add('hidden');});

  return{open};
}

// Actions du délégué de clics pour l'accueil et la navigation générale : fenêtres, personnalisation, thème, aide,
// démonstration, recherche globale, notifications, assistant et compte (n° 147, sorties d'app.js sans changement
// de comportement). Enregistrées par app.js dans actions.js.
import {ctx} from './app-context.js';
import {openPersonalization} from './personalization-ui.js';
import {toggledTheme} from './theme.js';

const networkDetailsBody = () => `<div class="notice ${navigator.onLine?'info':'warning'}">${navigator.onLine?'Les fonctions réseau sont disponibles.'
  :'Les données locales restent accessibles et modifiables.'}</div>`;

// Ouverture d'une notification selon le type d'entité visé.
function openNotificationEntity(entity, id) {
  if(entity==='tasks')ctx.openTaskForm(ctx.store.get('tasks',id));
  else if(entity==='interventions')ctx.openWorkForm(ctx.store.get('interventions',id));
  else if(entity==='materiels')ctx.openEquipmentDetail(id);
  else if(entity==='regulated')ctx.lazy.run('regulatedOps',()=>ctx.regulatedOps().open());
  else if(entity==='stockItems')ctx.openStock();
  else if(entity==='grazingSessions')ctx.openGrazingForm(ctx.store.get('grazingSessions',id));
  else if(entity==='observations')ctx.openObservations();
  else if(entity==='weather')ctx.openWeather();
  else if(entity==='sync')ctx.openSync();
  else if(entity==='parcelComments')ctx.lazy.run('parcelComments',()=>ctx.parcelCommentsUI?.openInbox());
}

// Ouverture d'un résultat de la recherche globale selon son type.
async function openSearchResult(type, id) {
  if(type==='template'){
    const t=ctx.store.get('templates',id);
    if(t)ctx.openWorkForm({type:t.type,culture:t.culture,product:t.product,dose:t.dose,doseUnit:t.doseUnit,equipmentId:t.equipmentId,
      operator:t.operator,status:'À faire',date:ctx.todayIso()});
  }
  else if(type==='parcel')ctx.openParcel(id);
  else if(type==='work')ctx.openWorkForm(ctx.store.get('interventions',id));
  else if(type==='task')ctx.openTaskForm(ctx.store.get('tasks',id));
  else if(type==='equipment'){ctx.openEquipmentDetail(id);}
  else if(type==='client'){ctx.openClientDetail(id);}
  else if(type==='point'){
    const pt=ctx.store.get('points',id);
    if(pt){ctx.switchView('map');ctx.parcelMap.map?.setView([Number(pt.latitude),Number(pt.longitude)],18);}
  }
  else if(type==='observation'){ctx.openObservationForm(ctx.store.get('observations',id));}
  else if(type==='stock'){ctx.openStockForm(ctx.store.get('stockItems',id));}
  else if(type==='document'){await ctx.viewAttachment('documents',id);}
  else if(type==='chantier'){ctx.openChantierDetail(id);}
}

export const todayActions = {
  'close-modal'() { ctx.closeModal(); },
  'personalize'() {
    openPersonalization({preferences:ctx.state().preferences,modal: ctx.modal,closeModal: ctx.closeModal,toast: ctx.toast,
      save:async preferences=>{await ctx.store.setPreferences(preferences);ctx.renderAll();}});
  },
  async 'hide-assistant'() {
    await ctx.store.setPreferences({assistantDock:false});
    ctx.toast('Assistant masqué. Réactivez-le dans Personnaliser.','success',{label:'Annuler',run:()=>ctx.store.setPreferences({assistantDock:true})});
  },
  'today-summary-open'({control}) {
    const target=control.dataset.target;
    if(target==='grazing'){
      ctx.parcelFilter='grazing';ctx.switchView('parcels');
      ctx.$$('[data-parcel-filter]').forEach(b=>b.classList.toggle('is-active',b.dataset.parcelFilter==='grazing'));ctx.renderParcels(ctx.state());
    }else{ctx.workTab=target==='overdue'?'overdue':'today';ctx.switchView('work');ctx.renderWork(ctx.state());}
  },
  'palette-map'() { ctx.closeModal(); ctx.switchView('map'); },
  'global-search'() { ctx.openGlobalSearch(); },
  async 'getting-started-hide'() { await ctx.gettingStartedUI?.hide(); },
  async 'toggle-theme'() {
    ctx.closeModal();
    const previous=ctx.state().preferences.theme||'system',next=toggledTheme(previous,ctx.themeUI?.systemDark());
    await ctx.store.setPreferences({theme:next});
    ctx.applyTheme();
    ctx.toast(next==='dark'?'Thème sombre.':'Thème clair.','success',
      {label:'Annuler',run:async()=>{await ctx.store.setPreferences({theme:previous});ctx.applyTheme();}});
  },
  'help-topic'({control}) { ctx.help().openTopic(control.dataset.helpKey||''); },
  async 'open-whats-new'() { await ctx.whatsNewUI?.open(); },
  async 'open-demo'() { await ctx.enterDemo(); },
  async 'exit-demo'() { await ctx.exitDemo(); },
  async 'open-install'() { await ctx.installUI?.open(); },
  // Feuille d'état de la synchronisation si elle est chargée, sinon simple fenêtre d'état.
  'network-details'() {
    if (ctx.syncStatusUI) { ctx.syncStatusUI.openSheet({autoRetry:true}); }
    else { ctx.modal('État de l’application',navigator.onLine?'Connexion disponible':'Hors connexion',networkDetailsBody(),
      `<button class="button primary" data-action="close-modal">Fermer</button>`,'small'); }
  },
  'sync-sheet'() { if (ctx.syncStatusUI) { ctx.syncStatusUI.openSheet(); } },
  'open-assistant'() { ctx.openAssistant(); },
  'assistant-speak'() { ctx.speakLastAssistant(); },
  async 'assistant-remote-action'({id}) { await ctx.runAssistantRemoteAction(id); },
  async 'open-account'() { await ctx.openAccountTeam(); },
  'open-notifications'() { ctx.openNotifications(); },
  'notification-open'({id, control}) {
    const entity=control.dataset.entity;
    ctx.closeModal();
    openNotificationEntity(entity, id);
  },
  'open-privacy'() { ctx.openPrivacy(); },
  'voice-assistant'() { ctx.startVoiceAssistant(); },
  'open-settings'() { ctx.settingsUI.open(); },
  'open-help'() { ctx.openHelp(); },
  'search-hint'({control}) {
    const input=ctx.$('#global-search-input');
    if(input){input.value=control.dataset.query||'';ctx.renderGlobalSearch(input.value);input.focus();}
  },
  async 'global-open'({id, control}) {
    const type=control.dataset.resultType;
    ctx.closeModal();
    await openSearchResult(type, id);
  },
};

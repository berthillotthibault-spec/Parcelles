// Actions du délégué de clics pour les outils de « Plus » : liste des modules, réglementaire (PAC, azote, phyto,
// conformité), économie, foncier, intégrations, automatisations et tests natifs (n° 147, sorties d'app.js sans
// changement de comportement). Enregistrées par app.js dans actions.js.
import {ctx} from './app-context.js';
import {automationRuleLabel, automationTemplates, newAutomationFromTemplate} from './automations.js';
import {BUILD_ID, campaignFor, escapeHtml} from './utils.js';

// Liste des modules de « Plus » : tous les outils, ou seulement ceux de l'activité.
function moreModules({action}) { ctx.activities().setShowAll(action==='more-show-all-tools'); ctx.renderMoreModules(); }

// Essai d'une automatisation sans rien exécuter : liste des correspondances actuelles.
async function testAutomation(id) {
  const check=await ctx.runAutomationCycle({manual:true,force:true,ruleId:id,dryRun:true});
  const matches=check.results[0]?.matches||[];
  const rows=matches.slice(0,30).map(m=>`<div class="list-row"><div><strong>${escapeHtml(m.label||m.message)}</strong>`
    +`<small>${escapeHtml(m.entity)} · ${escapeHtml(m.entityId||'')}</small></div></div>`).join('');
  ctx.modal('Test de l’automatisation',`${matches.length} ${(matches.length)>1?'correspondances':'correspondance'}, aucune action exécutée.`,
    matches.length?`<div class="stack-list">${rows}</div>`:'<div class="empty-state">Aucune correspondance actuellement.</div>',
    `<button class="button primary" data-action="open-automations">Retour</button>`,'large');
}

export const modulesActions = {
  'more-show-all-tools': moreModules,
  'more-modules-filter': moreModules,
  // n° 160 : la pastille de profil ouvre le menu profil, qui remplace l'onglet « Plus ».
  'open-profile-menu'() { ctx.openProfileMenu(); },
  // Retour de la liste d'une catégorie (lien #more/<catégorie>) : accueil, puis menu profil.
  'more-category-back'() { ctx.switchView('today'); ctx.openProfileMenu(); },
  'open-more-category'({control}) { ctx.renderMoreCategory(control.dataset.category||'production'); ctx.switchView('more-category'); },
  'open-advanced-tools'() { ctx.openAdvancedTools(); },
  'open-compliance'() { ctx.closeModal(); ctx.complianceUI?.open(); },
  'open-nitrogen'() { ctx.closeModal(); ctx.nitrogenUI?.open(); },
  'open-pac'() { ctx.closeModal(); ctx.pacUI?.open(); },
  'open-telepac-import'() { ctx.closeModal(); ctx.telepac().open(); },
  'open-parcel-check'() { ctx.closeModal(); ctx.parcelCheck().open(); },
  'open-regulatory-rules'() { ctx.closeModal(); ctx.regulatory().openRules(); },
  'open-regulated-ops'() { ctx.closeModal(); ctx.regulatedOps().open(); },
  'open-green-indicators'() { ctx.closeModal(); ctx.greenIndicators().open(); },
  'open-covers'() { ctx.closeModal(); ctx.coversUI?.open(); },
  'open-land'() { ctx.closeModal(); ctx.landUI?.open(); },
  'open-claims'() { ctx.claimsUI?.open(); },
  'open-fuel'() { ctx.fuelUI?.open(); },
  'open-campaign-history'({control}) { ctx.campaignHistoryUI?.open({campaign:control.dataset.campaign||campaignFor()}); },
  'open-accounting-export'() { ctx.accountingExportUI?.open(); },
  'open-treasury'() { ctx.treasuryUI?.open(); },
  'open-net-margin'({control}) { ctx.netMarginUI?.open({campaign:control.dataset.campaign||campaignFor()}); },
  'open-machine-costs'({control}) { ctx.machineCostsUI?.open({campaign:control.dataset.campaign||campaignFor()}); },
  'open-forage'() { ctx.forageUI?.open(); },
  'open-seeds'() { ctx.seedsUI?.open(); },
  'open-soil-analyses'() { ctx.soilAnalysisUI?.open(); },
  'open-hedges'() { ctx.hedgesUI?.open(); },
  'open-crop-margins'({control}) { ctx.cropMarginsUI?.open({campaign:control.dataset.campaign||campaignFor()}); },
  'open-simulator'({control}) { ctx.simulatorUI?.open({campaign:control.dataset.campaign||campaignFor(),culture:control.dataset.culture||''}); },
  'open-phyto-register'() { ctx.closeModal(); ctx.phytoUI?.openRegister(); },
  'open-phyto-catalog'() { ctx.closeModal(); ctx.phytoCatalogUI?.open(); },
  'ift-open'({id}) { ctx.iftUI?.open(id); },
  'rpg-onboarding'() { ctx.rpgOnboardingUI?.open({commune:ctx.state().exploitation.commune||''}); },
  async 'open-team-roles'() { await ctx.teamRolesUI?.open(); },
  'open-integrations'() { ctx.techCentersUI.openIntegrations(); },
  'open-integration-track'({id}) { ctx.techCentersUI.openIntegrationTrack(id); },
  async 'suggest-work-from-track'({id}) { await ctx.suggestWorkFromTrack(id); },
  'show-integration-track'({id}) { ctx.showIntegrationTrack(id); },
  'open-automations'() { ctx.automationsUI.open(); },
  'new-automation'() { ctx.automationsUI.openRuleForm(); },
  'edit-automation'({id}) { const r=ctx.store.get('automationRules',id); if(r)ctx.automationsUI.openRuleForm(r); },
  async 'test-automation'({id}) {
    const r=ctx.store.get('automationRules',id);
    if(r)await testAutomation(id);
  },
  async 'run-automations'() { await ctx.runAutomationCycle({manual:true,force:true}); },
  async 'add-automation-template'({control}) {
    const t=automationTemplates()[Number(control.dataset.template)];
    if(t){await ctx.store.upsert('automationRules',newAutomationFromTemplate(t),{label:`Automatisation ajoutée : ${t.name}`});ctx.automationsUI.open();}
  },
  async 'toggle-automation'({id}) {
    const r=ctx.store.get('automationRules',id);
    if(r){
      await ctx.store.upsert('automationRules',{...r,enabled:!r.enabled},
        {label:`Automatisation ${r.enabled?'mise en pause':'activée'} : ${automationRuleLabel(r)}`});
      ctx.automationsUI.open();
    }
  },
  async 'delete-automation'({id}) { await ctx.store.remove('automationRules',id); ctx.automationsUI.open(); },
  async 'toggle-automation-engine'() {
    await ctx.store.setPreferences({automationEnabled:ctx.state().preferences.automationEnabled===false});
    ctx.automationsUI.open();
  },
  async 'open-native'() { await ctx.techCentersUI.openNative(); },
  async 'native-test-haptic'() {
    const ok=await ctx.nativeBridge?.haptic('medium');
    ctx.toast(ok?'Retour haptique envoyé.':'Retour haptique natif indisponible.',ok?'success':'error');
  },
  async 'native-test-biometric'() {
    const r=await ctx.nativeBridge?.authenticate('Tester la biométrie');
    const message=r?.success?'Authentification réussie.':r?.available===false?'Biométrie native non configurée.'
      :`Authentification refusée : ${r?.reason||'inconnue'}`;
    ctx.toast(message,r?.success?'success':'error');
  },
  async 'native-test-notification'() {
    const perm=await ctx.nativeBridge?.requestNotificationPermission();
    await ctx.nativeBridge?.scheduleNotification({id:'test-native',title:'Parcelles 8.0',body:'Notifications iPhone opérationnelles.',extra:{route:'today'}});
    ctx.toast(`Notification test demandée · ${perm?.display||'état inconnu'}.`);
  },
  async 'native-test-camera'() {
    const r=await ctx.nativeBridge?.capturePhoto();
    ctx.toast(r?.photo?'Caméra native opérationnelle.':r?.cancelled?'Capture annulée.':'Caméra native indisponible.',r?.photo?'success':'error');
  },
  async 'native-test-share'() {
    try{
      const ok=await ctx.nativeBridge?.share({title:'Parcelles 8.0',text:`Parcelles 8.0 · build ${BUILD_ID}`});
      ctx.toast(ok?'Partage ou copie effectué.':'Partage indisponible.',ok?'success':'error');
    }catch(error){if(error?.name!=='AbortError')ctx.toast('Partage refusé par le navigateur.','error');}
  },
};

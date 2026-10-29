// Actions du délégué de clics pour le terrain : mode terrain, traces, tournée, journal vocal, étiquettes QR, agenda
// (ICS), chantiers et travaux publics, pâturage, observations et météo (n° 147, sorties d'app.js sans changement
// de comportement). Enregistrées par app.js dans actions.js.
import {ctx} from './app-context.js';
import {endGrazingSession} from './grazing-records.js';
import {grazingDate} from './grazing.js';

// Trace du suivi de terrain : voir sur la carte (quitte le mode terrain) ou exporter en GPX.
function fieldTrack({action, control}) { if(action==='field-track-map')ctx.closeFieldMode(); ctx.fieldCoverage().action(action,control); }

export const fieldActions = {
  'field-track-map': fieldTrack,
  'field-track-gpx': fieldTrack,
  'voice-journal'() { ctx.closeFieldMode(); ctx.openVoiceJournal(); },
  // n° 160 : ouvertes aussi depuis le menu profil (une modale) : la fermer, sinon la vue reste sous le dialogue.
  'open-field-mode'() { ctx.closeModal(); ctx.openFieldMode(); },
  'open-day-route'() { ctx.closeModal(); ctx.openDayRoute(); },
  async 'equipment-qr'({id}) { (await ctx.getEquipmentQrUI()).openLabel('equipment',id); },
  async 'point-qr'({id}) { (await ctx.getEquipmentQrUI()).openLabel('point',id); },
  async 'print-qr-labels'() { (await ctx.getEquipmentQrUI()).openPicker(); },
  'ics-work'({id}) { ctx.getIcsUI().addToAgenda('work',id); },
  'ics-task'({id}) { ctx.getIcsUI().addToAgenda('task',id); },
  'open-ics-agenda'() { ctx.getIcsUI().openAgenda(); },
  'ics-export-30'() { ctx.getIcsUI().exportUpcoming(); },
  'ics-enable-reminders'() { ctx.getIcsUI().enableReminders(); },
  'open-public-works'() { ctx.getPublicWorksUI().openList(); },
  'open-chantiers'() { ctx.openChantiers(); },
  'new-chantier'() { ctx.closeModal(); ctx.openChantierForm(); },
  'open-chantier'({id}) { ctx.openChantierDetail(id); },
  'edit-chantier'({id}) { ctx.closeModal(); ctx.openChantierForm(ctx.store.get('chantiers',id)); },
  async 'start-chantier'({id}) { await ctx.startChantier(id); },
  'start-chantier-parcel'({id, control}) { ctx.closeModal(); ctx.openFieldSessionStart(id,{chantierId:control.dataset.chantierId}); },
  'open-grazing'() { ctx.openGrazing(); },
  'open-grazing-parcel'({id}) { ctx.openGrazing({parcelId:id}); },
  'new-grazing'() { ctx.closeModal(); ctx.openGrazingForm(); },
  'edit-grazing'({id}) { const g=ctx.store.get('grazingSessions',id); if(g){ctx.closeModal();ctx.openGrazingForm(g);} },
  'move-grazing'({id}) { const g=ctx.store.get('grazingSessions',id); if(g){ctx.closeModal();ctx.getGrazingUI().openMove(g);} },
  async 'end-grazing'({id}) {
    const g=ctx.store.get('grazingSessions',id);
    await endGrazingSession(ctx.store,id,{date:grazingDate()});
    ctx.toast('Sortie du pré enregistrée.');
    if(ctx.currentView!=='parcel')ctx.openGrazing({parcelId:g?.parcelId||''});
  },
  'open-weather'() { ctx.openWeather(); },
  async 'refresh-weather'() { ctx.closeModal(); await ctx.refreshWeather(); },
  'open-observations'() { ctx.openObservations(); },
  'new-machine-mission'() { ctx.closeModal(); ctx.openMachineMissionForm(); },
  'new-observation'({id, control}) {
    ctx.closeModal();
    const contextualParcel=id||control.dataset.parcelId||(['parcel','map'].includes(ctx.currentView)?ctx.selectedParcelId:null)
      ||(ctx.fieldModeOpen?ctx.currentFieldParcelId():null);
    ctx.openObservationForm(null,{parcelId:contextualParcel||null});
  },
  'edit-observation'({id}) { ctx.closeModal(); ctx.openObservationForm(ctx.store.get('observations',id)); },
};

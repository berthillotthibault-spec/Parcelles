// Actions du délégué de clics pour les données : documents et pièces jointes, rapports imprimables, exports,
// statistiques, qualité, corbeille, sauvegardes, imports, journal, synchronisation, plateforme et diagnostic
// (n° 147, sorties d'app.js sans changement de comportement). Enregistrées par app.js dans actions.js.
import {ctx} from './app-context.js';
import {documentsReportHtml, farmReportHtml, openPrintableReport, parcelReportHtml, pilotageReportHtml, stockReportHtml,
  traceabilityReportHtml} from './reports.js';
import {documentInventoryCsv, traceabilityCsv} from './traceability.js';
import {campaignFor, download} from './utils.js';

export const dataActions = {
  async 'view-attachment'({id, control}) { await ctx.viewAttachment(control.dataset.type,id); },
  'open-dossier'({control}) { ctx.dossierUI.open(control.dataset.campaign||null); },
  'print-farm-report'() { openPrintableReport(farmReportHtml(ctx.state())); },
  'print-pilotage-report'({control}) { openPrintableReport(pilotageReportHtml(ctx.state(),control.dataset.campaign||campaignFor())); },
  'print-stock-report'() { openPrintableReport(stockReportHtml(ctx.state())); },
  'print-traceability-report'({control}) { openPrintableReport(traceabilityReportHtml(ctx.state(),control.dataset.campaign||campaignFor())); },
  'print-document-report'() { openPrintableReport(documentsReportHtml(ctx.state())); },
  'print-parcel-report'({id}) { openPrintableReport(parcelReportHtml(ctx.state(),id)); },
  'open-documents'() { ctx.openDocumentCenter(); },
  'new-document'() { ctx.closeModal(); ctx.openAttachmentForm(null); },
  'edit-document-meta'({id}) { ctx.closeModal(); ctx.openDocumentMetadataForm(id); },
  'open-traceability'() { ctx.openTraceability(); },
  'export-traceability-csv'() {
    download(`parcelles-tracabilite-${campaignFor().replace('/','-')}.csv`,traceabilityCsv(ctx.state()),'text/csv;charset=utf-8');
    ctx.toast('Registre de traçabilité exporté.');
  },
  'export-document-csv'() {
    download(`parcelles-documents-${ctx.todayIso()}.csv`,documentInventoryCsv(ctx.state()),'text/csv;charset=utf-8');
    ctx.toast('Inventaire documentaire exporté.');
  },
  'open-reports'() { ctx.openReports(); },
  'open-statistics'() { ctx.openStatistics(); },
  'pilotage-campaign'({control}) { ctx.openStatistics(control.dataset.campaign||campaignFor()); },
  async 'open-data-center'() { await ctx.openDataCenter(); },
  'repair-text'() { ctx.techCentersUI.openTextRepair(); },
  'open-quality'() { ctx.openQuality(); },
  'quality-open'({control}) { ctx.openQualityIssue(control.dataset.code); },
  'open-trash'() { ctx.openTrash(); },
  async 'open-storage-care'() { await ctx.storageCare().open(); },
  async 'restore-trash'({id, control}) { await ctx.trash().restore(control.dataset.type,id); },
  async 'purge-trash'({id, control}) { await ctx.trash().purge(control.dataset.type,id); },
  async 'empty-trash'() { await ctx.emptyTrash(); },
  async 'open-auto-backups'() { await ctx.openAutoBackups(); },
  'open-import-history'() { ctx.openImportHistory(); },
  async 'rollback-import'({id}) { await ctx.rollbackImport(id); },
  async 'restore-auto-backup'({id}) { await ctx.restoreAutoBackup(id); },
  async 'verify-auto-backup'({id}) {
    const result=await ctx.store.storage.backupVerify(id);
    ctx.toast(result.ok?'Sauvegarde vérifiée.':'Sauvegarde invalide. ',result.ok?'success':'error');
    await ctx.openAutoBackups();
  },
  async 'export-auto-backup'({id}) { await ctx.exportAutoBackup(id); },
  async 'delete-auto-backup'({id}) { await ctx.store.storage.backupDelete(id); await ctx.openAutoBackups(); },
  'open-log'() { ctx.openLog(); },
  'open-app-lock'() { ctx.appLockUI.openSettings().catch(error=>ctx.toast(error?.message||'Verrouillage indisponible.','error')); },
  async 'open-sync'() { await ctx.openSync(); },
  async 'open-platform'() { await ctx.techCentersUI.openPlatform(); },
  async 'platform-run-job'({id}) {
    try{await ctx.platform.submitJob(id);ctx.toast('Tâche envoyée au backend.');ctx.techCentersUI.openPlatform();}
    catch(error){ctx.toast(error.message,'error');}
  },
  async 'open-security'() { await ctx.techCentersUI.openSecurity(); },
  'open-sync-conflict'({id}) { ctx.openSyncConflict(id); },
  async 'resolve-sync-conflict'({id, control}) { await ctx.resolveSyncConflict(id,control.dataset.choice); },
  async 'open-diagnostic'() { await ctx.openDiagnostic(); },
  'choose-import'() { ctx.$('#import-file-input').click(); },
  'choose-restore'() { ctx.$('#restore-file-input').click(); },
  async 'export-complete-backup'() { await ctx.exportCompleteBackup(); },
  async 'export-json-backup'() { await ctx.exportJsonBackup(); },
  'export-encrypted-backup'() { ctx.openEncryptedBackup(); },
  async 'backup-now'() { await ctx.exportCompleteBackup(); },
  async 'backup-reminder-later'() { await ctx.store.snoozeExternalBackupReminder(); ctx.toast('Rappel masqué pendant 7 jours.'); },
  async 'choose-backup-folder'() { await ctx.chooseBackupFolder(); },
  async 'forget-backup-folder'() { await ctx.forgetBackupFolder(); },
  async 'open-backup-vault'() { await ctx.backupVaultUI?.open(); },
  'open-history-import'() { ctx.historyImportUI?.openGuide(); },
  'export-work-csv'() {
    download(`parcelles-travaux-${ctx.todayIso()}.csv`,ctx.impex().exportCsv(ctx.state()),'text/csv;charset=utf-8');
    ctx.toast('CSV des travaux téléchargé.');
  },
  'export-parcels-csv'() {
    download(`parcelles-liste-${ctx.todayIso()}.csv`,ctx.impex().exportParcelsCsv(ctx.state()),'text/csv;charset=utf-8');
    ctx.toast('CSV des parcelles téléchargé.');
  },
  'export-geojson'() {
    download(`parcelles-${ctx.todayIso()}.geojson`,ctx.impex().exportGeoJson(ctx.state()),'application/geo+json;charset=utf-8');
    ctx.toast('GeoJSON téléchargé.');
  },
};

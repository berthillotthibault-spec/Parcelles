// Actions du délégué de clics pour la carte : modes (sélection multiple, tracé, mesure, points), recherche et fiche
// de la carte, contours, découpe, aimantation, légende, couches, position et carte hors connexion (n° 147, sorties
// d'app.js sans changement de comportement). Enregistrées par app.js dans actions.js.
import {ctx} from './app-context.js';
import {escapeHtml, formatNumber} from './utils.js';

export const mapActions = {
  'map-mode-keep'() { ctx.keepMapMode(); },
  'map-mode-discard'() { ctx.discardMapMode(); },
  'map-multiple'() {
    if(ctx.parcelMap.multiple){ctx.mapModes.exit({name:'multiple'});if(ctx.parcelMap.multiple)ctx.parcelMap.toggleMultiple(false);}
    else ctx.startMultipleSelection();
  },
  'map-multiple-cancel'() { ctx.mapModes.exit({name:'multiple'}); if(ctx.parcelMap.multiple)ctx.parcelMap.toggleMultiple(false); },
  'map-multiple-info'() {
    const rows=[...ctx.parcelMap.selectedIds].map(id=>{const p=ctx.parcelById(id);
      return p?`<button class="list-row" data-action="open-parcel" data-id="${escapeHtml(id)}">`
        +`${escapeHtml(p.nom)} · ${formatNumber(p.surfaceHa)} ha</button>`:'';});
    ctx.modal('Parcelles sélectionnées','', rows.join(''),'<button class="button secondary" data-action="close-modal">Fermer</button>');
  },
  'show-point'({id}) { const point=ctx.store.get('points',id); if(point){ctx.closeModal();ctx.switchView('map');ctx.parcelMap.focusPoint(id);} },
  'add-rpg-parcel'({id}) { ctx.openRpgParcelForm(id); },
  'add-cadastre-parcel'({id}) { ctx.openCadastreParcelForm(id); },
  'edit-map-point'({id}) { ctx.openMapPointEditor(id); },
  'move-map-point'({id}) { ctx.startMapPointPlacement({id}); },
  'delete-map-point'({id}) {
    const point=ctx.store.get('points',id);
    if(point){ctx.parcelMap.cancelPointPlacement();ctx.parcelMap.map?.closePopup();
      ctx.confirmDelete('points',id,point.nom||point.name||point.type||'ce point');}
  },
  'cancel-map-point'() { ctx.mapModes.exit({name:'point'}); ctx.parcelMap.cancelPointPlacement(); ctx.$('#map-point-panel').classList.add('hidden'); },
  'edit-contour'({id}) { ctx.closeModal(); ctx.contourEditUI().start(id); },
  async 'map-snap-toggle'() { await ctx.snapUI().toggle(); },
  'draw-follow-boundary'() { ctx.snapUI().follow(); },
  'walk-measure'() { ctx.closeModal(); ctx.walkMeasureUI().start(); },
  'split-parcel'({id}) { ctx.closeModal(); ctx.parcelSplitUI().startSplit(id); },
  'map-multiple-merge'() { ctx.parcelSplitUI().openMerge([...ctx.parcelMap.selectedIds]); },
  'map-search-open'({id}) {
    ctx.selectedParcelId=id;
    ctx.rememberRecent(id);
    if(ctx.parcelMap.map)ctx.parcelMap.select(id);else ctx.renderMapSheet(ctx.state());
    const results=ctx.$('#map-search-results');
    if(results){results.classList.add('hidden');results.innerHTML='';}
    const input=ctx.$('#map-search-input');
    if(input)input.value='';
  },
  'close-map-parcel-sheet'() {
    ctx.selectedParcelId=null;
    ctx.parcelMap.selectedId=null;
    ctx.parcelMap.map?.closePopup();
    ctx.renderMapSheet();
    ctx.parcelMap.render(ctx.mapRenderState(ctx.state()));
  },
  async 'locate'() { await ctx.requestGps(); },
  'fit-parcels'() { ctx.closeModal(); ctx.parcelMap.fitParcels(); },
  'open-map-layers'() { ctx.mapLayersUI.open(); },
  'map-tools'() { ctx.openMapTools(); },
  'measure-distance'() { ctx.startMapMeasurement('distance'); },
  'measure-area'() { ctx.startMapMeasurement('area'); },
  'undo-measure-point'() { ctx.parcelMap.undoMeasurementPoint(); },
  'cancel-measure'() { ctx.mapModes.exit({name:'measure'}); ctx.parcelMap.cancelMeasurement(); ctx.$('#map-measure-panel')?.classList.add('hidden'); },
  'finish-measure'() { try{ctx.parcelMap.finishMeasurement();}catch(error){ctx.toast(error.message,'error');} },
  async 'track-position'() { ctx.closeModal(); await ctx.requestGps(); ctx.parcelMap.toggleTracking({follow:true}); },
  'add-point'() { ctx.openPointCreator(); },
  'toggle-legend'() { ctx.$('#map-legend')?.classList.toggle('is-open'); },
  'finish-parcel-draw'() { try{ctx.parcelMap.finishPolygonDrawing();}catch(error){ctx.toast(error.message,'error');} },
  'cancel-parcel-draw'() {
    ctx.mapModes.leave(()=>{ctx.parcelMap.cancelPolygonDrawing();ctx.$('#map-draw-panel').classList.add('hidden');ctx.drawingParcelId=null;},{reason:'close'});
  },
  'undo-draw-point'() { ctx.parcelMap.undoPolygonPoint(); },
  'clear-legend-filter'() { ctx.legendParcelFilter=null; ctx.renderParcels(ctx.state()); },
  async 'export-parcels-format'({id}) { await ctx.getParcelFormatsUI().run(id); },
  'open-offline-map'() { ctx.offlineMap().open(); },
};

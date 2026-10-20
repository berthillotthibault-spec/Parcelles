// Actions du délégué de clics pour les parcelles : fiche, édition, archivage, favoris, tri et outils
// d'une parcelle (n° 147, sorties d'app.js sans changement de comportement). Enregistrées par app.js.
import {ctx} from './app-context.js';

export const parcelActions = {
  'new-parcel'() { ctx.openParcelForm(); },
  'parcel-filters'() { ctx.openParcelFilters(); },
  'open-parcel'({id, control}) {
    ctx.closeModal(); ctx.closeFieldMode();
    if (ctx.currentView !== 'parcel') ctx.viewTransitions().shareFromRow(control);
    ctx.openParcel(id);
  },
  'edit-parcel'({id}) { ctx.closeModal(); ctx.openParcelForm(ctx.parcelById(id)); },
  'delete-parcel'({id}) { ctx.confirmDelete('parcelles', id, 'cette parcelle'); },
  async 'archive-parcel'({id}) {
    const p = ctx.parcelById(id);
    if (!p) return;
    await ctx.store.upsert('parcelles', {...p, archived: !p.archived}, {label: `Parcelle ${p.archived ? 'réactivée' : 'archivée'} : ${p.nom}`});
    ctx.closeModal();
    ctx.toast(p.archived ? 'Parcelle réactivée.' : 'Parcelle archivée.');
  },
  'parcel-actions'({id}) { ctx.closeModal(); ctx.openParcelActions(id); },
  'parcel-tab'({id, control}) { ctx.closeModal(); ctx.openParcelDetail(id, control.dataset.tab, {historyMode: 'replace'}); },
  async 'toggle-favorite'({id}) {
    const p = ctx.parcelById(id);
    if (!p) return;
    await ctx.store.upsert('parcelles', {...p, favorite: !p.favorite}, {label: `Favori ${!p.favorite ? 'activé' : 'désactivé'} : ${p.nom}`, queue: false});
    ctx.renderParcelDetailPage(id, ctx.currentParcelTab, ctx.state());
  },
  'add-note'({id}) { ctx.closeModal(); ctx.openNote(id); },
  // Tri de la liste : options du sélecteur parcourues en boucle ; la distance demande une position connue.
  'cycle-parcel-sort'() {
    const s = ctx.$('#parcel-sort');
    if (!s) return;
    s.selectedIndex = (s.selectedIndex + 1) % s.options.length;
    s.dispatchEvent(new Event('change', {bubbles: true}));
    s.dispatchEvent(new Event('input', {bubbles: true}));
    ctx.renderParcels(ctx.state());
    if (s.value === 'distance' && !ctx.lastGps) ctx.toast('Position inconnue : parcelles triées par nom. Activez « Me localiser » sur la carte.');
  },
  'filter-culture'({control}) {
    ctx.closeModal(); ctx.switchView('parcels');
    const input = ctx.$('#parcel-search');
    if (input) input.value = control.dataset.culture || '';
    ctx.renderParcels(ctx.state());
  },
  // Carte, itinéraire, tracé et accès
  'parcel-on-map'({id}) { ctx.closeModal(); ctx.switchView('map'); setTimeout(() => ctx.parcelMap.select(id), 250); },
  'route-parcel'({id}) { ctx.routeParcel(id); },
  'draw-parcel'({id}) { ctx.closeModal(); if (id) ctx.startParcelDrawing(id); else ctx.startNewParcelDrawing(); },
  'approach-parcel'({id}) { ctx.closeModal(); ctx.approachUI().openApproach(id); },
  'parcel-entry-here'({id}) { ctx.approachUI().defineEntryHere(id); },
  async 'parcel-weather'({id}) { ctx.closeModal(); await ctx.openParcelWeather(id); },
  async 'share-parcel'({id}) { await ctx.shareParcel(id); }
};

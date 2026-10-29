import test from 'node:test';
import assert from 'node:assert/strict';
import {primaryTabs, sidebarViews, activeNavView, resolveView, isProfileView} from './nav-model.js';

test('barre du bas : Accueil · Carte · + · Parcelles · Troupeau', () => {
  const tabs = primaryTabs();
  assert.deepEqual(tabs.map(t => t.view || t.action), ['today', 'map', 'new-work', 'parcels', 'herd']);
  assert.deepEqual(tabs.map(t => t.label), ['Accueil', 'Carte', 'Saisir un travail', 'Parcelles', 'Troupeau']);
  assert.equal(tabs[2].kind, 'action');
});

test('sans module élevage, le 5e onglet est Travaux', () => {
  const tabs = primaryTabs({livestock: false});
  assert.deepEqual(tabs.map(t => t.view || t.action), ['today', 'map', 'new-work', 'parcels', 'work']);
  assert.equal(tabs[4].label, 'Travaux');
  assert.equal(activeNavView('work', {livestock: false}), 'work');
  assert.equal(resolveView('herd', {livestock: false}), 'work');
  assert.deepEqual(sidebarViews({livestock: false}), ['today', 'map', 'parcels', 'work', 'more']);
});

test('onglet actif : fiche → Parcelles, Planning → Accueil, modules → aucun', () => {
  assert.equal(activeNavView('parcel'), 'parcels');
  assert.equal(activeNavView('work'), 'today');
  assert.equal(activeNavView('herd'), 'herd');
  assert.equal(activeNavView('more'), '');
  assert.equal(activeNavView('more-category'), 'more');
  assert.equal(activeNavView('map'), 'map');
});

test('ordinateur : Planning et Modules ont leur entrée', () => {
  assert.deepEqual(sidebarViews(), ['today', 'map', 'parcels', 'herd', 'work', 'more']);
  assert.equal(activeNavView('work', {desktop: true}), 'work');
  assert.equal(activeNavView('more-category', {desktop: true}), 'more');
  assert.equal(activeNavView('parcel', {desktop: true}), 'parcels');
});

test('routes : vue inconnue → accueil, Plus relève du menu profil', () => {
  assert.equal(resolveView('nimporte'), 'today');
  assert.equal(resolveView('herd'), 'herd');
  assert.equal(isProfileView('more'), true);
  assert.equal(isProfileView('more-category'), true);
  assert.equal(isProfileView('work'), false);
});

test('initiales de la pastille de profil', async () => {
  const {profileInitials} = await import('./nav-model.js');
  assert.equal(profileInitials('GAEC Berthillot'), 'BE');
  assert.equal(profileInitials('Ferme des Prés'), 'FP');
  assert.equal(profileInitials('EARL du Moulin Neuf'), 'MN');
  assert.equal(profileInitials(''), 'P');
  assert.equal(profileInitials('Mon exploitation'), 'ME');
});

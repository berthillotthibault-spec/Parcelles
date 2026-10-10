// n° 119 : liste « Bien démarrer » de l'écran Aujourd'hui (logique pure, vérifiée d'après les données).
import {isModuleActive} from './activity-modules.js';

const alive = list => (Array.isArray(list) ? list : []).filter(item => item && !item.deletedAt);

// Chaque étape ouvre une action existante (data-action) de l'application.
export function gettingStartedSteps(data = {}, {installed = false} = {}) {
  const prefs = data.preferences || {}, meta = data.metadata || {};
  const modules = prefs.activeModules;
  const steps = [
    {id: 'parcels', label: 'Importer vos parcelles', detail: 'Fichier PAC, SHP, Excel ou carte', action: 'choose-import', done: alive(data.parcelles).length > 0},
    {id: 'work', label: 'Saisir un premier travail', detail: 'Semis, traitement, récolte…', action: 'new-work', done: alive(data.interventions).length > 0}
  ];
  if (isModuleActive('livestock', modules))
    steps.push({id: 'grazing', label: 'Mettre un premier lot au pré', detail: 'Animaux, parcelle et date d’entrée', action: 'new-grazing', done: alive(data.grazingSessions).length > 0});
  steps.push({id: 'install', label: 'Installer l’application', detail: 'Une icône sur l’écran d’accueil, même sans réseau', action: 'open-install', done: Boolean(installed)});
  steps.push({id: 'backup', label: 'Faire une sauvegarde externe', detail: 'Une copie hors du téléphone', action: 'backup-now', done: Number(meta.lastExternalBackupAt) > 0});
  if (isModuleActive('team', modules))
    steps.push({id: 'team', label: 'Inviter un collègue', detail: 'Associé, salarié ou conseiller', action: 'open-team-roles', done: alive(data.members).length > 1 || Number(prefs.teamInvitedAt) > 0});
  return steps;
}

export function gettingStartedProgress(steps) {
  const total = steps.length, done = steps.filter(step => step.done).length;
  return {done, total, percent: total ? Math.round(done / total * 100) : 100, complete: done === total};
}

// Masquée à la demande, ou d'elle-même quand toutes les étapes sont faites.
export function shouldShowGettingStarted(data = {}, steps = gettingStartedSteps(data)) {
  if (data.preferences?.gettingStartedHidden === true) return false;
  return !gettingStartedProgress(steps).complete;
}

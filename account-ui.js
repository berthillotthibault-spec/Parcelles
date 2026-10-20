// Écrans « Compte & équipe » et « Synchronisation » (n° 147), sortis d'app.js et chargés en différé
// (lazy-modules.js, clé account) : le cloud est facultatif et ces écrans ne servent pas au premier rendu.
// app.js garde openAccountTeam et openSync, qui attendent ce module (lazy.run). ctx : app-context.js.
import {escapeHtml, localDateTime} from './utils.js';
import {icon} from './ui.js';
import {roleLabel} from './permissions.js';
import {queueStats} from './security.js';
import {withProgress} from './motion.js';
import {validateForm} from './form-chips-ui.js';

const plural = (n, one, many) => (n > 1 ? many : one);

export function createAccountUI(ctx) {
  const {$, $$} = ctx;
  // Après chaque étape (connexion, choix de l'espace…), l'écran est redessiné pour montrer la suivante.
  const refresh = () => { ctx.closeModal(); ctx.renderNetwork(); openAccountTeam(); };
  const attempt = run => async () => { try { await run(); refresh(); } catch (error) { ctx.toast(error.message, 'error'); } };
  const signOut = async () => { await ctx.sync.signOut(); refresh(); };

  function localOnly() {
    ctx.modal('Compte & équipe', 'Le cloud est facultatif : Parcelles fonctionne entièrement en local sans compte.',
      '<div class="notice info">Activez la synchronisation uniquement si vous souhaitez retrouver les mêmes données sur plusieurs appareils '
      + 'ou travailler en équipe.</div><p class="form-note">Une configuration Firebase sécurisée est nécessaire. '
      + 'Aucune donnée n’est envoyée tant que cette option reste désactivée.</p>',
      '<button class="button secondary" data-action="close-modal">Fermer</button><button class="button primary" id="enable-cloud">Activer le cloud</button>',
      'small');
    $('#enable-cloud').onclick = async () => {
      await ctx.store.setPreferences({syncEnabled: true}); await ctx.sync.init();
      ctx.closeModal(); openAccountTeam();
    };
  }

  function notConfigured(sync) {
    ctx.modal('Compte & équipe', 'Configuration cloud requise.',
      `<div class="notice warning">${escapeHtml(sync.status.message)}</div>`
      + '<p>Renseignez <code>PARCELLES_FIREBASE_CONFIG</code> dans <strong>config.js</strong>, puis rechargez l’application. '
      + 'Les règles fournies dans le projet doivent être déployées avant toute utilisation réelle.</p>',
      '<button class="button secondary" data-action="open-settings">Réglages</button><button class="button primary" data-action="close-modal">Fermer</button>',
      'small');
  }

  function signIn(sync) {
    ctx.modal('Se connecter', 'Un compte permet la synchronisation multi-appareils.',
      '<form id="cloud-auth-form" class="form-grid"><label class="span-2">Email<input name="email" type="email" autocomplete="email" required></label>'
      + '<label class="span-2">Mot de passe<input name="password" type="password" autocomplete="current-password" minlength="8" required></label></form>'
      + '<div class="notice info">Le premier compte d’une exploitation peut ensuite créer son espace cloud et inviter des collaborateurs.</div>',
      '<button class="button secondary" id="cloud-signup">Créer un compte</button><button class="button primary" id="cloud-login">Se connecter</button>',
      'small');
    const auth = async mode => {
      const f = $('#cloud-auth-form');
      if (!validateForm(f)) return;
      const v = Object.fromEntries(new FormData(f));
      await attempt(() => (mode === 'signup' ? sync.signUp(v.email, v.password) : sync.signIn(v.email, v.password)))();
    };
    $('#cloud-login').onclick = () => auth('login');
    $('#cloud-signup').onclick = () => auth('signup');
  }

  function chooseWorkspace(sync, workspaces) {
    const token = ctx.pendingInviteToken;
    const list = workspaces.length ? workspaces.map(w => `<button class="menu-row" data-workspace-id="${w.id}"><span>☁</span><span>`
      + `<strong>${escapeHtml(w.name || 'Exploitation')}</strong><small>${escapeHtml(roleLabel(w.role || 'viewer'))}</small></span><b>›</b></button>`).join('')
      : '<div class="empty-state">Aucune exploitation cloud liée à ce compte.</div>';
    const body = [`<div class="stack-list">${list}</div><hr>`,
      '<form id="create-workspace-form" class="form-grid">',
      `<label class="span-2">Nouvelle exploitation<input name="name" value="${escapeHtml(ctx.state().exploitation.nom || 'Mon exploitation')}"></label></form>`,
      '<button class="button secondary" id="create-workspace">Créer l’espace</button><hr><form id="join-workspace-form" class="form-grid">',
      token ? '<div class="notice info span-2">Invitation reçue : vérifiez que vous êtes connecté avec l’adresse invitée, '
        + 'puis rejoignez l’exploitation.</div>' : '',
      `<label class="span-2">Code d’invitation<input name="token" autocomplete="off" placeholder="Code reçu" value="${escapeHtml(token)}"></label></form>`,
      '<button class="button secondary" id="join-workspace">Rejoindre</button>'].join('');
    ctx.modal('Choisir une exploitation cloud', `Connecté : ${sync.user.email || sync.user.uid}`, body,
      '<button class="button secondary" id="cloud-signout">Se déconnecter</button><button class="button primary" data-action="close-modal">Fermer</button>',
      'large');
    $$('[data-workspace-id]').forEach(b => b.onclick = async () => { await sync.selectWorkspace(b.dataset.workspaceId); refresh(); });
    $('#create-workspace').onclick = attempt(() => sync.createWorkspace(new FormData($('#create-workspace-form')).get('name')));
    $('#join-workspace').onclick = attempt(async () => {
      await sync.acceptInvite(new FormData($('#join-workspace-form')).get('token'));
      ctx.pendingInviteToken = '';
    });
    $('#cloud-signout').onclick = signOut;
  }

  async function team(sync) {
    const [members, devices, activity] = await Promise.all([sync.listMembers().catch(() => []), sync.listDevices().catch(() => []),
      sync.listActivity(12).catch(() => [])]);
    const data = ctx.state(), pending = data.queue.filter(x => x.status === 'pending').length;
    const stat = (value, label) => `<div class="preview-stat"><strong>${value}</strong><small>${label}</small></div>`;
    const deviceRows = devices.length ? devices.map(d => `<div class="list-row"><div><strong>${escapeHtml(d.name || 'Appareil')}</strong>`
      + `<small>${escapeHtml(d.email || '')} · ${d.lastSeen ? localDateTime(d.lastSeen) : '—'}</small></div>`
      + `${d.id === sync.deviceId ? '<span class="status-badge">Cet appareil</span>' : ''}</div>`).join('')
      : '<div class="empty-state">Aucun appareil enregistré.</div>';
    const activityRows = activity.map(a => `<div class="list-row"><div><strong>${escapeHtml(a.action || 'Action')}</strong>`
      + `<small>${escapeHtml(a.email || '')} · ${a.createdAt ? localDateTime(a.createdAt) : '—'}</small></div></div>`).join('');
    const body = [`<div class="preview-summary">${stat(members.length, 'membres')}${stat(devices.length, 'appareils')}${stat(pending, 'à synchroniser')}</div>`,
      `<h3>Équipe</h3><div class="stack-list"><button class="menu-row" data-action="open-team-roles"><span>${icon('users', {size: 19})}</span>`,
      `<span><strong>Équipe et autorisations</strong><small>${members.length} membre${members.length > 1 ? 's' : ''} · `,
      `vous êtes ${escapeHtml(sync.roleName.toLocaleLowerCase('fr'))} · grades, invitations, qui peut faire quoi</small></span><b>›</b></button></div>`,
      `<h3>Appareils</h3><div class="stack-list">${deviceRows}</div>`,
      '<form id="device-name-form" class="form-grid"><label class="span-2">Nom de cet appareil',
      `<input name="name" value="${escapeHtml(ctx.readLocalText('parcelles:device-name')) }" placeholder="iPhone de Thibault"></label></form>`,
      '<button class="small-button" id="rename-device">Renommer</button>',
      activity.length ? `<h3>Activité cloud récente</h3><div class="stack-list">${activityRows}</div>` : ''].join('');
    ctx.modal('Compte & équipe', `${escapeHtml(sync.workspace?.name || data.exploitation.nom)} · ${escapeHtml(sync.roleName)}`, body,
      '<button class="button secondary" id="switch-workspace">Changer d’exploitation</button>'
      + '<button class="button secondary" id="cloud-signout">Se déconnecter</button>'
      + '<button class="button primary" data-action="open-sync">Synchroniser</button>',
      'large');
    $('#rename-device').onclick = async () => {
      const name = new FormData($('#device-name-form')).get('name');
      try { await sync.renameDevice(name); ctx.toast('Appareil renommé.'); openAccountTeam(); } catch (error) { ctx.toast(error.message, 'error'); }
    };
    $('#switch-workspace').onclick = async () => {
      await ctx.store.switchWorkspace('local'); await sync.refreshMembership();
      ctx.closeModal(); ctx.renderAll(); ctx.renderNetwork(); openAccountTeam();
    };
    $('#cloud-signout').onclick = signOut;
  }

  // Parcours : cloud désactivé → configuration absente → connexion → choix de l'exploitation → équipe et appareils.
  async function openAccountTeam() {
    const sync = ctx.sync;
    if (!ctx.state().preferences.syncEnabled) { localOnly(); return; }
    await sync.init();
    if (!sync.status.configured) { notConfigured(sync); return; }
    if (!sync.user) { signIn(sync); return; }
    const workspaces = await sync.listWorkspaces().catch(() => []);
    if (!sync.workspaceId || !sync.member) { chooseWorkspace(sync, workspaces); return; }
    await team(sync);
  }

  function syncSummary(result) {
    const n = key => result[key] || 0;
    return `<div class="notice info">Dernière opération : ${n('sent')} ${plural(n('sent'), 'envoyée', 'envoyées')}, `
      + `${n('pulled')} ${plural(n('pulled'), 'reçue', 'reçues')}, `
      + `${n('merged')} ${plural(n('merged'), 'fusion', 'fusions')} ${plural(n('merged'), 'sûre', 'sûres')}, `
      + `${n('errors')} ${plural(n('errors'), 'erreur', 'erreurs')}, `
      + `${n('uploaded')} ${plural(n('uploaded'), 'fichier', 'fichiers')} ${plural(n('uploaded'), 'envoyé', 'envoyés')}, `
      + `${n('downloaded')} ${plural(n('downloaded'), 'reçu', 'reçus')}.</div>`;
  }

  async function openSync() {
    const sync = ctx.sync, data = ctx.state(), stats = queueStats(data.queue);
    const conflicts = ctx.active('syncConflicts', data).filter(c => c.status === 'open');
    const row = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
    const conflictRows = conflicts.map(c => `<button class="menu-row" data-action="open-sync-conflict" data-id="${c.id}"><span>!</span><span>`
      + `<strong>${escapeHtml(ctx.entityTypeLabel(c.entity))}</strong>`
      + `<small>${escapeHtml((c.conflictFields || []).length ? `Champs : ${c.conflictFields.join(', ')}` : c.entityId || '')}</small>`
      + '</span><b>›</b></button>').join('');
    const body = ['<dl class="definition-list">', row('État', escapeHtml(sync.status.message)), row('Rôle', escapeHtml(sync.roleName)),
      row('Prêtes', stats.ready), row('Temporisées', stats.waiting), row('En erreur', stats.error), row('Conflits', conflicts.length),
      row('Dernière sync', data.metadata.lastSyncAt ? localDateTime(data.metadata.lastSyncAt) : 'Aucune'), '</dl>',
      data.metadata.lastSyncError ? `<div class="notice warning">Dernière erreur : ${escapeHtml(data.metadata.lastSyncError)}</div>` : '',
      sync.lastResult ? syncSummary(sync.lastResult) : '',
      conflicts.length ? `<h3>Conflits à résoudre</h3><div class="stack-list">${conflictRows}</div>` : '',
      '<div class="notice info" style="margin-top:14px">Une erreur réseau n’efface jamais la saisie locale. ',
      'Les tentatives sont espacées progressivement et les opérations en échec restent visibles.</div>'].join('');
    const footer = ['<button class="button secondary" data-action="open-account">Compte & équipe</button>',
      '<button class="button secondary" data-action="open-security">Sécurité</button>',
      stats.error ? '<button class="button secondary" id="retry-sync-errors">Réessayer les erreurs</button>' : '',
      '<button class="button secondary" data-action="close-modal">Fermer</button>',
      sync.status.connected ? '<button class="button primary" id="run-sync">Synchroniser maintenant</button>' : ''].join('');
    ctx.modal('Synchronisation', 'File robuste, reprises automatiques et conflits explicites.', body, footer, 'large');
    $('#retry-sync-errors')?.addEventListener('click', async () => { await sync.retryFailed(); openSync(); ctx.toast('File de synchronisation réarmée.'); });
    $('#run-sync')?.addEventListener('click', async () => {
      const b = $('#run-sync');
      b.disabled = true; b.textContent = 'Synchronisation…';
      try {
        const r = await withProgress('Synchronisation des données…', () => sync.sync({force: true}), {button: b});
        ctx.renderNetwork(); openSync();
        ctx.toast(`${r.sent || 0} ${plural(r.sent || 0, 'envoyée', 'envoyées')}, ${r.pulled || 0} ${plural(r.pulled || 0, 'reçue', 'reçues')}, `
          + `${r.conflicts || 0} ${plural(r.conflicts || 0, 'conflit', 'conflits')}.`);
      } catch (error) { b.disabled = false; b.textContent = 'Synchroniser maintenant'; ctx.toast(error.message, 'error'); }
    });
  }

  return {openAccountTeam, openSync};
}

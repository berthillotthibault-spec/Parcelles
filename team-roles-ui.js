// Équipe et autorisations (Plus › Compte & application) : membres et grades, invitations en attente,
// tableau « Qui peut faire quoi » et journal des changements d’équipe.
// Les boutons affichés suivent team-roles.js ; la vraie frontière de sécurité reste firestore.rules.
import {
  ROLE_ORDER, ROLE_SUMMARY, assignableRolesFor, canChangeRole, canLeave, canManageMember, canManageTeam,
  canRevokeInvite, canTransferOwnership, lastActivityByUser, manageBlockReason, pendingInvites,
  permissionMatrix, sortMembers, teamJournal, teamPowerSentence
} from './team-roles.js';
import {normalizeRole, roleLabel} from './permissions.js';
import {escapeHtml as e} from './utils.js';

const SHORT = {owner: 'Propriétaire', manager: 'Responsable', editor: 'Collaborateur', operator: 'Opérateur', accountant: 'Compta.', viewer: 'Lecteur'};
const dateFr = ms => new Date(ms).toLocaleDateString('fr-FR', {day: 'numeric', month: 'short', year: 'numeric'});
const timeFr = ms => new Date(ms).toLocaleString('fr-FR', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
function ago(ms, now) {
  const d = Math.max(0, now - ms), min = 60000, h = 60 * min, day = 24 * h;
  if (d < 5 * min) return 'à l’instant';
  if (d < h) return `il y a ${Math.round(d / min)} min`;
  if (d < day) return `il y a ${Math.round(d / h)} h`;
  if (d < 30 * day) { const n = Math.round(d / day); return `il y a ${n} jour${n > 1 ? 's' : ''}`; }
  return `le ${dateFr(ms)}`;
}
const badge = role => `<span class="tr-badge tr-role-${e(normalizeRole(role))}">${e(roleLabel(role))}</span>`;
const initial = m => e(String(m.displayName || m.email || m.uid || m.id || '?').trim().charAt(0).toLocaleUpperCase('fr') || '?');

export function createTeamRolesUI({sync, state, modal, closeModal, toast, copyText = async () => false, bindChipChoices = () => {}, openAccount = () => {}, openSync = () => {}, afterLeave = () => {}, onInvite = () => {}, now = () => Date.now(), win = globalThis.window} = {}) {
  let cache = {members: [], invites: [], devices: [], activity: []};
  const prefs = () => state()?.preferences || {};
  const myUid = () => sync?.user?.uid || '';
  const myRole = () => normalizeRole(sync?.role || 'viewer');
  const cloudReady = () => Boolean(sync?.user && sync?.workspaceId && sync?.member);
  const online = () => !(win?.navigator && win.navigator.onLine === false) && Boolean(sync?.status?.connected);
  const inviteLink = token => {
    const loc = win?.location;
    return loc ? `${loc.origin}${loc.pathname}#invitation=${encodeURIComponent(token)}` : token;
  };
  const back = '<button class="button secondary" data-team-back>Retour</button>';
  function wireBack() { document.querySelectorAll('[data-team-back]').forEach(b => { b.onclick = () => open({reuse: true}); }); }
  const fail = err => toast(err?.message || String(err), 'error');

  async function load() {
    const [members, invites, devices, activity] = await Promise.all([
      sync.listMembers().catch(() => []),
      online() && canManageTeam(myRole()) ? sync.listInvites().catch(() => []) : Promise.resolve([]),
      sync.listDevices().catch(() => []),
      sync.listActivity(80).catch(() => [])
    ]);
    cache = {members, invites, devices, activity};
  }

  function matrixHtml(current) {
    const {roles, rows} = permissionMatrix();
    const sym = {yes: ['✓', 'Oui'], partial: ['◐', 'En partie'], no: ['—', 'Non']};
    const head = roles.map(r => `<th scope="col" class="${r.role === current ? 'is-me' : ''}"><abbr title="${e(r.label)}">${e(SHORT[r.role])}</abbr></th>`).join('');
    const body = rows.map(row => `<tr><th scope="row">${e(row.label)}</th>${roles.map(r => {
      const c = row.cells[r.role], [s, word] = sym[c.value];
      const label = `${r.label} : ${word}${c.note ? ` (${c.note})` : ''}`;
      return `<td class="tr-cell tr-${c.value} ${r.role === current ? 'is-me' : ''}" title="${e(label)}"><span aria-hidden="true">${s}</span><span class="sr-only">${e(label)}</span>${c.note ? `<small>${e(c.note)}</small>` : ''}</td>`;
    }).join('')}</tr>`).join('');
    return `<div class="tr-matrix-wrap" tabindex="0" role="region" aria-label="Qui peut faire quoi, par grade"><table class="tr-matrix"><thead><tr><th scope="col">Action</th>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <ul class="tr-grades">${ROLE_ORDER.map(r => `<li>${badge(r)}<span>${e(ROLE_SUMMARY[r])}</span></li>`).join('')}</ul>`;
  }

  function memberRow(m, role, ro, activityByUser) {
    const id = m.id || m.uid, self = id === myUid(), target = normalizeRole(m.role);
    const last = activityByUser[id];
    const meta = [self ? 'Vous' : '', last ? `Actif ${ago(last, now())}` : 'Activité inconnue', m.joinedAt ? `membre depuis le ${dateFr(m.joinedAt)}` : ''].filter(Boolean).join(' · ');
    const actions = [];
    let why = '';
    if (self) {
      if (canLeave(role)) actions.push(`<button class="small-button danger" data-team-leave ${ro ? 'disabled' : ''}>Quitter l’exploitation</button>`);
      else why = 'Pour quitter l’exploitation, transférez d’abord la propriété.';
    } else if (canManageMember(role, target)) {
      actions.push(`<button class="small-button" data-team-role="${e(id)}" ${ro ? 'disabled' : ''}>Changer le grade</button>`);
      actions.push(`<button class="small-button danger" data-team-remove="${e(id)}" ${ro ? 'disabled' : ''}>Retirer</button>`);
      if (canTransferOwnership(role, target)) actions.push(`<button class="small-button" data-team-transfer="${e(id)}" ${ro ? 'disabled' : ''}>Transférer la propriété</button>`);
    } else if (canManageTeam(role)) {
      why = manageBlockReason(role, target);
    }
    return `<li class="tr-member${self ? ' is-self' : ''}"><span class="tr-avatar" aria-hidden="true">${initial(m)}</span><div class="tr-who"><strong>${e(m.displayName || m.email || id)}</strong>${m.displayName && m.email ? `<small>${e(m.email)}</small>` : ''}<small>${e(meta)}</small></div>${badge(target)}${actions.length || why ? `<div class="tr-actions">${actions.join('')}${why ? `<small class="tr-why">${e(why)}</small>` : ''}</div>` : ''}</li>`;
  }

  function inviteFormHtml(role, ro) {
    const roles = assignableRolesFor(role);
    if (!roles.length) return '';
    const def = roles.includes('operator') ? 'operator' : roles[roles.length - 1];
    return `<section class="tr-section"><h3>Inviter quelqu’un</h3><form id="team-invite-form" class="tr-invite" novalidate>
      <label>Adresse e-mail<input name="email" type="email" autocomplete="off" inputmode="email" placeholder="prenom.nom@exemple.fr" ${ro ? 'disabled' : ''}></label>
      <input type="hidden" name="role" value="${def}">
      <fieldset class="tr-role-pick" ${ro ? 'disabled' : ''}><legend>Grade proposé</legend><div class="chip-choices" data-chip-target="role">${roles.map(r => `<button type="button" class="choice-chip${r === def ? ' is-on' : ''}" aria-pressed="${r === def}" data-value="${r}">${e(roleLabel(r))}</button>`).join('')}</div></fieldset>
      <p class="form-note">${role === 'manager' ? 'En tant que responsable, vous invitez uniquement à un grade inférieur au vôtre.' : 'Le grade Propriétaire ne s’attribue pas par invitation : utilisez le transfert de propriété.'} L’invitation expire au bout de 7 jours et ne fonctionne qu’avec l’adresse prévue.</p>
      <p class="form-error hidden" role="alert"></p>
      <button class="button primary" type="submit" ${ro ? 'disabled' : ''}>Créer l’invitation</button></form></section>`;
  }

  function invitesHtml(role, ro) {
    if (!canManageTeam(role)) return '';
    if (ro) return `<section class="tr-section"><h3>Invitations en attente</h3><div class="empty-state">Disponibles une fois la connexion rétablie.</div></section>`;
    const list = pendingInvites(cache.invites, now());
    return `<section class="tr-section"><h3>Invitations en attente${list.length ? ` <span class="tr-count">${list.length}</span>` : ''}</h3>${list.length ? `<ul class="tr-list">${list.map(i => `<li class="tr-invite-row"><div class="tr-who"><strong>${e(i.email)}</strong><small>Expire le ${dateFr(i.expiresAt)}</small></div>${badge(i.role)}<div class="tr-actions"><button class="small-button" data-team-copy="${e(i.token)}">Copier le lien</button>${canRevokeInvite(role, i.role) ? `<button class="small-button danger" data-team-revoke="${e(i.token)}">Révoquer</button>` : '<small class="tr-why">Seul le propriétaire révoque cette invitation.</small>'}</div></li>`).join('')}</ul>` : '<div class="empty-state">Aucune invitation en attente.</div>'}</section>`;
  }

  function journalHtml() {
    const rows = teamJournal(cache.activity).slice(0, 30);
    const who = uid => cache.members.find(m => (m.id || m.uid) === uid)?.email || '';
    return `<section class="tr-section"><h3>Journal de l’équipe</h3>${rows.length ? `<ol class="tr-journal">${rows.map(a => {
      const target = a.details?.email || (String(a.entityId || '').includes('@') ? a.entityId : who(a.entityId));
      return `<li><span><strong>${e(a.label)}</strong>${a.roleLabel ? ` · ${e(a.roleLabel)}` : ''}</span><small>${target ? `${e(target)} · ` : ''}par ${e(a.email || 'membre')} · ${a.createdAt ? timeFr(a.createdAt) : '—'}</small></li>`;
    }).join('')}</ol>` : '<div class="empty-state">Aucun changement d’équipe enregistré pour l’instant.</div>'}</section>`;
  }

  function localScreen() {
    const p = prefs();
    const why = !p.syncEnabled ? 'Parcelles fonctionne ici en local, sans compte : vous êtes seul sur cet appareil.' : 'Connectez-vous à une exploitation cloud pour gérer une équipe.';
    modal('Équipe et autorisations', 'Grades, invitations et qui peut faire quoi.', `<div class="team-roles">
      <div class="notice info">${e(why)} Pour travailler à plusieurs, ouvrez <strong>Équipe &amp; synchronisation</strong> et créez l’exploitation cloud : vous en serez le propriétaire.</div>
      <section class="tr-section"><h3>Qui peut faire quoi</h3>${matrixHtml('')}</section></div>`,
    `<button class="button secondary" data-action="close-modal">Fermer</button><button class="button primary" data-team-account>Équipe &amp; synchronisation</button>`, 'large');
    document.querySelector('[data-team-account]')?.addEventListener('click', () => openAccount());
  }

  async function open({reuse = false} = {}) {
    if (!cloudReady()) { localScreen(); return; }
    if (!reuse || !cache.members.length) await load();
    render();
  }

  function render() {
    const role = myRole(), ro = !online();
    const activityByUser = lastActivityByUser(cache);
    const members = sortMembers(cache.members);
    const body = `<div class="team-roles">
      <section class="tr-me"><div><small>Votre grade</small>${badge(role)}</div><p>${e(teamPowerSentence(role))}</p></section>
      ${ro ? '<div class="notice warning" role="status">Hors connexion : l’équipe est affichée en lecture seule. Les changements de grade, invitations et retraits reprendront au retour du réseau.</div>' : ''}
      <section class="tr-section"><h3>Membres <span class="tr-count">${members.length}</span></h3>${members.length ? `<ul class="tr-list">${members.map(m => memberRow(m, role, ro, activityByUser)).join('')}</ul>` : '<div class="empty-state">Liste des membres indisponible pour le moment.</div>'}</section>
      ${inviteFormHtml(role, ro)}
      ${invitesHtml(role, ro)}
      <section class="tr-section"><h3>Qui peut faire quoi</h3>${matrixHtml(role)}<p class="form-note">Ces droits s’appliquent aussi sur le serveur : un grade ne peut pas les contourner depuis un autre appareil.</p></section>
      ${journalHtml()}
    </div>`;
    modal('Équipe et autorisations', `${sync.workspace?.name || state()?.exploitation?.nom || 'Exploitation'} · ${roleLabel(role)}`, body,
      `<button class="button secondary" data-action="close-modal">Fermer</button>${ro ? '' : '<button class="button secondary" data-team-refresh>Actualiser</button>'}`, 'large');
    wire(role);
  }

  function wire(role) {
    const q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];
    q('[data-team-refresh]')?.addEventListener('click', () => open());
    qa('[data-team-role]').forEach(b => { b.onclick = () => roleScreen(b.dataset.teamRole); });
    qa('[data-team-remove]').forEach(b => { b.onclick = () => removeScreen(b.dataset.teamRemove); });
    qa('[data-team-transfer]').forEach(b => { b.onclick = () => transferScreen(b.dataset.teamTransfer); });
    q('[data-team-leave]')?.addEventListener('click', leaveScreen);
    qa('[data-team-copy]').forEach(b => { b.onclick = async () => { const ok = await copyText(inviteLink(b.dataset.teamCopy)); toast(ok ? 'Lien d’invitation copié.' : 'Copie impossible sur ce navigateur.', ok ? 'success' : 'error'); }; });
    qa('[data-team-revoke]').forEach(b => { b.onclick = () => revokeScreen(b.dataset.teamRevoke); });
    const form = q('#team-invite-form');
    if (form) {
      bindChipChoices(form);
      form.onsubmit = async ev => {
        ev.preventDefault();
        const err = form.querySelector('.form-error'), email = String(form.elements.email.value || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Saisissez une adresse e-mail valide.'; err.classList.remove('hidden'); form.elements.email.focus(); return; }
        const submit = form.querySelector('[type=submit]'); submit.disabled = true;
        try { const invite = await sync.createInvite(email, form.elements.role.value); try { await onInvite(invite); } catch {} await load(); inviteDone(invite); }
        catch (error) { err.textContent = error.message; err.classList.remove('hidden'); submit.disabled = false; }
      };
    }
  }

  const member = id => cache.members.find(m => (m.id || m.uid) === id);
  const nameOf = m => m?.displayName || m?.email || m?.id || 'ce membre';

  function inviteDone(invite) {
    const link = inviteLink(invite.token);
    modal('Invitation créée', `${invite.email} · ${roleLabel(invite.role)}`, `<p>Envoyez ce lien à la personne invitée. Elle se connecte avec <strong>${e(invite.email)}</strong> puis rejoint l’exploitation.</p>
      <pre class="diagnostic-pre tr-link">${e(link)}</pre><p class="form-note">Code seul : <code>${e(invite.token)}</code> · expire le ${dateFr(invite.expiresAt)}.</p>`,
    `${back}<button class="button secondary" data-team-copy-code>Copier le code</button><button class="button primary" data-team-copy-link>Copier le lien</button>`, 'small');
    wireBack();
    document.querySelector('[data-team-copy-link]').onclick = async () => { const ok = await copyText(link); toast(ok ? 'Lien copié.' : 'Copie impossible : sélectionnez le lien.', ok ? 'success' : 'error'); };
    document.querySelector('[data-team-copy-code]').onclick = async () => { const ok = await copyText(invite.token); toast(ok ? 'Code copié.' : 'Copie impossible : sélectionnez le code.', ok ? 'success' : 'error'); };
  }

  function roleScreen(id) {
    const m = member(id); if (!m) return;
    const role = myRole(), current = normalizeRole(m.role), roles = assignableRolesFor(role);
    modal('Changer le grade', nameOf(m), `<form id="team-role-form" novalidate><input type="hidden" name="role" value="${current}">
      <div class="chip-choices tr-role-cards" data-chip-target="role">${roles.map(r => `<button type="button" class="choice-chip${r === current ? ' is-on' : ''}" aria-pressed="${r === current}" data-value="${r}"><strong>${e(roleLabel(r))}</strong><small>${e(ROLE_SUMMARY[r])}</small></button>`).join('')}</div>
      ${role === 'manager' ? '<p class="form-note">Un responsable attribue uniquement les grades inférieurs au sien.</p>' : ''}<p class="form-error hidden" role="alert"></p></form>`,
    `${back}<button class="button primary" data-team-role-save>Enregistrer</button>`, 'small');
    wireBack();
    const form = document.querySelector('#team-role-form'); bindChipChoices(form);
    document.querySelector('[data-team-role-save]').onclick = async ev => {
      const next = form.elements.role.value, err = form.querySelector('.form-error');
      if (next === current) { err.textContent = `${nameOf(m)} est déjà ${roleLabel(current).toLocaleLowerCase('fr')}.`; err.classList.remove('hidden'); return; }
      if (!canChangeRole(role, current, next)) { err.textContent = 'Votre grade ne permet pas ce changement.'; err.classList.remove('hidden'); return; }
      ev.currentTarget.disabled = true;
      try { await sync.updateMemberRole(id, next); toast(`${nameOf(m)} est maintenant ${roleLabel(next).toLocaleLowerCase('fr')}.`, 'success'); await open(); }
      catch (error) { err.textContent = error.message; err.classList.remove('hidden'); ev.currentTarget.disabled = false; }
    };
  }

  function removeScreen(id) {
    const m = member(id); if (!m) return;
    modal('Retirer de l’exploitation ?', nameOf(m), `<p><strong>${e(nameOf(m))}</strong> (${e(roleLabel(m.role))}) perdra l’accès aux données cloud de l’exploitation.</p><p class="form-note">Ses saisies déjà synchronisées restent dans l’exploitation. Vous pourrez l’inviter à nouveau plus tard.</p>`,
      `${back}<button class="button danger" data-team-remove-ok>Retirer</button>`, 'small');
    wireBack();
    document.querySelector('[data-team-remove-ok]').onclick = async ev => {
      ev.currentTarget.disabled = true;
      try { await sync.removeMember(id); toast('Membre retiré.', 'success'); await open(); } catch (error) { fail(error); ev.currentTarget.disabled = false; }
    };
  }

  function revokeScreen(token) {
    const i = cache.invites.find(x => x.token === token); if (!i) return;
    modal('Révoquer l’invitation ?', i.email, `<p>Le lien envoyé à <strong>${e(i.email)}</strong> (${e(roleLabel(i.role))}) ne fonctionnera plus.</p>`,
      `${back}<button class="button danger" data-team-revoke-ok>Révoquer</button>`, 'small');
    wireBack();
    document.querySelector('[data-team-revoke-ok]').onclick = async ev => {
      ev.currentTarget.disabled = true;
      try { await sync.revokeInvite(token); toast('Invitation révoquée.', 'success'); await open(); } catch (error) { fail(error); ev.currentTarget.disabled = false; }
    };
  }

  function transferScreen(id) {
    const m = member(id); if (!m) return;
    modal('Transférer la propriété', nameOf(m), `<div class="notice warning"><strong>Action importante.</strong> ${e(nameOf(m))} deviendra propriétaire de l’exploitation cloud. Vous deviendrez <strong>responsable</strong> : vous ne pourrez plus gérer les autres responsables, purger des données ni revenir en arrière sans son accord.</div>
      <form id="team-transfer-form" novalidate><label>Pour confirmer, saisissez l’adresse e-mail du nouveau propriétaire<input name="confirm" type="email" autocomplete="off" inputmode="email" placeholder="${e(m.email || '')}"></label><p class="form-error hidden" role="alert"></p></form>
      <p class="form-note">Le transfert nécessite une connexion et se fait en une seule opération : l’exploitation n’est jamais sans propriétaire.</p>`,
    `${back}<button class="button danger" data-team-transfer-ok>Transférer la propriété</button>`, 'small');
    wireBack();
    const form = document.querySelector('#team-transfer-form');
    form.onsubmit = ev => { ev.preventDefault(); document.querySelector('[data-team-transfer-ok]').click(); };
    document.querySelector('[data-team-transfer-ok]').onclick = async ev => {
      const err = form.querySelector('.form-error'), value = String(form.elements.confirm.value || '').trim().toLocaleLowerCase('fr');
      if (!m.email || value !== String(m.email).trim().toLocaleLowerCase('fr')) { err.textContent = 'L’adresse saisie ne correspond pas à celle du nouveau propriétaire.'; err.classList.remove('hidden'); return; }
      if (!online()) { err.textContent = 'Le transfert de propriété nécessite une connexion.'; err.classList.remove('hidden'); return; }
      ev.currentTarget.disabled = true;
      try { await sync.transferOwnership(id, value); toast(`${nameOf(m)} est maintenant propriétaire.`, 'success'); await open(); }
      catch (error) { err.textContent = error.message; err.classList.remove('hidden'); ev.currentTarget.disabled = false; }
    };
  }

  function leaveScreen() {
    const pending = (state()?.queue || []).filter(x => x.status === 'pending').length;
    modal('Quitter l’exploitation ?', sync.workspace?.name || '', `<p>Vous n’aurez plus accès aux données cloud de cette exploitation. Il faudra une nouvelle invitation pour revenir.</p>
      ${pending ? `<div class="notice warning">${pending} modification${pending > 1 ? 's' : ''} de cet appareil ${pending > 1 ? 'ne sont' : 'n’est'} pas encore synchronisée${pending > 1 ? 's' : ''}. Synchronisez d’abord pour ne rien perdre côté équipe.</div>` : ''}
      <p class="form-note">Les données déjà présentes sur cet appareil restent consultables localement.</p>`,
    `${back}${pending ? '<button class="button secondary" data-team-sync>Synchroniser d’abord</button>' : ''}<button class="button danger" data-team-leave-ok>Quitter</button>`, 'small');
    wireBack();
    document.querySelector('[data-team-sync]')?.addEventListener('click', () => openSync());
    document.querySelector('[data-team-leave-ok]').onclick = async ev => {
      ev.currentTarget.disabled = true;
      try { await sync.leaveWorkspace(); closeModal(); toast('Vous avez quitté l’exploitation. Espace local actif.', 'success'); afterLeave(); }
      catch (error) { fail(error); ev.currentTarget.disabled = false; }
    };
  }

  return {open};
}

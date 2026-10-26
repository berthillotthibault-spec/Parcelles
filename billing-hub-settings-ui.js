// Centre « Facturation » (chantier B) : onglet Réglages, rendu dans le panneau du centre (billing-hub-ui.js).
// Sections : identité et mentions légales, TVA, banque et QR SEPA, numérotation (aperçu du prochain numéro,
// doublons et trous), conditions de paiement, relances, modèles de messages, modèle visuel (aperçu en direct
// dans un cadre isolé) et carte d'accueil. Chaque section s'enregistre seule (saveSettings partiel : l'identité
// peut rester incomplète, l'émission reste alors bloquée) et s'annule depuis le toast.
import {ACCENTS, FONTS, OPERATION_NATURES, PAYMENT_TERMS, VAT_REGIMES, DEFAULT_PENALTY, invoiceSettings, saveSettings, vatRatesOf} from './invoices.js';
import {epcQrSvg, invoiceHtmlWithQr} from './billing-export.js';
import {LEGAL_FORMS, MESSAGE_KEYS, MESSAGE_VARIABLES, NUMBERING_DOC_TYPES, SETTINGS_SECTIONS, TEMPLATE_COLUMNS, bicCheck, defaultMessage, ibanCheck, messagePreview, numberingPreview, numberingReport, sampleDocument, sectionValues, settingsChecklist, settingsSection, siretCheck} from './billing-hub.js';

const rate = r => `${String(r).replace('.', ',')} %`;
const TERM = d => (d === 0 ? 'À réception' : `${d} jours`);
const REGIME_HELP = {normal: 'TVA collectée sur vos factures (taux par ligne).', franchise: 'Factures sans TVA, mention « TVA non applicable, art. 293 B du CGI ».', 'remboursement-forfaitaire': 'Exploitant au remboursement forfaitaire agricole : TVA non facturée (art. 298 quater du CGI).'};
// Aperçu : page A4 sans barre d'impression, réduite à la largeur du panneau (cadre isolé, sans script).
const PAGE_W = 820, PAGE_H = 1160;
const PREVIEW_CSS = '.dz-toolbar{display:none!important}html,body{margin:0;background:white}';
function fit(frame) {
  const box = frame.parentElement, k = Math.min(1, Math.max(0.3, (box?.clientWidth || PAGE_W) / PAGE_W));
  frame.style.width = `${PAGE_W}px`; frame.style.height = `${PAGE_H}px`; frame.style.transform = `scale(${k})`;
  if (box) box.style.height = `${Math.round(PAGE_H * k)}px`;
}
const assetBase = () => { try { return new URL('./', globalThis.location.href).href; } catch { return ''; } };

export function createHubSettingsUI(ctx) {
  const {store, data, toast, bindChipChoices, canWrite, doc, html, raw, refresh, host} = ctx;
  let section = 'identite', previewType = 'facture', timer = 0;
  const settings = () => invoiceSettings(data());
  const writable = () => canWrite('invoice') && (!store.writeGuard || store.writeGuard({entity: 'exploitation', action: 'update', farmKind: 'invoice'}));
  const option = (value, label, current) => html`<option value="${value}"${String(value) === String(current) ? raw(' selected') : ''}>${label}</option>`;
  const chips = (name, list, value, caption) => html`<div class="field-label"><span>${caption}</span><input type="hidden" name="${name}" value="${value}"><div class="chip-choices" data-chip-target="${name}">${list.map(([k, l]) => html`<button type="button" class="choice-chip${String(k) === String(value) ? ' is-on' : ''}" data-value="${k}">${l}</button>`)}</div></div>`;
  const check = (name, label, on) => html`<label class="bh-check"><input type="checkbox" name="${name}"${on ? raw(' checked') : ''}> ${label}</label>`;
  const hint = (id, c) => html`<small class="bh-hint is-${c.state}" id="${id}" aria-live="polite">${c.message}</small>`;
  const formObject = form => { const out = {}; for (const el of form.elements) { if (!el.name || el.type === 'file') continue; if (el.type === 'checkbox') out[el.name] = el.checked; else out[el.name] = el.value; } return out; };
  const draftOf = form => sectionValues(section, formObject(form), settings());

  function render(box, wanted = '') {
    if (wanted) section = settingsSection(wanted);
    const s = settings(), list = settingsChecklist(data());
    const nav = html`<nav class="bh-subnav" aria-label="Sections des réglages"><ul>${SETTINGS_SECTIONS.map(([k, l]) => html`<li><button type="button" class="bh-subnav-item${k === section ? ' is-on' : ''}" data-bh="set-section" data-value="${k}"${k === section ? raw(' aria-current="true"') : ''}>${l}</button></li>`)}</ul></nav>`;
    const ready = html`<ul class="bh-checklist" aria-label="État des réglages">${list.map(c => html`<li class="${c.ok ? 'is-ok' : 'is-warn'}">${c.label}<small>${c.ok ? c.detail || 'Complet' : c.detail || 'À compléter'}</small></li>`)}</ul>`;
    box.innerHTML = String(html`<div class="bh-settings">${nav}<div class="bh-settings-body">${ready}<form class="bh-form" data-bh-form="settings" data-section="${section}"${section !== 'accueil' && writable() ? raw(' data-bh-guard') : ''} novalidate>${sectionHtml(s)}<p class="form-error hidden" role="alert"></p>
      ${section === 'accueil' ? '' : writable() ? html`<div class="bh-actions bh-sticky"><button type="submit" class="button primary">Enregistrer</button></div>` : html`<p class="bh-note">Lecture seule : votre rôle ne permet pas de modifier les réglages de facturation.</p>`}</form></div></div>`);
    const form = box.querySelector('form');
    bindChipChoices(form);
    if (!writable()) form.querySelectorAll('input,select,textarea').forEach(el => { el.disabled = true; });
    form.addEventListener('submit', event => { event.preventDefault(); save(form); });
    form.addEventListener('input', () => { form.querySelector('.form-error')?.classList.add('hidden'); schedule(form); });
    form.addEventListener('change', () => schedule(form));
    form.addEventListener('click', event => { if (event.target.closest('.choice-chip')) schedule(form); });
    form.querySelector('[data-bh-logo]')?.addEventListener('change', event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) readLogo(form, file); });
    live(form);
  }

  function sectionHtml(s) {
    switch (section) {
      case 'identite': return html`<fieldset class="bh-fieldset"><legend>Identité du vendeur et mentions légales</legend><p class="bh-note">Imprimées sur chaque facture et figées à l’émission. Raison sociale, adresse et SIRET sont obligatoires pour émettre.</p>
        <div class="bh-form-grid">
          <label class="is-wide">Raison sociale<input name="legalName" value="${s.legalName}" autocomplete="organization" required></label>
          <label>Forme juridique<input name="legalForm" value="${s.legalForm}" list="bh-legal-forms" placeholder="EARL"><datalist id="bh-legal-forms">${LEGAL_FORMS.map(f => html`<option value="${f}"></option>`)}</datalist></label>
          <label>Capital social<input name="capital" value="${s.capital}" placeholder="7 500 €"></label>
          <label>RCS (ville)<input name="rcs" value="${s.rcs}" placeholder="RCS Bourg-en-Bresse 123 456 789"></label>
          <label>SIRET<input name="siret" value="${s.siret}" inputmode="numeric" autocomplete="off" aria-describedby="bh-siret-hint" required>${hint('bh-siret-hint', siretCheck(s.siret))}</label>
          <label>TVA intracommunautaire<input name="vatNumber" value="${s.vatNumber}" autocomplete="off" placeholder="FR12345678901"></label>
          <label class="is-wide">Adresse<textarea name="address" rows="3" autocomplete="street-address" required>${s.address}</textarea></label>
          <label>E-mail<input type="email" name="email" value="${s.email}" autocomplete="email"></label>
          <label>Téléphone<input type="tel" name="phone" value="${s.phone}" autocomplete="tel"></label>
        </div></fieldset>`;
      case 'tva': return html`<fieldset class="bh-fieldset"><legend>Régime de TVA</legend>
        ${chips('vatRegime', VAT_REGIMES.map(([k, l]) => [k, l]), s.vatRegime, 'Régime')}<p class="bh-note" data-bh-regime-help>${REGIME_HELP[s.vatRegime]}</p>
        ${chips('vatTiming', [['encaissements', 'Sur les encaissements'], ['debits', 'Sur les débits (option)']], s.vatOnDebits ? 'debits' : 'encaissements', 'Exigibilité de la TVA (prestations de services)')}
        ${chips('operationNature', OPERATION_NATURES, s.operationNature, 'Nature des opérations')}
        <div class="bh-form-grid"><label>Taux par défaut<select name="vatRate">${vatRatesOf(s).map(r => option(r, rate(r), s.vatRate))}</select></label>
          <label>Taux personnalisés<input name="customVatRates" value="${s.customVatRates.map(r => String(r).replace('.', ',')).join(' ; ')}" placeholder="13 ; 2,1" aria-describedby="bh-rates-help"><small class="bh-hint" id="bh-rates-help">Jusqu’à 6 taux, séparés par des points-virgules (DOM, cas particuliers).</small></label></div></fieldset>`;
      case 'banque': return html`<fieldset class="bh-fieldset"><legend>Coordonnées bancaires</legend><div class="bh-form-grid">
          <label class="is-wide">IBAN<input name="iban" value="${s.iban.replace(/(.{4})/g, '$1 ').trim()}" autocomplete="off" spellcheck="false" aria-describedby="bh-iban-hint">${hint('bh-iban-hint', ibanCheck(s.iban))}</label>
          <label>BIC<input name="bic" value="${s.bic}" autocomplete="off" spellcheck="false" aria-describedby="bh-bic-hint">${hint('bh-bic-hint', bicCheck(s.bic))}</label></div>
          ${check('showQr', 'Imprimer un QR code de virement SEPA (montant restant dû) sur les factures', s.template.showQr)}
          <div class="bh-qr" data-bh-qr aria-live="polite"></div></fieldset>`;
      case 'numerotation': {
        const report = numberingReport(data());
        return html`<fieldset class="bh-fieldset"><legend>Numérotation des pièces</legend><p class="bh-note">Jetons : <code>{PREFIXE}</code>, <code>{AAAA}</code> ou <code>{AA}</code>, <code>{MM}</code>, <code>{NUM:4}</code> (compteur sur 4 chiffres). Le numéro n’est attribué qu’à l’émission, sans trou ni doublon.</p>
          ${NUMBERING_DOC_TYPES.map(([t, label]) => { const c = s.numbering[t]; return html`<fieldset class="bh-fieldset is-nested"><legend>${label}</legend><div class="bh-form-grid">
            <label>Préfixe<input name="${`${t}Prefix`}" value="${c.prefix}" maxlength="6" autocomplete="off"></label>
            <label class="is-wide">Format<input name="${`${t}Format`}" value="${c.format}" autocomplete="off" spellcheck="false"></label>
            <label>Premier numéro<input name="${`${t}StartAt`}" type="number" min="1" step="1" value="${c.startAt}"></label></div>
            ${chips(`${t}Reset`, [['annuel', 'Chaque année'], ['jamais', 'Jamais']], c.reset, 'Remise à zéro du compteur')}
            <p class="bh-preview-number" data-bh-number="${t}" aria-live="polite"></p></fieldset>`; })}
          <section class="bh-card ${report.ok ? '' : 'is-warn'}" aria-labelledby="bh-num-check"><h4 id="bh-num-check">Contrôle de la numérotation</h4>${report.ok ? html`<p>Aucun doublon ni trou dans les pièces émises.</p>` : html`${report.duplicates.length ? html`<p><strong>Doublons :</strong> ${report.duplicates.join(', ')}. Corrigez par un avoir puis une nouvelle émission.</p>` : ''}${report.gaps.length ? html`<p><strong>Numéros manquants :</strong> ${report.gaps.slice(0, 20).join(', ')}${report.gaps.length > 20 ? '…' : ''}. Justifiez-les (pièce annulée, changement de série).</p>` : ''}`}</section></fieldset>`;
      }
      case 'conditions': return html`<fieldset class="bh-fieldset"><legend>Conditions de paiement et devis</legend>
        ${chips('paymentDays', PAYMENT_TERMS.map(d => [d, TERM(d)]), s.paymentDays, 'Délai de paiement par défaut')}
        <div class="bh-form-grid"><label>Validité des devis (jours)<input type="number" name="quoteValidityDays" min="1" max="365" value="${s.quoteValidityDays}"></label>
          <label>Acompte par défaut (%)<input name="depositPct" inputmode="decimal" value="${String(s.depositPct).replace('.', ',')}"></label>
          <label class="is-wide">Escompte pour paiement anticipé<input name="escompte" value="${s.escompte}" placeholder="Pas d’escompte pour paiement anticipé."></label>
          <label class="is-wide">Pénalités de retard<textarea name="penalty" rows="3" placeholder="${DEFAULT_PENALTY}">${s.penalty === DEFAULT_PENALTY ? '' : s.penalty}</textarea><small class="bh-hint">Vide : texte légal par défaut (taux légal × 3 et indemnité forfaitaire de 40 €).</small></label>
          <label class="is-wide">Mention complémentaire<textarea name="mention" rows="2">${s.mention}</textarea></label></div></fieldset>`;
      case 'relances': return html`<fieldset class="bh-fieldset"><legend>Relances des factures en retard</legend><p class="bh-note">Le niveau est proposé dans « À faire » quand le retard atteint le délai ; vous validez chaque envoi. Laissez le texte vide pour garder le modèle fourni.</p>
        ${s.reminders.map(r => html`<fieldset class="bh-fieldset is-nested"><legend>${r.level === 1 ? 'Premier rappel' : r.level === 2 ? 'Deuxième relance' : 'Dernière relance'}</legend><div class="bh-form-grid">
          <label>Jours après l’échéance<input type="number" name="${`r${r.level}Days`}" min="0" value="${r.days}"></label>
          <label>Frais de relance (€)<input name="${`r${r.level}Fee`}" inputmode="decimal" value="${String(r.fee).replace('.', ',')}"></label>
          <label class="is-wide">Objet<input name="${`r${r.level}Subject`}" value="${r.subject || ''}" placeholder="${defaultMessage(`relance${r.level}`).subject}" data-bh-msg="${`relance${r.level}`}"></label>
          <label class="is-wide">Texte<textarea name="${`r${r.level}Body`}" rows="5" placeholder="${defaultMessage(`relance${r.level}`).body}" data-bh-msg="${`relance${r.level}`}">${r.body || ''}</textarea></label></div></fieldset>`)}
        ${variablesHtml()}${previewBox()}</fieldset>`;
      case 'messages': return html`<fieldset class="bh-fieldset"><legend>Modèles de messages de facturation</legend><p class="bh-note">Textes proposés dans la messagerie à l’envoi d’un document (e-mail, SMS, WhatsApp). Vide : modèle fourni.</p>
        ${MESSAGE_KEYS.map(([k, label]) => { const m = s.messages[k] || {}; const d = defaultMessage(k); return html`<fieldset class="bh-fieldset is-nested"><legend>${label}</legend><div class="bh-form-grid">
          <label class="is-wide">Objet<input name="${`${k}Subject`}" value="${m.subject || ''}" placeholder="${d.subject}" data-bh-msg="${k}"></label>
          <label class="is-wide">Texte<textarea name="${`${k}Body`}" rows="5" placeholder="${d.body}" data-bh-msg="${k}">${m.body || ''}</textarea></label></div></fieldset>`; })}
        ${variablesHtml()}${previewBox()}<button type="button" class="button secondary" data-bh="set-messaging">Modèles de la messagerie (SMS, planning…)</button></fieldset>`;
      case 'modele': return html`<div class="bh-template"><div class="bh-template-form"><fieldset class="bh-fieldset"><legend>Modèle visuel des documents</legend>
          <div class="bh-logo"><input type="hidden" name="logo" value="${s.logo}"><div class="bh-logo-preview" data-bh-logo-preview>${s.logo ? html`<img src="${s.logo}" alt="Logo actuel">` : html`<span>Aucun logo</span>`}</div>
            <div class="bh-actions"><button type="button" class="button secondary" data-bh="set-logo">Importer un logo</button>${s.logo ? html`<button type="button" class="text-button" data-bh="set-logo-remove">Retirer le logo</button>` : ''}<input type="file" class="sr-only" accept="image/*" data-bh-logo tabindex="-1" aria-hidden="true"></div></div>
          <div class="field-label"><span id="bh-accent-label">Couleur d’accent</span><input type="hidden" name="accent" value="${s.accent}"><div class="chip-choices bh-swatches" data-chip-target="accent" aria-labelledby="bh-accent-label">${ACCENTS.map(([hex, label]) => html`<button type="button" class="choice-chip bh-swatch${hex === s.accent ? ' is-on' : ''}" data-value="${hex}" aria-label="${label}"><i style="${`background:${hex}`}" aria-hidden="true"></i><span>${label}</span></button>`)}</div></div>
          <label class="bh-inline">Autre couleur<input type="color" name="accentCustom" value="${s.accent}" aria-describedby="bh-accent-label"></label>
          ${chips('font', FONTS, s.template.font, 'Police')}
          <fieldset class="bh-fieldset is-nested"><legend>Colonnes affichées</legend>${TEMPLATE_COLUMNS.map(([k, l]) => check(`col_${k}`, l, s.template.columns[k] !== false))}</fieldset>
          ${check('showQr', 'QR code de virement SEPA', s.template.showQr)}
          <label>Mentions libres<textarea name="freeMentions" rows="2" maxlength="2000">${s.template.freeMentions}</textarea></label>
          <label>Pied de page<input name="footer" value="${s.template.footer}" maxlength="500" placeholder="Raison sociale · SIRET · TVA"></label>
          <label>Conditions générales de vente<textarea name="terms" rows="4" maxlength="6000">${s.template.terms}</textarea></label></fieldset></div>
        <div class="bh-template-preview"><div class="bh-preview-head"><h4 id="bh-preview-title">Aperçu en direct</h4>${chips('previewType', [['facture', 'Facture'], ['devis', 'Devis']], previewType, 'Document d’exemple')}</div>
          <div class="bh-preview-box" data-bh-preview-box><iframe class="bh-preview-frame" title="Aperçu du modèle de document" sandbox="allow-same-origin" data-bh-preview tabindex="-1"></iframe></div></div></div>`;
      default: return html`<fieldset class="bh-fieldset"><legend>Accueil et ouverture</legend>
        ${check('billingHomeCard', 'Carte « factures en retard » sur l’accueil (gestion et comptabilité seulement)', data().preferences?.billingHomeCard !== false)}
        <label>Onglet à l’ouverture de la facturation<select name="billingHubTab">${[['suivi', 'Suivi'], ['afaire', 'À faire']].map(([k, l]) => option(k, l, data().preferences?.billingHubTab || 'suivi'))}</select></label>
        <p class="bh-note">Ces choix sont enregistrés immédiatement.</p></fieldset>`;
    }
  }
  const variablesHtml = () => html`<details class="bh-figures"><summary>Variables disponibles</summary><dl class="bh-vars">${MESSAGE_VARIABLES.map(([k, l]) => html`<dt><code>${`{${k}}`}</code></dt><dd>${l}</dd>`)}</dl></details>`;
  const previewBox = () => html`<section class="bh-card bh-msg-preview" aria-labelledby="bh-msg-preview-title"><h4 id="bh-msg-preview-title">Aperçu <span data-bh-msg-label></span></h4><p class="bh-msg-subject" data-bh-msg-subject></p><p class="bh-msg-body" data-bh-msg-body aria-live="polite"></p></section>`;

  // Aperçus mis à jour pendant la saisie (dernier message touché, numéros, IBAN, QR, modèle).
  let messageKey = '';
  function schedule(form) { clearTimeout(timer); timer = setTimeout(() => live(form), 180); }
  function live(form) {
    if (!form?.isConnected) return;
    try {
      if (section === 'identite') { const h = form.querySelector('#bh-siret-hint'), c = siretCheck(form.elements.siret.value); h.textContent = c.message; h.className = `bh-hint is-${c.state}`; }
      if (section === 'tva') { const p = form.querySelector('[data-bh-regime-help]'); if (p) p.textContent = REGIME_HELP[form.elements.vatRegime.value] || ''; }
      if (section === 'banque') {
        for (const [name, fn, id] of [['iban', ibanCheck, '#bh-iban-hint'], ['bic', bicCheck, '#bh-bic-hint']]) { const h = form.querySelector(id), c = fn(form.elements[name].value); h.textContent = c.message; h.className = `bh-hint is-${c.state}`; }
        const draft = draftOf(form), box = form.querySelector('[data-bh-qr]'), ok = ibanCheck(form.elements.iban.value).state === 'ok';
        if (box) {
          if (!draft.template.showQr) box.innerHTML = '';
          else if (!ok) box.textContent = 'QR code : saisissez un IBAN valide.';
          else { const {doc: d, state: st} = sampleDocument(data(), {draft}); box.innerHTML = String(html`${raw(epcQrSvg(st, d))}<small>Exemple sur une facture de ${d.totals.ttc.toFixed(2).replace('.', ',')} € : le client scanne avec l’application de sa banque.</small>`); }
        }
      }
      if (section === 'numerotation') {
        const draft = draftOf(form);
        form.querySelectorAll('[data-bh-number]').forEach(p => { const r = numberingPreview(data(), draft, p.dataset.bhNumber); p.textContent = r.error ? `Format à corriger : ${r.error}` : `Prochain numéro : ${r.number}`; p.classList.toggle('is-bad', !!r.error); });
      }
      if (section === 'relances' || section === 'messages') {
        const focused = doc.activeElement?.closest?.('[data-bh-msg]')?.dataset.bhMsg;
        messageKey = focused || messageKey || (section === 'relances' ? 'relance1' : 'envoi');
        if (section === 'relances' && !/^relance/.test(messageKey)) messageKey = 'relance1';
        if (section === 'messages' && /^relance/.test(messageKey)) messageKey = 'envoi';
        const m = messagePreview(data(), messageKey, draftOf(form));
        const label = section === 'relances' ? `(relance ${messageKey.slice(-1)})` : `(${(MESSAGE_KEYS.find(([k]) => k === messageKey) || ['', ''])[1].toLowerCase()})`;
        form.querySelector('[data-bh-msg-label]').textContent = label;
        form.querySelector('[data-bh-msg-subject]').textContent = m.subject;
        form.querySelector('[data-bh-msg-body]').textContent = m.body;
      }
      if (section === 'modele') {
        const custom = form.elements.accentCustom;
        if (custom && doc.activeElement === custom) { form.elements.accent.value = custom.value; form.querySelectorAll('.bh-swatch').forEach(c => { const on = c.dataset.value === custom.value; c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', String(on)); }); }
        previewType = form.elements.previewType?.value || previewType;
        const frame = form.querySelector('[data-bh-preview]');
        if (frame) { const {doc: d, state: st} = sampleDocument(data(), {docType: previewType, draft: draftOf(form)}); frame.srcdoc = invoiceHtmlWithQr(st, d, {assetBase: assetBase()}).replace('</head>', `<style>${PREVIEW_CSS}</style></head>`); fit(frame); }
      }
    } catch (error) { console.warn('[Parcelles] aperçu des réglages', error); }
  }

  async function save(form) {
    const fail = (message, field) => { const box = form.querySelector('.form-error'); box.textContent = message; box.classList.remove('hidden'); field?.focus?.(); };
    if (!writable()) return fail('Votre rôle ne permet pas de modifier les réglages de facturation.');
    const values = draftOf(form);
    if (section === 'tva' && values.customVatRates.length > 6) return fail('Six taux personnalisés au plus.', form.elements.customVatRates);
    if (section === 'numerotation') for (const [t, label] of NUMBERING_DOC_TYPES) { const r = numberingPreview(data(), values, t); if (r.error) return fail(`${label} : ${r.error}`, form.elements[`${t}Format`]); }
    const before = JSON.parse(JSON.stringify(store.state?.exploitation?.invoicing || {}));
    try {
      await saveSettings(store, values, {partial: true});
      toast('Réglages de facturation enregistrés.', 'success', {label: 'Annuler', run: async () => { await store.setExploitation({invoicing: before}, {farmKind: 'invoice'}); toast('Réglages rétablis.'); if (doc.getElementById('bh-panel')) refresh(); }});
      refresh();
    } catch (error) {
      const names = {'Raison sociale': 'legalName', Adresse: 'address', SIRET: 'siret', 'N° de TVA': 'vatNumber', IBAN: 'iban', BIC: 'bic', 'Préfixe': 'factureFormat', Logo: null, Relances: 'r1Days', 'Numérotation': 'factureFormat'};
      const field = Object.entries(names).find(([k]) => error.message.includes(k))?.[1];
      fail(error.message, field ? form.elements[field] : null);
    }
  }

  async function readLogo(form, file) {
    try {
      const {prepareLogo} = await import('./invoices-ui.js');
      const url = await prepareLogo(file);
      form.elements.logo.value = url;
      form.querySelector('[data-bh-logo-preview]').innerHTML = String(html`<img src="${url}" alt="Nouveau logo (à enregistrer)">`);
      live(form);
      toast('Logo prêt : enregistrez pour l’appliquer.', 'info');
    } catch (error) { toast(error.message || 'Image illisible.', 'error'); }
  }

  async function handle(action, el) {
    const form = doc.querySelector('[data-bh-form="settings"]');
    if (action === 'set-section') { section = settingsSection(el.dataset.value); refresh(); const item = doc.querySelector(`.bh-subnav-item[data-value="${section}"]`); item?.focus({preventScroll: true}); const ul = item?.closest('ul'); if (ul && ul.scrollWidth > ul.clientWidth) ul.scrollLeft = item.offsetLeft - (ul.clientWidth - item.offsetWidth) / 2; }
    else if (action === 'set-logo') form?.querySelector('[data-bh-logo]')?.click();
    else if (action === 'set-logo-remove' && form) { form.elements.logo.value = ''; form.querySelector('[data-bh-logo-preview]').innerHTML = String(html`<span>Aucun logo</span>`); el.remove(); form.querySelector('[data-bh="set-logo"]')?.focus(); live(form); }
    else if (action === 'set-messaging') { const m = await host.messaging?.(); if (m?.openTemplates) m.openTemplates(); else toast('Messagerie indisponible pour le moment.', 'error'); }
  }
  doc.defaultView?.addEventListener('resize', () => { const frame = doc.querySelector('[data-bh-preview]'); if (frame) fit(frame); });
  // Préférences de l'accueil : enregistrées au changement (pas de bouton).
  doc.addEventListener('change', async event => {
    const el = event.target;
    if (!el?.closest?.('[data-bh-form="settings"][data-section="accueil"]')) return;
    try {
      if (el.name === 'billingHomeCard') { const before = data().preferences?.billingHomeCard !== false; await store.setPreferences({billingHomeCard: el.checked}); toast(el.checked ? 'Carte affichée sur l’accueil.' : 'Carte retirée de l’accueil.', 'success', {label: 'Annuler', run: () => store.setPreferences({billingHomeCard: before})}); }
      if (el.name === 'billingHubTab') { await store.setPreferences({billingHubTab: el.value}); toast('Onglet d’ouverture enregistré.'); }
    } catch (error) { toast(error.message, 'error'); }
  });

  return {render, handle, get section() { return section; }};
}

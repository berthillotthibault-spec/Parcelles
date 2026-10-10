// n° 126 : messages d'erreur humains (titre, cause probable, action) et rapport sans données métier.

const AUTH = {
  'auth/invalid-credential': ['Connexion refusée', 'L’adresse ou le mot de passe ne correspond pas.', 'Vérifiez la saisie ou utilisez « Mot de passe oublié ».'],
  'auth/wrong-password': ['Connexion refusée', 'Le mot de passe ne correspond pas.', 'Vérifiez la saisie ou utilisez « Mot de passe oublié ».'],
  'auth/user-not-found': ['Compte introuvable', 'Aucun compte n’existe avec cette adresse.', 'Vérifiez l’adresse ou créez un compte.'],
  'auth/invalid-email': ['Adresse e-mail invalide', 'L’adresse saisie n’a pas le bon format.', 'Corrigez l’adresse (exemple : nom@exemple.fr).'],
  'auth/email-already-in-use': ['Adresse déjà utilisée', 'Un compte existe déjà avec cette adresse.', 'Connectez-vous plutôt que de créer un compte.'],
  'auth/weak-password': ['Mot de passe trop simple', 'Il faut au moins 6 caractères.', 'Choisissez un mot de passe plus long.'],
  'auth/too-many-requests': ['Trop de tentatives', 'Le compte est bloqué quelques minutes par sécurité.', 'Patientez un peu, puis réessayez.'],
  'auth/network-request-failed': ['Pas de réseau', 'La connexion au compte a besoin d’Internet.', 'Réessayez quand le réseau revient ; vos données restent sur l’appareil.'],
  'auth/popup-closed-by-user': ['Connexion annulée', 'La fenêtre de connexion a été fermée.', 'Relancez la connexion.'],
  'auth/requires-recent-login': ['Reconnexion nécessaire', 'Cette opération demande une connexion récente.', 'Déconnectez-vous puis reconnectez-vous.'],
  'auth/user-disabled': ['Compte désactivé', 'Ce compte a été désactivé.', 'Contactez le propriétaire de l’exploitation.']
};

const KINDS = {
  auth: ['Problème de connexion au compte', 'Le service de compte a refusé la demande.', 'Réessayez, puis consultez Diagnostic si cela persiste.'],
  permission: ['Accès refusé', 'Votre rôle dans l’exploitation ne permet pas cette action.', 'Demandez au propriétaire de changer votre rôle.'],
  quota: ['Mémoire pleine', 'L’espace de stockage de l’appareil ou du navigateur est saturé.', 'Libérez de la place (photos, cartes hors ligne, corbeille) puis réessayez.'],
  offline: ['Pas de réseau', 'Cette action a besoin d’Internet.', 'Réessayez plus tard : ce qui est saisi reste sur l’appareil.'],
  'shp-incomplete': ['Fichier SHP incomplet', 'Un Shapefile se compose de plusieurs fichiers : le .dbf (et souvent le .prj) manque.', 'Sélectionnez ensemble .shp, .dbf, .shx et .prj, ou le ZIP complet.'],
  projection: ['Position des parcelles inconnue', 'Le fichier ne dit pas dans quel système de coordonnées il est (.prj absent ou non reconnu).', 'Ajoutez le fichier .prj, ou exportez en WGS84 / Lambert-93.'],
  'too-big': ['Fichier trop gros', 'Le fichier dépasse la taille que l’appareil peut traiter.', 'Réduisez-le (photo plus légère, export partiel) puis réessayez.'],
  unknown: ['L’action n’a pas abouti', 'Une erreur inattendue est survenue.', 'Réessayez. Si cela recommence, copiez le rapport pour le support.']
};

export function errorKind(error, {online = true} = {}) {
  const code = String(error?.code || ''), name = String(error?.name || ''), message = String(error?.message ?? error ?? '');
  if (code.startsWith('auth/')) return code === 'auth/network-request-failed' ? 'offline' : 'auth';
  if (code === 'permission-denied' || /permission[- ]denied|insufficient permissions/i.test(message)) return 'permission';
  if (name === 'QuotaExceededError' || code === 'resource-exhausted' || Number(error?.code) === 22 || /quota/i.test(message)) return 'quota';
  if (/\.prj|projection/i.test(message)) return 'projection';
  if (/(shp|shapefile).*(dbf|incomplet)|\.dbf.*obligatoire|dbf trop court/i.test(message)) return 'shp-incomplete';
  if (name === 'FileTooLargeError' || code === 'storage/quota-exceeded' || /trop (gros|lourd|volumineux)|too large|payload/i.test(message)) return 'too-big';
  if (!online || code === 'unavailable' || /failed to fetch|networkerror|load failed|network request failed|réseau indisponible|hors connexion/i.test(message)) return 'offline';
  return 'unknown';
}

export function friendlyError(error, options = {}) {
  const code = String(error?.code || '');
  const kind = errorKind(error, options);
  const [title, cause, action] = (kind === 'auth' && AUTH[code]) || (code === 'auth/network-request-failed' && AUTH[code]) || KINDS[kind];
  // Erreur métier déjà rédigée en français (validation, contrôle) : son texte est la cause.
  const raw = String(error?.message ?? (typeof error === 'string' ? error : '')).trim();
  const own = kind === 'unknown' && raw && /[àâçéèêëîïôûùü’]|^[A-ZÀ-Ý][a-zà-ÿ]+ /.test(raw) && !/\b(undefined|null|is not|cannot read|TypeError)\b/i.test(raw);
  return {kind, code, own, title: own ? 'Action impossible' : title, cause: own ? raw : cause, action: own ? 'Corrigez puis réessayez.' : action};
}

// Retire ce qui pourrait identifier l'exploitation ou ouvrir un accès : textes cités, e-mails,
// jetons, coordonnées et paramètres d'URL.
export function redact(text) {
  return String(text ?? '')
    .replace(/[«"“][^»"”]{0,200}[»"”]/g, '«…»')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<e-mail>')
    .replace(/\b(Bearer|token|key|apiKey|password)\b\s*[:=]?\s*\S+/gi, '$1 <masqué>')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '<jeton>')
    .replace(/-?\d{1,3}\.\d{4,}/g, '<coord>')
    .replace(/\?[^\s)]*/g, '')
    .slice(0, 600);
}
export function stackFrames(stack, max = 8) {
  return String(stack || '').split('\n').map(line => {
    const match = /([^\s/()]+\.m?js)(?:\?[^:\s)]*)?:(\d+):(\d+)/.exec(line);
    if (!match) return '';
    const fn = /^\s*at\s+([\w$.<>]+)\s/.exec(line)?.[1] || /^([\w$.<>]+)@/.exec(line.trim())?.[1] || '';
    return `${fn ? fn + ' ' : ''}${match[1]}:${match[2]}:${match[3]}`;
  }).filter(Boolean).slice(0, max);
}
export function errorReport(error, {buildId = '', userAgent = '', at = new Date(), online = true} = {}) {
  const f = friendlyError(error, {online});
  return [
    'Rapport d’erreur Parcelles',
    `Version : ${buildId || 'inconnue'}`,
    `Date : ${at.toISOString()}`,
    `Réseau : ${online ? 'oui' : 'non'}`,
    `Appareil : ${redact(userAgent).slice(0, 160)}`,
    `Type : ${f.kind}${f.code ? ` (${f.code})` : ''}${error?.name ? ` · ${error.name}` : ''}`,
    `Message : ${redact(error?.message ?? error)}`,
    'Pile :',
    ...stackFrames(error?.stack).map(frame => `  ${frame}`)
  ].join('\n');
}

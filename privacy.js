// n° 123 : page Confidentialité. Logique pure, fidèle au code (relu le 2026-10-12) :
// app.js (météo Open-Meteo, géocodage), agro-weather.js / soil-water.js / claims.js (archives météo),
// basemaps.js / offline-map.js / rpg.js (IGN Géoplateforme, Esri), satellite.js (Worker, contour + jeton),
// remote-ai.js (assistant distant configuré par l'utilisateur), messaging-ui.js (liens sms:/wa.me/mailto: et
// passerelle d'envoi facultative de l'utilisateur), sync.js (Firebase, SDK chargé depuis gstatic
// seulement si la synchronisation est activée), utils.js (itinéraires Apple, Google, Waze).

// Ce qui reste sur l'appareil.
export const LOCAL_ITEMS = [
  'Parcelles, contours, travaux, tâches, stocks, matériel, clients et observations',
  'Photos et documents joints',
  'Votre position GPS en direct (jamais envoyée automatiquement)',
  'Sauvegardes automatiques et historique des modifications',
  'Règles d’automatisation, évaluées sur l’appareil',
  'Carnet de contacts, accords RGPD, modèles et journal des messages ; le jeton de la passerelle d’envoi (jamais dans les sauvegardes)'
];

// Données sur des personnes (section de la page Confidentialité). n° 114 : heures pointées et affectation des
// salariés, fidèles à team-work.js (assigneeName, assigneeId, instructions, timeLog sur les travaux et tâches) et à
// firestore.rules (advisorReadable : le conseiller lit les travaux et les tâches, donc ces champs ; le cloisonnement
// se fait par document, pas par champ). Aucune donnée n'est déplacée : cette liste décrit l'existant.
// title, text, who (qui voit), keep (conseil).
export const PEOPLE_ITEMS = [
  {title: 'Bailleurs (foncier)', text: 'Noms et coordonnées, sur cet appareil et dans le cloud si la synchronisation est active.',
    keep: 'Informez vos bailleurs, limitez-vous au nécessaire et supprimez-les en fin de bail.'},
  {title: 'Riverains et apiculteurs', text: 'Nom, téléphone et e-mail seulement avec l’accord daté de la personne.',
    keep: 'Modifiez le point pour les effacer sur demande.'},
  {title: 'Équipe', text: 'E-mail, rôle et éventuelle date de fin d’accès des membres.', who: 'Les membres de l’exploitation cloud.'},
  {title: 'Heures pointées et affectation des salariés', text: 'Nom ou compte de la personne à qui un travail ou une tâche est confié, consigne, horodatages Démarrer / Terminer et feuille d’heures qui en découle. Ces informations sont rangées dans les fiches des travaux et des tâches.',
    who: 'Sur cet appareil, toute personne qui l’utilise. Dans l’exploitation cloud, tous les membres qui lisent les travaux et les tâches : propriétaire, responsable, collaborateur, opérateur, comptabilité, lecteur, et aussi le conseiller / technicien (il voit les travaux, donc les noms et les heures, même si l’écran « Consignes & heures » lui est masqué).',
    keep: 'Informez vos salariés de ce suivi, n’en faites qu’un usage de gestion (paie, coût de main-d’œuvre) et retirez les pointages devenus inutiles. Pour un conseiller, préférez un accès limité dans le temps.'}
];

// Services externes : id, nom, destinataire, données envoyées, quand, pourquoi, réglage éventuel (clé de préférence).
export function privacyServices(prefs = {}, env = {}) {
  const p = prefs || {};
  const firebase = Boolean(env.firebaseConfigured), satellite = Boolean(env.satelliteEndpoint), connected = Boolean(env.cloudConnected);
  const sync = Boolean(p.syncEnabled);
  return [
    {id: 'cloud', name: 'Synchronisation cloud', recipient: 'Google Firebase (projet Parcelles : authentification, base Firestore)',
      data: 'Votre adresse e-mail de connexion et les données de l’exploitation partagée (parcelles, travaux, observations et leurs positions enregistrées…)',
      when: 'Seulement si vous activez la synchronisation et vous connectez', why: 'Partager l’exploitation entre appareils et avec l’équipe',
      state: !firebase ? 'off' : sync ? (connected ? 'on' : 'ready') : 'off', setting: null, manage: 'open-account',
      note: 'Visible par les membres invités de l’exploitation, selon leur rôle (propriétaire, éditeur, lecteur).'},
    {id: 'attachments', name: 'Photos et documents dans le cloud', recipient: 'Google Firebase Storage',
      data: 'Les fichiers joints (photos, PDF…)', when: 'Lors de la synchronisation, si l’option est cochée', why: 'Retrouver les pièces jointes sur les autres appareils',
      state: sync && p.syncAttachments ? 'on' : 'off', setting: 'syncAttachments', requires: 'cloud'},
    {id: 'live', name: 'Modifications de l’équipe en direct', recipient: 'Google Firebase (écoute Firestore)',
      data: 'Aucune donnée en plus : réception des changements des autres membres', when: 'Application ouverte, synchronisation active', why: 'Voir les modifications sans attendre',
      state: sync && p.syncLive !== false ? 'on' : 'off', setting: 'syncLive', settingDefault: true, requires: 'cloud'},
    {id: 'weather', name: 'Météo', recipient: 'Open-Meteo (service public de prévisions, sans compte)',
      data: 'Coordonnées de l’exploitation, ou nom de la commune pour la retrouver ; coordonnées du centre d’une parcelle pour sa météo ou son bilan hydrique',
      when: `${p.weatherAutoRefresh === false ? 'Quand vous actualisez la météo' : 'Au démarrage et au retour du réseau, quand vous actualisez la météo'} et à l’ouverture d’un écran qui en a besoin (phénologie, bilan hydrique, semis, sinistres)`,
      why: 'Prévisions, fenêtres de traitement, cumuls et archives de pluie et de températures',
      state: p.weatherAutoRefresh === false ? 'on-demand' : 'on', setting: 'weatherAutoRefresh', settingDefault: true, settingLabel: 'Actualiser automatiquement au démarrage'},
    {id: 'map', name: 'Fonds de carte et parcelles PAC', recipient: 'IGN (Géoplateforme, API Carto) ; Esri si vous choisissez le fond « Satellite Esri »',
      data: 'La zone affichée (numéros de tuiles), le contour d’une zone pour chercher les îlots RPG ou le cadastre',
      when: 'Quand la carte s’affiche ou que vous lancez une recherche RPG ou cadastre', why: 'Afficher la carte et importer les parcelles déclarées',
      state: 'on-demand', setting: null},
    {id: 'satellite', name: 'Satellite (NDVI)', recipient: 'Worker Parcelles (Cloudflare), qui interroge Copernicus Data Space',
      data: 'Le contour de la parcelle, la période demandée et votre jeton de connexion cloud', when: 'Seulement quand vous cliquez sur « Charger les données »', why: 'Calculer l’indice de végétation de la parcelle',
      state: !satellite ? 'off' : connected ? 'on-demand' : 'ready', setting: null},
    {id: 'assistant', name: 'Assistant distant', recipient: p.remoteAiEndpoint ? `Votre service : ${hostOf(p.remoteAiEndpoint)}` : 'Le service HTTPS que vous configurez (aucun par défaut)',
      data: 'Votre question et un contexte réduit aux données utiles (parcelles citées, travaux, tâches…), visible avant le premier envoi (« Ce que j’envoie »), noms remplaçables par des alias ; l’image ou le PDF seulement pour une lecture de document que vous confirmez',
      when: 'Seulement si vous l’activez et posez une question', why: 'Réponses et lecture de documents par une IA de votre choix',
      state: p.remoteAiEnabled && p.remoteAiEndpoint ? 'on' : 'off', setting: 'remoteAiEnabled', needsEndpoint: !p.remoteAiEndpoint},
    {id: 'messages', name: 'Messages depuis le téléphone', recipient: 'Votre application SMS, WhatsApp ou de messagerie, puis votre opérateur',
      data: 'Le texte du message et les numéros ou adresses des destinataires choisis', when: 'Seulement quand vous touchez « Ouvrir le SMS », « WhatsApp », « Ouvrir l’e-mail » ou « Partager »',
      why: 'Envoyer le planning, une consigne ou un document à l’équipe et aux clients', state: 'on-demand', setting: null, manage: 'open-messages',
      note: 'Les destinataires. L’accord ou l’opposition de chaque contact est noté dans sa fiche ; une opposition bloque l’envoi par ce canal.'},
    {id: 'messages-gateway', name: 'Passerelle d’envoi automatique', recipient: p.messagingGatewayUrl ? `Votre passerelle : ${hostOf(p.messagingGatewayUrl)}, puis votre fournisseur SMS / e-mail` : 'La passerelle HTTPS que vous déployez (aucune par défaut)',
      data: 'Numéros ou adresses, texte du message et jeton de l’exploitation (pas de pièce jointe)', when: 'Seulement si vous l’activez et choisissez l’envoi automatique, ou pour réessayer un envoi en attente',
      why: 'Envoyer sans manipuler le téléphone, ou à une heure programmée', state: p.messagingGatewayEnabled && p.messagingGatewayUrl ? 'on' : 'off', setting: null, manage: 'open-messages'},
    {id: 'routes', name: 'Itinéraires', recipient: 'Apple Plans, Google Maps ou Waze (selon votre choix)',
      data: 'Les coordonnées de la parcelle de destination', when: 'Seulement quand vous touchez « Itinéraire »', why: 'Guider jusqu’à la parcelle',
      state: 'on-demand', setting: null}
  ];
}

function hostOf(url) {try {return new URL(url).hostname;} catch {return 'adresse invalide';}}

export const STATE_LABELS = {on: 'Actif', 'on-demand': 'À la demande', ready: 'Prêt, non connecté', off: 'Désactivé'};

// « 100 % local » : rien n'est stocké hors de l'appareil (cloud et assistant distant éteints).
export function isLocalOnly(prefs = {}) {
  return !prefs?.syncEnabled && !(prefs?.remoteAiEnabled && prefs?.remoteAiEndpoint) && !(prefs?.messagingGatewayEnabled && prefs?.messagingGatewayUrl);
}

// Valeur effective d'un interrupteur (les préférences absentes prennent leur valeur par défaut).
export function settingValue(prefs, service) {
  const v = prefs?.[service.setting];
  return v === undefined ? Boolean(service.settingDefault) : Boolean(v);
}

// Clés de localStorage propres à Parcelles (pour « Tout effacer de cet appareil »).
export function ownLocalKeys(keys) {
  return (keys || []).filter(k => /^parcelles[:.\-_]/i.test(String(k)));
}

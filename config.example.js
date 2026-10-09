/*
 * Parcelles 5.0 — configuration Firebase publique facultative.
 * Copiez les valeurs de votre projet Firebase dans config.js.
 * Ne placez JAMAIS une clé Gemini/OpenAI privée ici.
 * La clé apiKey Firebase côté navigateur identifie le projet ; la protection réelle vient de Firebase Auth + Firestore/Storage Rules.
 */
window.PARCELLES_FIREBASE_CONFIG = {
  apiKey: 'VOTRE_API_KEY_FIREBASE',
  authDomain: 'votre-projet.firebaseapp.com',
  projectId: 'votre-projet',
  storageBucket: 'votre-projet.appspot.com',
  appId: 'VOTRE_APP_ID'
};

// Catalogue phyto E-Phy (n° 59) : URL publique d’un service (Worker) qui renvoie l’export E-Phy
// en CSV ou JSON. Vide : import manuel d’un fichier. Aucune clé ici.
window.PARCELLES_EPHY_ENDPOINT = "";

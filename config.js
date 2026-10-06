/* Parcelles 5.0 — configuration publique facultative.
 * Laissez null pour un fonctionnement 100 % local.
 * La configuration Firebase cliente n'est pas une clé privée ; la sécurité repose sur Auth + Rules.
 */
window.PARCELLES_FIREBASE_CONFIG = {
  "apiKey": "AIzaSyCjCbGU9jKouOe5K7sTRTWkUB_WzUq9xDg",
  "authDomain": "parcelles-c1b27.firebaseapp.com",
  "projectId": "parcelles-c1b27",
  "storageBucket": "parcelles-c1b27.firebasestorage.app",
  "messagingSenderId": "757181374820",
  "appId": "1:757181374820:web:9fe2ee21977cdcf4555a71"
};

// Public URL only. CDSE credentials belong in Worker secrets (SATELLITE_SETUP.md).
window.PARCELLES_SATELLITE_ENDPOINT = "https://parcelles-satellite.berthillotthibault.workers.dev";

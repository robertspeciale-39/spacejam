// ─────────────────────────────────────────────────────────────
//  Firebase web config
//  Paste the values from: Firebase console → Project settings →
//  General → Your apps → Web app → SDK setup and configuration.
//
//  These values are PUBLIC by design (they ship to every browser).
//  Security comes from database.rules.json, not from hiding this file.
//
//  While apiKey is empty, SpaceJam runs in LOCAL DEMO MODE:
//  everything is stored in this browser and syncs between tabs only.
// ─────────────────────────────────────────────────────────────
export const firebaseConfig = {
  apiKey: 'AIzaSyAw-AfBhuvDqT-4-PGlsv7HT_q1huOi6yA',
  authDomain: 'spacejam-westcta.firebaseapp.com',
  databaseURL: 'https://spacejam-westcta-default-rtdb.firebaseio.com',
  projectId: 'spacejam-westcta',
  appId: '1:753381265718:web:cf6d6b373021aba422a397'
};

// Firebase JS SDK version loaded from Google's CDN (gstatic).
export const FIREBASE_SDK_VERSION = '12.19.0';

// Local development only: point at the Firebase Emulator Suite (auth :9099, database :9000).
export const USE_EMULATORS = false;

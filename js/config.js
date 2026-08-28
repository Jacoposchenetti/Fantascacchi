/* ---------------------------------------------------------------
   Configurazione.
   Per giocare online con gli amici incolla qui la config di Firebase
   (Console Firebase > Impostazioni progetto > Le tue app > Web).
   Finche' apiKey resta null, l'app gira in modalita' LOCALE:
   tutto funziona, ma i dati restano in questo browser.
   --------------------------------------------------------------- */

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCYrKjDjmkYbEqHNGyZ3RbJFE4EO5yQcpI",
  authDomain: "fantascacchi-cdcca.firebaseapp.com",
  projectId: "fantascacchi-cdcca",
  storageBucket: "fantascacchi-cdcca.firebasestorage.app",
  messagingSenderId: "156601469530",
  appId: "1:156601469530:web:fe6a22ac1b74e735b56663",
};

export const HAS_FIREBASE = Boolean(FIREBASE_CONFIG.apiKey);

/** Valori predefiniti di una nuova lega. */
export const DEFAULTS = {
  budget: 500,       // crediti a testa per l'asta
  rosterSize: 8,     // giocatori in rosa
  lineupSize: 5,     // titolari schierati ogni giornata
  bidSeconds: 20,    // durata di un lotto d'asta, si azzera a ogni rilancio
};

/**
 * Punteggi. Modificabili per lega dalle impostazioni.
 * Il punteggio grezzo del torneo (0..11) e' la base; tutto il resto e' bonus.
 */
export const SCORING = {
  perPoint: 3,          // x fantapunti per ogni punto fatto nel torneo
  placement: [          // primo piazzamento che "scatta", dall'alto
    { max: 1,  bonus: 25 },
    { max: 2,  bonus: 18 },
    { max: 3,  bonus: 14 },
    { max: 10, bonus: 8 },
    { max: 25, bonus: 4 },
    { max: 50, bonus: 2 },
  ],
  perfectScore: 15,     // 11/11
  strongScore: 5,       // >= 9 punti
  strongScoreMin: 9,
  weakScore: -3,        // < 4 punti
  weakScoreMax: 4,
  captainMultiplier: 2,
  absent: 0,            // non ha giocato il torneo
};

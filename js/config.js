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

/**
 * Aggiungendo ?local all'URL si forza la modalita' locale anche con Firebase
 * configurato: comodo per provare l'asta in due schede senza autenticarsi.
 * Il parametro va prima dell'hash, es. http://localhost:8100/?local#/
 */
const FORCE_LOCAL = typeof location !== "undefined"
  && new URLSearchParams(location.search).has("local");

export const HAS_FIREBASE = Boolean(FIREBASE_CONFIG.apiKey) && !FORCE_LOCAL;

/**
 * Metodi di accesso attivi sul progetto Firebase.
 * Devono corrispondere a Authentication > Sign-in method nella console:
 * mostrare un pulsante per un provider spento porta solo a un errore.
 *
 * Nota: con `anonymous` l'identita' vive solo in quel browser, quindi
 * svuotare i dati o cambiare dispositivo fa perdere la rosa. Con Google
 * l'uid e' stabile ovunque.
 */
export const AUTH = {
  google: true,
  anonymous: false,
};

/** Valori predefiniti di una nuova lega. */
export const DEFAULTS = {
  budget: 500,       // crediti a testa per l'asta
  rosterSize: 8,     // giocatori in rosa
  lineupSize: 5,     // titolari schierati ogni giornata
  bidSeconds: 20,    // durata di un lotto d'asta, si azzera a ogni rilancio
  turnSeconds: 60,   // tempo per chiamare quando tocca a te, poi si salta
  matchdays: 10,     // durata della stagione, in Titled Tuesday
};

/** Un partecipante e' "online" se ha dato un segno di vita di recente. */
export const PRESENCE_TTL = 45 * 1000;
export const PRESENCE_BEAT = 20 * 1000;

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

  // Scontro diretto: due scacchisti schierati da DUE partecipanti diversi
  // che si incontrano al tavolo. Asimmetrico apposta, cosi' schierare i
  // migliori conviene invece di nasconderli.
  duelWin: 3,
  duelLoss: -2,
  duelDraw: 0,
};

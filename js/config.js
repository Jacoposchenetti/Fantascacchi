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
 * Chiave pubblica VAPID per le notifiche push.
 *
 * E' pubblica per definizione: il browser la manda al servizio di push per
 * dire "accetto messaggi firmati da chi possiede la meta' privata". Quella
 * privata sta come secret di Cloud Functions e non deve MAI finire qui.
 *
 * Se un giorno la si rigenera, tutte le iscrizioni esistenti diventano
 * carta straccia: il client se ne accorge da solo e si reiscrive (vedi
 * `stessaChiave` in push.js).
 */
export const VAPID_PUBLIC =
  "BAq5k944D6itfH_4m1zEOzHxBWQ5yBFGO2i2g6wigYHpZPTJ15eZQuumJNDkwAWjsz6nmoVYIhasmFsHwNSK8yU";

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
  sealedHours: 12,   // durata di un giro di buste chiuse (ore)
  sealedSkipLimit: 2, // giri saltati di fila, poi la rosa si riempie d'ufficio
  draftSeconds: 60,  // tempo per scegliere quando tocca a te nel draft
  salaryDays: 3,     // finestra del salary cap, in giorni
};

/** Modalita' d'asta disponibili, con etichetta e descrizione brevi. */
export const AUCTION_MODES = [
  { id: "live",   nome: "Asta live",
    desc: "Tutti insieme col cronometro. Si nomina un giocatore e si rilancia." },
  { id: "sealed", nome: "Buste chiuse",
    desc: "Offerte segrete entro una scadenza, ognuno quando può. Poi si risolve." },
  { id: "draft",  nome: "Draft a serpentina",
    desc: "Niente soldi: a turno ognuno sceglie un giocatore, l'ordine si "
      + "inverte a ogni giro. Rose esclusive." },
  { id: "salary", nome: "Salary cap",
    desc: "Ogni giocatore ha un prezzo fisso. Componi la rosa entro il budget, "
      + "quando vuoi. Lo stesso giocatore può stare in più rose." },
];

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

  // Impresa: batti al tavolo un avversario con rating molto piu' alto.
  // Vale contro chiunque nel torneo, non solo contro chi e' in rosa a
  // qualcuno. Scatta il primo scaglione dall'alto, per singola partita.
  upset: [
    { gap: 300, bonus: 6 },
    { gap: 200, bonus: 4 },
    { gap: 100, bonus: 2 },
  ],
  upsetCap: 12,          // tetto per giornata: una serata d'oro non vale il triplo
};

/**
 * Punteggi per una giornata che e' UN TURNO di torneo classico.
 *
 * Qui non esiste il "punteggio grezzo" 0..11: si gioca una partita sola e
 * finisce in tre modi. Tarare questa tabella con la logica dei Titled
 * Tuesday non funzionava — "almeno 9 punti" su una partita non vuol dire
 * niente — quindi e' una tabella a se', con i suoi conti.
 */
export const SCORING_TURNO = {
  modo: "turno",

  win: 15,
  draw: 6,
  loss: 0,

  // Vincere col nero e' piu' difficile, e negli scacchi lo sanno tutti:
  // e' il bonus che fa guardare il colore prima di schierare.
  neroBonus: 3,

  // Come sta andando il torneo, letto dopo questo turno.
  leader: 4,
  podio: 2,

  captainMultiplier: 2,
  absent: 0,            // turno di riposo, bye, o eliminato

  upset: [
    { gap: 300, bonus: 6 },
    { gap: 200, bonus: 4 },
    { gap: 100, bonus: 2 },
  ],
  upsetCap: 12,

  duelWin: 3,
  duelLoss: -2,
  duelDraw: 0,
};

/**
 * Punteggi per una giornata che e' UN TORNEO CLASSICO INTERO (circuito).
 *
 * Stessa forma dei Titled Tuesday, ma le soglie sono frazioni invece che
 * numeri fissi: un open va da nove a tredici turni, e "almeno 9 punti"
 * significherebbe l'en plein in un torneo e una mezza stagione in un altro.
 */
export const SCORING_CLASSICO = {
  perPoint: 8,          // un punto in un classico costa molta piu' fatica
  placement: [
    { max: 1,  bonus: 30 },
    { max: 2,  bonus: 22 },
    { max: 3,  bonus: 16 },
    { max: 10, bonus: 8 },
    { max: 25, bonus: 4 },
    { max: 50, bonus: 2 },
  ],
  perfectScore: 30,
  // Frazioni dei turni giocati, non punti assoluti.
  strongRatio: 0.7,
  strongScore: 8,
  weakRatio: 0.4,
  weakScore: -4,
  captainMultiplier: 2,
  absent: 0,

  duelWin: 3,
  duelLoss: -2,
  duelDraw: 0,

  upset: [
    { gap: 300, bonus: 6 },
    { gap: 200, bonus: 4 },
    { gap: 100, bonus: 2 },
  ],
  upsetCap: 12,
};

/* ---------------------------------------------------------------
   Livello dati.

   Un solo primitivo scrive sulla lega: updateLeague(id, mutator).
   Il mutator riceve lo stato attuale e restituisce quello nuovo;
   se lancia un'eccezione la scrittura viene annullata. Sopra Firestore
   diventa una transazione vera, quindi due rilanci simultanei non si
   sovrascrivono a vicenda.

   Adapter LOCALE: localStorage + BroadcastChannel (due schede dello
   stesso browser si sincronizzano davvero, utile per provare l'asta).
   Adapter FIREBASE: in store-firebase.js, stessa identica interfaccia.
   --------------------------------------------------------------- */

import { HAS_FIREBASE, DEFAULTS } from "./config.js";
import { shortId } from "./ui.js";

const LS_ME = "fsc:me";
const LS_LEAGUE = (id) => `fsc:league:${id}`;
const LS_MDS = (id) => `fsc:mds:${id}`;
const LS_PRES = (id) => `fsc:presence:${id}`;

/** Scheletro di una lega nuova. */
export function newLeague({ name, uid, userName, budget, rosterSize, lineupSize, bidSeconds, turnSeconds }) {
  const id = shortId(6);
  return {
    id,
    name: name || "La mia lega",
    createdAt: Date.now(),
    adminUid: uid,
    budget: budget ?? DEFAULTS.budget,
    rosterSize: rosterSize ?? DEFAULTS.rosterSize,
    lineupSize: lineupSize ?? DEFAULTS.lineupSize,
    bidSeconds: bidSeconds ?? DEFAULTS.bidSeconds,
    turnSeconds: turnSeconds ?? DEFAULTS.turnSeconds,
    // Si parte in sala d'attesa: l'asta comincia solo quando l'admin da' il via,
    // altrimenti il primo che apre il link puo' comprare a 1 credito da solo.
    phase: "lobby",
    members: { [uid]: { uid, name: userName, joinedAt: Date.now(), isAdmin: true } },
    roster: {},
    auction: {
      status: "idle", playerId: null, bid: 0, bidderUid: null,
      endsAt: 0, turnIdx: 0, turnEndsAt: 0,
    },
    customPlayers: {},
  };
}

/* ----------------------------- identita' ------------------------------ */

function loadMe() {
  try {
    const raw = localStorage.getItem(LS_ME);
    if (raw) return JSON.parse(raw);
  } catch { /* storage bloccato */ }
  return null;
}

function saveMe(me) {
  try { localStorage.setItem(LS_ME, JSON.stringify(me)); } catch { /* ignora */ }
}

/* --------------------------- adapter locale --------------------------- */

function localAdapter() {
  let me = loadMe();
  if (!me) { me = { uid: "u_" + shortId(8), name: "" }; saveMe(me); }

  const chan = "BroadcastChannel" in window ? new BroadcastChannel("fsc") : null;
  const listeners = new Map(); // key -> Set<cb>

  const readJSON = (k, fb) => {
    try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; }
    catch { return fb; }
  };
  const writeJSON = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch { throw new Error("Spazio del browser esaurito: esporta la lega e libera spazio."); }
  };

  function emit(key) {
    const val = readJSON(key, null);
    (listeners.get(key) || []).forEach((cb) => cb(val));
  }

  function broadcast(key) {
    emit(key);
    chan?.postMessage({ key });
  }

  chan?.addEventListener("message", (e) => emit(e.data.key));
  // Fallback per browser senza BroadcastChannel: evento storage fra schede.
  window.addEventListener("storage", (e) => { if (e.key) emit(e.key); });

  function watch(key, cb) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(cb);
    cb(readJSON(key, null));
    return () => listeners.get(key)?.delete(cb);
  }

  return {
    mode: "local",
    // In locale non c'e' nessun login: l'identita' e' un uid casuale
    // salvato nel browser. I metodi di autenticazione esistono comunque
    // perche' l'app possa trattare i due adapter allo stesso modo.
    needsAuth: false,
    canGoogle: false,
    canAnonymous: false,

    get me() { return me; },

    async init() { return me; },

    onAuthChange() { return () => {}; },
    async signInWithGoogle() { /* niente da fare in locale */ },
    async signInAnon() { /* niente da fare in locale */ },
    async signOut() { /* niente da fare in locale */ },

    async setName(name) {
      me = { ...me, name };
      saveMe(me);
    },

    async createLeague(cfg) {
      const lg = newLeague({ ...cfg, uid: me.uid, userName: me.name });
      writeJSON(LS_LEAGUE(lg.id), lg);
      writeJSON(LS_MDS(lg.id), {});
      broadcast(LS_LEAGUE(lg.id));
      return lg.id;
    },

    async getLeague(id) { return readJSON(LS_LEAGUE(id), null); },

    watchLeague(id, cb) { return watch(LS_LEAGUE(id), cb); },

    async updateLeague(id, mutator) {
      const key = LS_LEAGUE(id);
      const cur = readJSON(key, null);
      if (!cur) throw new Error("Lega non trovata");
      const next = mutator(structuredClone(cur));
      if (!next) return cur;
      writeJSON(key, next);
      broadcast(key);
      return next;
    },

    watchMatchdays(id, cb) {
      return watch(LS_MDS(id), (v) => cb(Object.values(v || {})));
    },

    async setMatchday(id, md) {
      const key = LS_MDS(id);
      const all = readJSON(key, {});
      all[md.id] = { ...(all[md.id] || {}), ...md };
      writeJSON(key, all);
      broadcast(key);
    },

    async deleteMatchday(id, mdId) {
      const key = LS_MDS(id);
      const all = readJSON(key, {});
      delete all[mdId];
      writeJSON(key, all);
      broadcast(key);
    },

    watchLineups(id, mdId, cb) {
      const key = LS_MDS(id);
      return watch(key, (v) => cb((v?.[mdId]?.lineups) || {}));
    },

    async setLineup(id, mdId, uid, lineup) {
      const key = LS_MDS(id);
      const all = readJSON(key, {});
      if (!all[mdId]) throw new Error("Giornata non trovata");
      all[mdId].lineups = { ...(all[mdId].lineups || {}), [uid]: { ...lineup, savedAt: Date.now() } };
      writeJSON(key, all);
      broadcast(key);
    },

    watchPresence(id, cb) { return watch(LS_PRES(id), (v) => cb(v || {})); },

    async touchPresence(id, uid) {
      const key = LS_PRES(id);
      const all = readJSON(key, {});
      all[uid] = Date.now();
      writeJSON(key, all);
      broadcast(key);
    },

    /** Esporta tutto per farne un backup o passarlo a un altro browser. */
    async exportLeague(id) {
      return { league: readJSON(LS_LEAGUE(id), null), matchdays: readJSON(LS_MDS(id), {}) };
    },

    async importLeague(dump) {
      if (!dump?.league?.id) throw new Error("File non valido");
      writeJSON(LS_LEAGUE(dump.league.id), dump.league);
      writeJSON(LS_MDS(dump.league.id), dump.matchdays || {});
      broadcast(LS_LEAGUE(dump.league.id));
      return dump.league.id;
    },

    listLocalLeagues() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith("fsc:league:")) {
          const lg = readJSON(k, null);
          if (lg) out.push({ id: lg.id, name: lg.name, createdAt: lg.createdAt });
        }
      }
      return out.sort((a, b) => b.createdAt - a.createdAt);
    },
  };
}

/* ------------------------------ selezione ----------------------------- */

let _store = null;

export async function getStore() {
  if (_store) return _store;
  if (HAS_FIREBASE) {
    try {
      const mod = await import("./store-firebase.js");
      _store = await mod.firebaseAdapter();
      return _store;
    } catch (err) {
      console.error("Firebase non disponibile, passo alla modalita' locale:", err);
    }
  }
  _store = localAdapter();
  await _store.init();
  return _store;
}

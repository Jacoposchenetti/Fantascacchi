/* ---------------------------------------------------------------
   Il banco di prova del tutorial: una lega finta che vive in memoria.

   Stessa interfaccia degli altri due adapter, ma senza localStorage e
   senza rete: chiudendo la scheda sparisce tutto, e nessuno si ritrova
   la lega di prova in mezzo a quelle vere.

   Il punto di tutto questo e' che il tutorial NON ridisegna un'asta
   finta: fa girare l'asta vera. Le viste sono funzioni pure (ctx) -> Node,
   quindi basta dargli un ctx credibile e mostrano esattamente quello che
   vedra' chi gioca sul serio. Un tutorial disegnato a parte mentirebbe
   il giorno che l'asta cambia; questo no, perche' e' la stessa cosa.

   La stagione invece e' per forza finta: aspettare il martedi' vero per
   far vedere come arrivano i punti sarebbe un tutorial un po' lungo.
   --------------------------------------------------------------- */

import { DEFAULTS } from "../config.js";

export const TU = "demo-tu";
export const BOT = [
  { uid: "demo-bea", name: "Bea", indole: "tifosa" },
  { uid: "demo-cico", name: "Cico", indole: "taccagno" },
];

/** Piccola e veloce: tre giocatori a testa, non otto. */
const CONF = {
  budget: 120,
  rosterSize: 3,
  lineupSize: 2,
  bidSeconds: 8,
  turnSeconds: 600,      // il tutorial aspetta te, non ti mette fretta
  matchdays: 3,
};

const SETTIMANA = 7 * 24 * 3600 * 1000;

/* ------------------------------ la lega -------------------------------- */

function legaIniziale(nome) {
  const t = Date.now();
  const membri = {};
  membri[TU] = { uid: TU, name: nome || "Tu", joinedAt: t, isAdmin: true };
  BOT.forEach((b, i) => {
    membri[b.uid] = { uid: b.uid, name: b.name, joinedAt: t + i + 1, isAdmin: false };
  });

  return {
    id: "demo",
    name: "Lega di prova",
    createdAt: t,
    adminUid: TU,
    budget: CONF.budget,
    rosterSize: CONF.rosterSize,
    lineupSize: CONF.lineupSize,
    bidSeconds: CONF.bidSeconds,
    turnSeconds: CONF.turnSeconds,
    // Si parte gia' in asta: la sala d'attesa non ha niente da insegnare.
    phase: "auction",
    members: membri,
    memberUids: [TU, ...BOT.map((b) => b.uid)],
    roster: {},
    auction: {
      status: "idle", playerId: null, bid: 0, bidderUid: null,
      endsAt: 0, turnIdx: 0, turnEndsAt: t + CONF.turnSeconds * 1000,
    },
    customPlayers: {},
    auctionMode: "live",
    open: false,
    sealed: { giro: 1, scadenza: 0, ultimoRisultato: [], risoltoIl: 0 },
    sealedHours: DEFAULTS.sealedHours,
    draft: { round: 1, pickIdx: 0, turnEndsAt: 0, order: [] },
    draftSeconds: DEFAULTS.draftSeconds,
    salaryRosters: {},
    salary: { deadline: 0 },
    salaryDays: DEFAULTS.salaryDays,
    season: { startsAt: 0, matchdays: CONF.matchdays },
  };
}

/* ------------------------------ l'adapter ------------------------------ */

export function demoStore(nomeUtente) {
  let lega = legaIniziale(nomeUtente);
  let giornate = [];
  const me = { uid: TU, name: nomeUtente || "Tu" };

  const ascoltatori = { lega: new Set(), giornate: new Set(), presenza: new Set() };

  // I due avversari risultano sempre collegati: nel tutorial nessuno deve
  // chiedersi se stia aspettando qualcuno che non c'e'.
  const presenza = () => {
    const p = { [TU]: Date.now() };
    BOT.forEach((b) => { p[b.uid] = Date.now(); });
    return p;
  };

  const avvisaLega = () => ascoltatori.lega.forEach((cb) => cb(copia(lega)));
  const avvisaGiornate = () => ascoltatori.giornate.forEach((cb) => cb(copia(giornate)));

  const iscrivi = (set, cb, valore) => {
    set.add(cb);
    cb(valore());
    return () => set.delete(cb);
  };

  return {
    mode: "demo",
    needsAuth: false,
    canGoogle: false,
    canAnonymous: false,

    get me() { return me; },
    async init() { return me; },
    onAuthChange() { return () => {}; },
    async setName(name) { me.name = name; },
    async signOut() { /* niente da fare */ },

    async getLeague() { return copia(lega); },
    watchLeague(id, cb) { return iscrivi(ascoltatori.lega, cb, () => copia(lega)); },

    /**
     * Stessa semantica degli altri adapter: il mutatore riceve una copia,
     * restituisce il nuovo stato oppure null per annullare, e puo' lanciare
     * un errore che arriva a schermo come negli altri casi.
     */
    async updateLeague(id, mutator) {
      const prossima = mutator(copia(lega));
      if (!prossima) return;
      lega = prossima;
      avvisaLega();
    },

    watchMatchdays(id, cb) { return iscrivi(ascoltatori.giornate, cb, () => copia(giornate)); },

    async setMatchday(id, md) {
      giornate = [...giornate.filter((g) => g.id !== md.id), copia(md)];
      avvisaGiornate();
    },

    async setLineup(id, mdId, uid, lineup) {
      const vecchia = giornate.find((g) => g.id === mdId) || { id: mdId, lineups: {} };
      const nuova = {
        ...vecchia,
        lineups: { ...(vecchia.lineups || {}), [uid]: { ...lineup, savedAt: Date.now() } },
      };
      giornate = [...giornate.filter((g) => g.id !== mdId), nuova];
      avvisaGiornate();
    },

    watchLineups(id, mdId, cb) {
      return iscrivi(ascoltatori.giornate, () => {
        cb(giornate.find((g) => g.id === mdId)?.lineups || {});
      }, () => giornate.find((g) => g.id === mdId)?.lineups || {});
    },

    watchPresence(id, cb) { return iscrivi(ascoltatori.presenza, cb, presenza); },
    async touchPresence() { /* nel tutorial sono tutti sempre presenti */ },

    watchMyBids(id, uid, cb) { cb({}); return () => {}; },
    async setBids() { /* le buste chiuse non fanno parte del tutorial */ },
    async readAllBids() { return {}; },
    async clearBids() { /* niente */ },

    async listMyLeagues() { return []; },
    async listOpenLeagues() { return []; },
    async deleteLeague() { /* la lega di prova sparisce da sola */ },

    /* -------- comodita' per il tutorial, non fanno parte dell'interfaccia -------- */

    /** Lo stato attuale, senza passare da una sottoscrizione. */
    leggi() { return lega; },

    /** Le formazioni salvate per una giornata. */
    formazioni(n) {
      return giornate.find((g) => g.id === `g${n}`)?.lineups || {};
    },
  };
}

/* --------------------------- stagione finta ---------------------------- */

/**
 * Il calendario del tutorial: tre martedi', il primo aperto agli
 * schieramenti e gli altri in attesa. Non passa da `seasonPlan` perche'
 * quello guarda il calendario vero, e qui serve una stagione che si possa
 * far succedere adesso invece che fra una settimana.
 */
export function pianoDemo(giocate = 0) {
  // I Titled Tuesday veri sono martedi' alle 15:00 UTC: anche quelli finti
  // devono cadere li'. Un tutorial che annuncia il Titled Tuesday "domenica
  // alle 9:29" insegna la cosa sbagliata al primo sguardo.
  const base = martediProssimo(Date.now());
  const slots = [];
  for (let n = 1; n <= CONF.matchdays; n++) {
    const start = base + (n - 1) * SETTIMANA;
    slots.push({
      n,
      id: n <= giocate ? `demo-tt-${n}` : null,
      date: new Date(start).toISOString().slice(0, 10),
      start,
      rounds: 11,
      total: 640,
      played: 640,        // la vista lo stampa: senza, esce "undefined partecipanti"
      status: n <= giocate ? "scored" : n === giocate + 1 ? "open" : "upcoming",
      estimated: n > giocate,
    });
  }
  return {
    total: CONF.matchdays,
    done: giocate,
    slots,
    startsAt: base,
    endsAt: slots[slots.length - 1].start + 3 * 3600 * 1000,
  };
}

/**
 * Un Titled Tuesday inventato, ma con numeri plausibili e nella stessa
 * forma di quelli veri (`fromStatic` in season.js): classifica, scontri
 * al tavolo e imprese. Cosi' i punti li calcola `scoring.js` davvero,
 * con tutti i suoi bonus, invece di essere scritti a mano nel tutorial.
 *
 * I risultati dipendono dai giocatori effettivamente in rosa, che al
 * momento di scrivere queste righe non si sanno ancora.
 */
export function risultatoDemo(playerIds, catalog, seed = 7) {
  const rnd = generatore(seed);
  const standings = new Map();
  const schierati = [...playerIds];

  // Uno non si presenta: la panchina esiste per questo, e vederlo
  // succedere spiega la regola meglio di qualunque paragrafo.
  const assente = schierati.length > 4 ? schierati[schierati.length - 1] : null;

  for (const pid of schierati) {
    if (pid === assente) continue;
    const p = catalog.map.get(pid);
    // Chi e' piu' forte tende a fare piu' punti, ma non sempre: e' proprio
    // l'incertezza che rende il gioco un gioco.
    const atteso = 5.5 + ((p?.rating || 2600) - 2650) / 110;
    // Forbice larga apposta: e' la differenza fra le giornate che rende
    // leggibile la classifica, e il tutorial serve proprio a farla vedere.
    const punti = arrotondaMezzo(limita(atteso + (rnd() - 0.5) * 7, 1, 11));
    const rank = Math.max(1, Math.round((11 - punti) * 58 + rnd() * 40));
    standings.set(pid, { points: punti, rank });
  }

  // Scontri diretti: due schierati che si incontrano al tavolo.
  const h2h = [];
  const vivi = schierati.filter((p) => p !== assente);
  if (vivi.length >= 2) {
    const a = vivi[0], b = vivi[1];
    const esito = rnd() < 0.45 ? "w" : rnd() < 0.7 ? "b" : "d";
    h2h.push([a, b, esito, 6]);
  }

  // Imprese: ogni tanto qualcuno batte uno molto piu' forte.
  const upsets = [];
  for (const pid of vivi) {
    if (rnd() < 0.35) {
      upsets.push([pid, [120, 220, 330][Math.floor(rnd() * 3)], 1 + Math.floor(rnd() * 11)]);
    }
  }

  return { standings, h2h, upsets, rounds: 11, total: 640, live: false, assente };
}

/** Il martedi' alle 15:00 UTC successivo o uguale a `da`. Come in season.js. */
function martediProssimo(da) {
  const d = new Date(da);
  const t = new Date(Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 15, 0, 0, 0));
  let delta = (2 - t.getUTCDay() + 7) % 7;
  if (delta === 0 && t.getTime() < da) delta = 7;
  t.setUTCDate(t.getUTCDate() + delta);
  return t.getTime();
}

/* -------------------------------- utilita' ------------------------------ */

const copia = (v) => JSON.parse(JSON.stringify(v));
const limita = (v, min, max) => Math.min(max, Math.max(min, v));
const arrotondaMezzo = (v) => Math.round(v * 2) / 2;

/** Numeri casuali ma ripetibili: due aperture del tutorial si somigliano. */
function generatore(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export { CONF as CONFIG_DEMO };

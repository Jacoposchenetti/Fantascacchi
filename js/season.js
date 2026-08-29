/* ---------------------------------------------------------------
   Stagione: un calendario che si riempie da solo.

   Prima ogni giornata andava creata a mano e i punti andavano scaricati
   premendo un pulsante. Qui invece la stagione e' definita da due soli
   numeri sulla lega — quando e' iniziata e quante giornate dura — e tutto
   il resto si deriva.

   Come funziona senza un server
   -----------------------------
   I Titled Tuesday sono regolarissimi: ogni martedi' alle 15:00 UTC, poco
   piu' di due ore. Quindi le date future si prevedono, e gli schieramenti
   si chiudono da soli all'ora d'inizio senza che nessuno intervenga.

   I risultati arrivano da file statici pubblicati dalla GitHub Action
   (circa 6 KB l'uno). Nella finestra fra la fine del torneo e il passaggio
   dell'Action, l'app ripiega su chess.com in diretta: costa di piu', ma
   nessuno deve aspettare né premere niente.
   --------------------------------------------------------------- */

import { discoverTitledTuesdays, fetchStandings } from "./chesscom.js";

/** I Titled Tuesday partono alle 15:00 UTC. Verificato su sei mesi di tornei. */
const TT_HOUR_UTC = 15;
const TT_WEEKDAY = 2;             // martedi'
const SETTIMANA_MS = 7 * 24 * 3600 * 1000;
/** Durata generosa: sotto questa soglia il torneo e' probabilmente in corso. */
const DURATA_MS = 3 * 3600 * 1000;

export const DEFAULT_MATCHDAYS = 10;

let _calendar = null;
const _results = new Map();

/* ------------------------------- calendario ---------------------------- */

/** Indice dei tornei con risultati gia' pubblicati. */
export async function loadCalendar() {
  if (_calendar) return _calendar;
  try {
    const res = await fetch("./data/tt/index.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));
    _calendar = await res.json();
  } catch {
    // Senza indice la stagione resta vuota, ma l'app non si rompe.
    _calendar = { events: [] };
  }
  return _calendar;
}

/** Il martedi' alle 15:00 UTC successivo o uguale a `from`. */
export function nextTuesday(from) {
  const d = new Date(from);
  const t = new Date(Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), TT_HOUR_UTC, 0, 0, 0));
  let delta = (TT_WEEKDAY - t.getUTCDay() + 7) % 7;
  if (delta === 0 && t.getTime() < from) delta = 7;
  t.setUTCDate(t.getUTCDate() + delta);
  return t.getTime();
}

/**
 * Il piano della stagione: sempre `matchdays` caselle.
 * Le prime sono tornei reali gia' archiviati, le altre date previste.
 *
 * @returns {{total,done,slots,endsAt,startsAt}}
 */
export function seasonPlan(league, calendar, now = Date.now()) {
  const startsAt = league?.season?.startsAt || 0;
  const total = league?.season?.matchdays || DEFAULT_MATCHDAYS;

  const real = (calendar?.events || [])
    .filter((e) => e.start && e.start * 1000 >= startsAt)
    .sort((a, b) => (a.start || 0) - (b.start || 0))
    .slice(0, total);

  const slots = real.map((e, i) => ({
    n: i + 1,
    id: e.id,
    date: e.date,
    start: e.start * 1000,
    rounds: e.rounds || 11,
    played: e.played,
    total: e.total,
    status: "scored",
    estimated: false,
  }));

  // Le caselle rimanenti sono martedi' previsti, uno a settimana.
  let cursor = slots.length
    ? slots[slots.length - 1].start + SETTIMANA_MS
    : nextTuesday(startsAt || now);

  // Il conteggio va fissato PRIMA del ciclo: slots cresce a ogni giro, e
  // confrontarlo dentro faceva risultare "prossima" ogni giornata futura.
  const primaPrevista = slots.length + 1;

  for (let n = primaPrevista; n <= total; n++) {
    const start = nextTuesday(cursor);
    const first = n === primaPrevista;
    slots.push({
      n, id: null, date: isoDate(start), start,
      rounds: 11, status: statoPrevisto(start, first, now),
      estimated: true,
    });
    cursor = start + SETTIMANA_MS;
  }

  return {
    total,
    done: slots.filter((s) => s.status === "scored").length,
    slots,
    startsAt,
    endsAt: slots.length ? slots[slots.length - 1].start + DURATA_MS : null,
  };
}

function statoPrevisto(start, isNext, now) {
  // Il torneo e' cominciato ma i risultati non sono ancora pubblicati.
  if (now >= start) return "pending";
  // Solo la prossima giornata accetta formazioni: le altre sono troppo
  // lontane perche' abbia senso schierare.
  return isNext ? "open" : "upcoming";
}

/** La giornata su cui si sta giocando adesso, se ce n'e' una. */
export function currentSlot(plan) {
  return plan.slots.find((s) => s.status === "open" || s.status === "pending") || null;
}

/** Le formazioni stanno in un documento per giornata, numerato. */
export const slotDocId = (n) => `g${n}`;

export function lineupsFor(matchdays, n) {
  return (matchdays || []).find((m) => m.id === slotDocId(n))?.lineups || {};
}

/**
 * La formazione che conta per una giornata: quella salvata, oppure la piu'
 * recente delle precedenti.
 *
 * Vale a schermo e nel punteggio. Cosi' chi si dimentica di schierare gioca
 * con l'ultima che ha messo invece di prendere zero, e non serve scrivere
 * niente sul database per ogni giornata che passa.
 */
export function effectiveLineup(matchdays, n, uid) {
  for (let i = n; i >= 1; i--) {
    const lu = lineupsFor(matchdays, i)[uid];
    if (lu?.starters?.length) {
      return i === n ? lu : { ...lu, inheritedFrom: i };
    }
  }
  return null;
}

/** Quanti partecipanti hanno una formazione utilizzabile per la giornata. */
export function readyCount(matchdays, n, uids) {
  return uids.filter((u) => effectiveLineup(matchdays, n, u)).length;
}

/* -------------------------------- risultati ---------------------------- */

/**
 * Classifica di una giornata.
 * Prima il file statico; se manca (torneo appena finito) si prova in diretta.
 * @returns {Promise<{standings: Map, rounds, total, live} | null>}
 */
export async function loadResults(slot, onProgress = () => {}) {
  if (!slot) return null;
  const key = slot.id || `slot-${slot.n}-${slot.date}`;
  if (_results.has(key)) return _results.get(key);

  let out = null;

  if (slot.id) {
    out = await fromStatic(slot.id);
  } else if (slot.status === "pending" && Date.now() > slot.start + DURATA_MS) {
    // Solo a torneo finito: durante le partite la classifica e' parziale.
    out = await fromLive(slot, onProgress);
  }

  if (out) _results.set(key, out);
  return out;
}

async function fromStatic(id) {
  try {
    const res = await fetch(`./data/tt/${id}.json`, { cache: "force-cache" });
    if (!res.ok) return null;
    const ev = await res.json();
    const standings = new Map(
      Object.entries(ev.standings || {}).map(([u, [p, r]]) => [u, { points: p, rank: r }]),
    );
    return {
      standings, h2h: ev.h2h || [],
      rounds: ev.rounds || 11, total: ev.total || standings.size,
      live: false,
    };
  } catch {
    return null;
  }
}

/**
 * Ripiego per la finestra fra la fine del torneo e la pubblicazione dei file.
 * Va scoperto anche l'id, perche' contiene un suffisso numerico opaco.
 */
async function fromLive(slot, onProgress) {
  try {
    onProgress("Cerco il torneo di oggi su chess.com…");
    const found = await discoverTitledTuesdays(6);
    const match = found.find((e) => e.date === slot.date);
    if (!match) return null;
    const st = await fetchStandings(match.id, onProgress);
    // In diretta si legge solo l'ultimo turno, quindi gli scontri diretti
    // non ci sono: arrivano con i dati definitivi. Il punteggio e' provvisorio.
    return {
      standings: st.standings, h2h: [],
      rounds: 11, total: st.total, live: true, id: match.id,
    };
  } catch {
    return null;
  }
}

/* --------------------------------- utili ------------------------------- */

export function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

export function dataLunga(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MESI[m - 1]} ${y}`;
}

export function dataBreve(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return `${d}/${m}`;
}

/** "fra 3 giorni", "oggi", "2 giorni fa" — per dire quando si gioca. */
export function quando(ms, now = Date.now()) {
  const giorni = Math.round((ms - now) / (24 * 3600 * 1000));
  if (giorni === 0) return "oggi";
  if (giorni === 1) return "domani";
  if (giorni === -1) return "ieri";
  if (giorni > 1) return `fra ${giorni} giorni`;
  return `${-giorni} giorni fa`;
}

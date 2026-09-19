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

   Le altre fonti non si prevedono e non ne hanno bisogno: i turni di un
   torneo classico hanno una data ciascuno, gia' pubblicata, e un torneo
   non ancora annunciato non esiste. Chi porta il calendario e' fonte.js;
   qui si decide solo cosa farne (`prevedi`).

   I risultati arrivano da file statici pubblicati dalla GitHub Action
   (circa 6 KB l'uno). Nella finestra fra la fine del torneo e il passaggio
   dell'Action, l'app ripiega su chess.com in diretta: costa di piu', ma
   nessuno deve aspettare né premere niente.
   --------------------------------------------------------------- */

import { discoverTitledTuesdays, fetchStandings } from "./chesscom.js";
import { rosterOf } from "./league.js";
import { caricaCalendario, fileRisultati, fonteDi } from "./fonte.js";
import { turnoDiretto } from "./lichess.js";

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

/**
 * Il calendario grezzo della lega, qualunque sia la fonte.
 *
 * Non si tiene piu' una copia sola qui dentro: due leghe aperte nella
 * stessa sessione possono avere fonti diverse, e la cache di `fonte.js`
 * lavora gia' per URL, quindi rileggere non costa una chiamata in piu'.
 */
export async function loadCalendar(league) {
  try {
    return await caricaCalendario(league);
  } catch {
    // Senza indice la stagione resta vuota, ma l'app non si rompe.
    return { events: [], prevedi: false };
  }
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

  const tutte = (calendar?.events || [])
    .filter((e) => e.start && e.start * 1000 >= startsAt)
    .sort((a, b) => (a.start || 0) - (b.start || 0));

  // Il numero di giornate lo decide chi crea la lega solo quando le
  // giornate si possono inventare. Un torneo classico dura quanto dura:
  // tagliare i Candidati a dieci turni perche' e' il valore predefinito
  // sarebbe una stagione che finisce a meta' torneo.
  const real = calendar?.prevedi ? tutte.slice(0, total) : tutte;

  // La prima casella non ancora archiviata e' quella che accetta le
  // formazioni. Coi Titled Tuesday non capita mai — l'indice contiene solo
  // tornei finiti — ma i turni di un torneo classico si conoscono tutti fin
  // dal primo giorno, date comprese, e restano li' in attesa di giocarsi.
  const primaDaGiocare = real.findIndex((e) => !e.archiviato);

  const slots = real.map((e, i) => ({
    n: i + 1,
    id: e.id,
    date: e.date,
    start: e.start * 1000,
    rounds: e.rounds || 11,
    played: e.played,
    total: e.total,
    nome: e.nome || null,
    durata: e.durata || null,
    url: e.url || null,
    status: e.archiviato
      ? "scored"
      : statoPrevisto(e.start * 1000, i === primaDaGiocare, now),
    estimated: false,
  }));

  // Le caselle rimanenti sono martedi' previsti, uno a settimana. Si
  // possono prevedere solo i Titled Tuesday: un turno dei Candidati ha una
  // data sua, e un torneo classico non ancora annunciato non esiste.
  // Per le altre fonti la stagione e' lunga quanto il calendario che c'e'.
  if (!calendar?.prevedi) {
    return {
      total: slots.length,
      done: slots.filter((s) => s.status === "scored").length,
      slots,
      startsAt,
      endsAt: slots.length ? slots[slots.length - 1].start + DURATA_MS : null,
    };
  }

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
/**
 * La formazione di chi non ne ha mai messa una: i piu' pagati in campo,
 * il piu' pagato capitano, il resto in panchina.
 *
 * Prima in quel caso non c'era NIENTE, e chi non apriva l'app prendeva
 * zero. Ma la rosa ce l'ha: non aver toccato la formazione non e' una
 * scelta di non giocare, e` semplicemente non aver cambiato l'ordine
 * ovvio. Meglio schierare il meglio che ha e lasciarlo giocare.
 */
/**
 * Il vice di una formazione: il piu' forte per Elo fra i titolari, escluso
 * il capitano.
 *
 * Il rating e non il prezzo pagato, perche' sono due cose diverse: il
 * prezzo dice quanto e' costato all'asta — e li' pesa anche quanto spesso
 * si presenta — mentre la fascia serve nella giornata in cui il vice
 * scende in campo per davvero. In quel momento conta solo quanto e' forte.
 *
 * @param rosa      voci di `rosterOf`, con `.player.rating`
 * @param starters  gli id dei titolari
 * @param captain   l'id del capitano, che non puo' fare anche il vice
 */
export function scegliVice(rosa, starters, captain) {
  const inCampo = new Set(starters || []);
  const candidati = (rosa || [])
    .filter((r) => inCampo.has(r.playerId) && r.playerId !== captain)
    .sort((a, b) => (b.player?.rating || 0) - (a.player?.rating || 0));
  return candidati[0]?.playerId || null;
}

export function formazionePredefinita(league, catalog, uid) {
  if (!league || !catalog) return null;
  const rosa = rosterOf(league, catalog, uid);     // gia' dal piu' caro
  if (!rosa.length) return null;
  const ids = rosa.map((r) => r.playerId);
  const quanti = league.lineupSize || ids.length;
  const starters = ids.slice(0, quanti);
  const captain = starters[0] || null;
  return {
    starters,
    bench: ids.slice(quanti),
    captain,
    vice: scegliVice(rosa, starters, captain),
    predefinita: true,
  };
}

/**
 * La formazione che conta per la giornata n: quella salvata, altrimenti
 * l'ultima messa in una giornata precedente, altrimenti la predefinita.
 *
 * `league` e `catalog` servono solo per l'ultimo gradino: chi non li passa
 * ottiene null come prima, che e' comodo per sapere se una scelta c'e' stata.
 */
export function effectiveLineup(matchdays, n, uid, league = null, catalog = null) {
  for (let i = n; i >= 1; i--) {
    const lu = lineupsFor(matchdays, i)[uid];
    if (lu?.starters?.length) {
      return i === n ? lu : { ...lu, inheritedFrom: i };
    }
  }
  return formazionePredefinita(league, catalog, uid);
}

/**
 * Il torneo di questa giornata si e' gia' giocato?
 *
 * Serve perche' i punteggi non vanno mai mostrati per un martedi' che deve
 * ancora arrivare, nemmeno se in memoria e' rimasto un risultato vecchio.
 */
export const giaGiocata = (slot) =>
  slot?.status === "scored" || slot?.status === "pending";

/** Quanti partecipanti hanno una formazione utilizzabile per la giornata. */
/* -------------------------------- risultati ---------------------------- */

/**
 * Classifica di una giornata.
 * Prima il file statico; se manca (torneo appena finito) si prova in diretta.
 * @returns {Promise<{standings: Map, rounds, total, live} | null>}
 */
export async function loadResults(slot, league = null, onProgress = () => {}) {
  if (!slot) return null;
  const key = slot.id || `slot-${slot.n}-${slot.date}`;
  if (_results.has(key)) return _results.get(key);

  let out = null;
  const fonte = fonteDi(league);

  if (slot.id) {
    out = await fromStatic(slot, league);
  }

  // Niente file: il torneo e' finito ma l'archivio non e' ancora passato.
  if (!out && slot.status === "pending" && Date.now() > slot.start + DURATA_MS) {
    // Solo a torneo finito: durante le partite la classifica e' parziale.
    out = fonte.tipo === "tt"
      ? await fromLive(slot, onProgress)
      : await turnoDiretto(slot, fonte, onProgress);
  }

  if (out) _results.set(key, out);
  return out;
}

async function fromStatic(slot, league) {
  const url = fileRisultati(slot, league);
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return null;
    const ev = await res.json();
    // Terna invece di coppia per i turni di torneo classico: il terzo
    // posto e' il colore, e serve al bonus "vittoria col nero".
    const standings = new Map(
      Object.entries(ev.standings || {}).map(
        ([u, [p, r, c]]) => [u, { points: p, rank: r, color: c || null }]),
    );
    return {
      standings, h2h: ev.h2h || [], upsets: ev.upsets || [],
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
      standings: st.standings, h2h: [], upsets: [],
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

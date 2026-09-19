/* ---------------------------------------------------------------
   Da dove arrivano le giornate.

   Fino a ieri la risposta era una sola: i Titled Tuesday. Adesso sono tre,
   e qui sta l'unico posto che le conosce tutte. Il resto dell'app — piano
   della stagione, punteggi, listone, partite — lavora sulle stesse forme
   qualunque sia la fonte.

     tt        i Titled Tuesday. Una giornata = un torneo del martedi'.
               Il calendario si prevede da solo: sono regolarissimi.

     torneo    UN torneo classico trasmesso da Lichess (Candidati, Tata
               Steel, Grand Swiss). Una giornata = un TURNO. Le date dei
               turni si sanno tutte in anticipo, quindi non si prevede
               niente: si leggono.

     circuito  PIU' tornei classici, uno dietro l'altro. Una giornata =
               un TORNEO intero, come oggi i Titled Tuesday. Il calendario
               non si puo' prevedere — i tornei li annuncia il mondo, non
               un algoritmo — quindi si allunga man mano che entrano in
               archivio.

   I file li pubblica la CI (tools/build_broadcast.py) nello stesso formato
   dei Titled Tuesday: `standings`, `h2h`, `upsets`. E' apposta: cosi' il
   motore dei punteggi e' uno solo.
   --------------------------------------------------------------- */

import { fonteDi } from "./league.js";

/** Le fonti che si possono scegliere creando una lega. */
export const FONTI = [
  { id: "tt", nome: "Titled Tuesday",
    desc: "Il torneo online del martedì su chess.com. Una giornata a "
      + "settimana, per tutta la stagione." },
  { id: "torneo", nome: "Un torneo classico",
    desc: "Candidati, Tata Steel, Grand Swiss… Si compra chi gioca quel "
      + "torneo e ogni turno è una giornata." },
  { id: "circuito", nome: "Circuito di tornei classici",
    desc: "Più tornei di fila: ogni torneo vale una giornata, come i "
      + "Titled Tuesday ma sulla scacchiera vera." },
];

/**
 * Le parole con cui l'app parla di una giornata.
 *
 * Chiamare "giornata" un turno dei Candidati e' sbagliato quanto chiamare
 * "turno" un Titled Tuesday: sono due cose diverse e chi gioca lo sa.
 */
const PAROLE = {
  tt: {
    giornata: "giornata", giornate: "giornate", Giornata: "Giornata",
    evento: "Titled Tuesday", eventi: "Titled Tuesday",
    dove: "chess.com",
    calendario: "Il calendario si genera da solo alla chiusura dell'asta: "
      + "saranno i primi Titled Tuesday che arrivano da quel momento.",
    automatico: "Nessuno deve creare le giornate né caricare i punti: i "
      + "Titled Tuesday entrano da soli e i punteggi arrivano appena "
      + "disponibili.",
    inArrivo: "Il torneo si è giocato. I punteggi compaiono da soli non "
      + "appena la classifica è disponibile — di solito entro il mercoledì "
      + "mattina.",
    previsto: "martedì previsto",
    link: "Il torneo su chess.com ↗",
  },
  torneo: {
    giornata: "turno", giornate: "turni", Giornata: "Turno",
    evento: "turno", eventi: "turni",
    dove: "Lichess",
    calendario: "Il calendario è quello del torneo: i turni hanno già le "
      + "loro date, e diventano giornate una dopo l'altra.",
    automatico: "Le date dei turni si sanno tutte in anticipo. I punteggi "
      + "arrivano da soli quando il turno si chiude.",
    inArrivo: "Il turno si è giocato. I punteggi compaiono da soli appena "
      + "le partite sono tutte finite.",
    previsto: "in programma",
    link: "Il turno su Lichess ↗",
  },
  circuito: {
    giornata: "giornata", giornate: "giornate", Giornata: "Giornata",
    evento: "torneo", eventi: "tornei",
    dove: "Lichess",
    calendario: "La stagione sono i tornei scelti, uno per giornata, in "
      + "ordine di calendario.",
    automatico: "I tornei entrano in calendario man mano che vengono "
      + "trasmessi, e i punteggi arrivano a torneo finito.",
    inArrivo: "Il torneo si è giocato. I punteggi compaiono da soli appena "
      + "la classifica finale è disponibile.",
    previsto: "in programma",
    link: "Il torneo su Lichess ↗",
  },
};

// `fonteDi` vive in league.js, che e' condiviso con le Cloud Functions:
// anche il server deve sapere su cosa gioca una lega. Qui si ri-esporta
// perche' e' da questo modulo che se l'aspetta il resto dell'app.
export { fonteDi } from "./league.js";

export const parole = (league) => PAROLE[fonteDi(league).tipo] || PAROLE.tt;

/**
 * Quanto dura una casella, in millisecondi.
 *
 * Serve a sapere se si sta giocando ADESSO. Un Titled Tuesday sono undici
 * turni da dodici minuti; un turno di classico e' una partita che puo'
 * durare sette ore. Calcolarli con la stessa formula voleva dire che la
 * diretta dei Candidati spariva dopo un quarto d'ora.
 */
export const DURATA_TURNO_CLASSICO = 7 * 3600 * 1000;

/** Vero per le fonti che leggono le dirette di Lichess. */
export const daBroadcast = (league) => fonteDi(league).tipo !== "tt";

/**
 * Vero per uno scacchista che viene da un torneo classico.
 *
 * Si vede dalla chiave: i Titled Tuesday vanno per username chess.com
 * ("hikaru"), i tornei classici per FIDE id ("fide:2016192"). Chiedere a
 * chess.com il profilo di `fide:2016192` non porta da nessuna parte.
 */
export const daTorneo = (player) => /^(fide|nome):/.test(player?.id || "");

/**
 * Che rating si sta mostrando. Sui Titled Tuesday e' il blitz di chess.com,
 * nei tornei classici e' l'Elo FIDE standard: chiamarli tutti "blitz"
 * significava dire una cosa falsa su un 2785 a cadenza lunga.
 */
export const tipoRating = (player) => (daTorneo(player) ? "FIDE" : "blitz");

/* ------------------------------ letture ------------------------------- */

const cache = new Map();

async function json(url, opts) {
  if (cache.has(url)) return cache.get(url);
  const attesa = fetch(url, opts)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  cache.set(url, attesa);
  return attesa;
}

/** L'indice di un torneo in archivio: metadati, turni e campo di partenza. */
export const indiceTorneo = (tour) =>
  json(`./data/bc/${tour}/index.json`, { cache: "no-cache" });

/** I tornei disponibili, per chi crea una lega. */
export async function torneiDisponibili() {
  const d = await json("./data/bc/index.json", { cache: "no-cache" });
  return d?.tours || [];
}

/**
 * Il calendario grezzo della lega: le caselle che si sanno gia'.
 *
 * Forma unica per tutte le fonti:
 *   { events: [{id, date, start, rounds, played, total, archiviato}],
 *     prevedi: bool }
 *
 * `prevedi` dice se le caselle mancanti si possono inventare andando avanti
 * di settimana in settimana. Vale solo per i Titled Tuesday: un turno dei
 * Candidati non si prevede, si legge, e un torneo classico che non e' stato
 * ancora annunciato non esiste finche' non lo annunciano.
 */
export async function caricaCalendario(league) {
  const f = fonteDi(league);

  if (f.tipo === "tt") {
    const d = await json("./data/tt/index.json", { cache: "no-cache" });
    return {
      prevedi: true,
      events: (d?.events || []).map((e) => ({ ...e, archiviato: true })),
    };
  }

  if (f.tipo === "torneo") {
    const m = f.tour ? await indiceTorneo(f.tour) : null;
    if (!m) return { prevedi: false, events: [] };
    return {
      prevedi: false,
      events: (m.rounds || []).map((r) => ({
        id: `${f.tour}/r${r.n}`,
        date: r.date,
        start: r.start,
        rounds: 1,
        durata: DURATA_TURNO_CLASSICO,
        url: `https://lichess.org/broadcast/-/-/${r.id}`,
        played: r.played,
        total: (m.players || []).length,
        // Un turno senza partite non si e' ancora giocato: le date ci sono
        // tutte fin dall'inizio, i risultati no.
        archiviato: (r.played || 0) > 0,
        nome: r.name,
      })),
    };
  }

  // Circuito: un torneo per casella, in ordine di data.
  const metas = (await Promise.all((f.tours || []).map(indiceTorneo))).filter(Boolean);
  const events = metas.map((m) => ({
    id: m.id,
    date: isoDa(m.dates?.[0]),
    start: Math.floor((m.dates?.[0] || 0) / 1000),
    rounds: (m.rounds || []).length,
    // Dal primo turno all'ultimo: un open di undici giorni e' "in corso"
    // per undici giorni, ed e' giusto cosi'.
    durata: Math.max(
      DURATA_TURNO_CLASSICO,
      ((m.dates?.[1] || m.dates?.[0] || 0) - (m.dates?.[0] || 0)) + DURATA_TURNO_CLASSICO),
    url: m.url || "",
    played: (m.players || []).length,
    total: (m.players || []).length,
    archiviato: (m.giocati || 0) >= (m.rounds || []).length && (m.rounds || []).length > 0,
    nome: m.name,
  })).sort((a, b) => (a.start || 0) - (b.start || 0));
  return { prevedi: false, events };
}

/** Il percorso del file risultati di una casella. */
export function fileRisultati(slot, league) {
  const f = fonteDi(league);
  if (!slot?.id) return null;
  if (f.tipo === "tt") return `./data/tt/${slot.id}.json`;
  if (f.tipo === "torneo") return `./data/bc/${slot.id}.json`;
  return `./data/bc/${slot.id}/finale.json`;
}

/**
 * Il listone della lega: chi si puo' comprare all'asta.
 *
 * Per i Titled Tuesday e' l'elenco generale dei forti. Per un torneo
 * classico sono esattamente i suoi partecipanti — comprare Carlsen in una
 * lega sui Candidati, dove non gioca, non vorrebbe dire niente.
 */
export async function caricaListone(league) {
  const f = fonteDi(league);

  if (f.tipo === "tt") {
    const d = await json("./data/listone.json");
    if (!d) throw new Error("Listone non caricabile (data/listone.json)");
    return d;
  }

  const tours = f.tipo === "torneo" ? [f.tour] : (f.tours || []);
  const metas = (await Promise.all(tours.filter(Boolean).map(indiceTorneo))).filter(Boolean);
  if (!metas.length) {
    throw new Error("Archivio del torneo non disponibile");
  }

  // In un circuito lo stesso giocatore compare in piu' tornei: vale una
  // volta sola, col rating piu' alto che gli si conosce.
  const per = new Map();
  for (const m of metas) {
    for (const p of m.players || []) {
      const prima = per.get(p.id);
      if (!prima || (p.rating || 0) > (prima.rating || 0)) per.set(p.id, p);
    }
  }
  return {
    players: [...per.values()].sort((a, b) => (b.rating || 0) - (a.rating || 0)),
    fonte: f.tipo,
    tornei: metas.map((m) => ({ id: m.id, name: m.name })),
  };
}

/**
 * Il catalogo dei giocatori della lega: il listone della fonte piu' quelli
 * aggiunti a mano dall'admin.
 *
 * Stava in league.js, ma li' non poteva restare: league.js viene copiato
 * dentro le Cloud Functions per far girare l'asta anche sul server, e il
 * server non ha un `./data/` da cui leggere.
 */
export async function loadCatalog(league) {
  const listone = await caricaListone(league);
  const map = new Map();
  for (const p of listone.players || []) map.set(p.id, p);
  for (const p of Object.values(league?.customPlayers || {})) map.set(p.id, p);
  return { map, meta: listone };
}

/**
 * Le partite di una casella, per la pagina "Le tue partite".
 * @returns {Promise<{games:Array}|null>}
 */
export async function caricaPartite(slot, league) {
  const f = fonteDi(league);
  if (!slot?.id) return null;

  if (f.tipo === "tt") return json(`./data/tt/partite/${slot.id}.json`);
  if (f.tipo === "torneo") {
    const [tour, r] = String(slot.id).split("/");
    return json(`./data/bc/${tour}/partite/${r}.json`);
  }

  // Un torneo intero: i turni stanno in file separati e si prendono tutti
  // insieme. Sono piccoli e vengono dalla cache del browser la seconda volta.
  const m = await indiceTorneo(slot.id);
  if (!m) return null;
  const turni = await Promise.all((m.rounds || []).map(
    (r) => json(`./data/bc/${slot.id}/partite/r${r.n}.json`)));
  return { games: turni.filter(Boolean).flatMap((t) => t.games || []) };
}

const isoDa = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : null);

/* ---------------------------------------------------------------
   Diretta di una giornata.

   Cosa si puo' e cosa no
   ----------------------
   L'API pubblica di chess.com NON espone le partite live in corso:
   /pub/player/{u}/games elenca solo le partite DAILY, e per un giocatore
   di blitz restituisce zero. Non esiste modo ufficiale di vedere una
   scacchiera muoversi.

   Quello che si puo' avere sono le partite APPENA FINITE, dal gruppo del
   turno in corso. Una sola richiesta copre tutti i giocatori, ma e' pesante
   perche' contiene il PGN di ogni partita.

   Quanto costa davvero
   --------------------
   Misurato: 801 KB per il turno 1 (204 partite), meno per i turni finali.
   Si interroga solo il turno in corso, stimato dall'orario, e quando il
   turno avanza si riprende una volta sola quello appena chiuso per
   raccoglierne le ultime partite. Restano comunque ~40 richieste per un
   torneo intero, cioe' una trentina di megabyte: per questo la diretta
   non parte da sola e mostra sempre quanto ha consumato.
   --------------------------------------------------------------- */

import { discoverTitledTuesdays, fetchRoundGames } from "./chesscom.js";

/** Durata stimata di un turno: 11 turni in circa 2h15. */
const TURNO_MS = 12.5 * 60 * 1000;
/** Finestra in cui ha senso guardare: dall'inizio a un po' oltre la fine. */
const CODA_MS = 30 * 60 * 1000;
/**
 * Ogni 3 minuti. Un turno dura ~12, quindi lo si riprende quattro volte
 * mentre si gioca: e' il compromesso fra vedere le partite arrivare e non
 * bruciare la connessione di chi guarda dal telefono.
 */
export const INTERVALLO_MS = 3 * 60 * 1000;

const PATTE = new Set(["agreed", "repetition", "stalemate", "insufficient",
  "50move", "timevsinsufficient"]);

/** Il torneo di questa giornata si sta giocando adesso? */
export function inDiretta(slot, now = Date.now()) {
  if (!slot) return false;
  return now >= slot.start && now < slot.start + (slot.rounds || 11) * TURNO_MS + CODA_MS;
}

/** Pagina del torneo su chess.com, dove le scacchiere si muovono davvero. */
export function linkTorneo(slot) {
  return slot?.id
    ? `https://www.chess.com/tournament/live/${slot.id}`
    : "https://www.chess.com/tournaments/live";
}

/** Turno presumibilmente in corso, dall'orario di inizio. */
export function turnoStimato(slot, now = Date.now()) {
  const n = slot.rounds || 11;
  return Math.min(n, Math.max(1, Math.floor((now - slot.start) / TURNO_MS) + 1));
}

/**
 * Feed della diretta. Si accende e si spegne a mano.
 *
 * @param {object} slot   giornata dal piano stagione
 * @param {Set<string>} interessanti  username che contano per qualcuno
 * @param {function} onUpdate  chiamata a ogni cambiamento di stato
 */
export function creaFeed(slot, interessanti, onUpdate) {
  const state = {
    attivo: false,
    tournamentId: slot.id || null,
    turno: null,
    partite: [],        // accumulate fra un giro e l'altro, piu' recenti prima
    byte: 0,
    richieste: 0,
    ultimo: null,
    errore: null,
    cercando: false,
  };

  const viste = new Set();          // url gia' raccolti, per non duplicare
  const chiusi = new Set();         // turni gia' ripresi dopo la chiusura
  let timer = null;
  let ultimoTurnoVisto = null;

  const notifica = () => onUpdate({ ...state, partite: [...state.partite] });

  async function trovaTorneo() {
    if (state.tournamentId) return state.tournamentId;
    state.cercando = true;
    notifica();
    try {
      // includeLive: durante il torneo l'evento non e' ancora fra i finiti.
      const trovati = await discoverTitledTuesdays(6, true);
      const match = trovati.find((e) => e.date === slot.date);
      state.tournamentId = match?.id || null;
      if (!state.tournamentId) {
        state.errore = "Non trovo il torneo di oggi su chess.com. "
          + "Può darsi che non sia ancora cominciato.";
      }
    } catch (err) {
      state.errore = "chess.com non risponde: " + err.message;
    } finally {
      state.cercando = false;
    }
    return state.tournamentId;
  }

  async function prendiTurno(r) {
    const out = await fetchRoundGames(state.tournamentId, r);
    state.byte += out.bytes;
    state.richieste += 1;
    if (!out.ok) return 0;

    let nuove = 0;
    for (const g of out.games) {
      const w = (g.white?.username || "").toLowerCase();
      const b = (g.black?.username || "").toLowerCase();
      // Rilevante solo se almeno uno dei due e' in rosa a qualcuno.
      if (!interessanti.has(w) && !interessanti.has(b)) continue;
      if (viste.has(g.url)) continue;
      viste.add(g.url);
      state.partite.unshift({
        url: g.url,
        turno: r,
        fine: g.end_time || 0,
        bianco: w, nero: b,
        ratingBianco: g.white?.rating || null,
        ratingNero: g.black?.rating || null,
        esito: esitoDi(g),
      });
      nuove += 1;
    }
    state.partite.sort((a, b) => (b.fine || 0) - (a.fine || 0));
    return nuove;
  }

  async function giro() {
    if (!state.attivo) return;
    if (!(await trovaTorneo())) { notifica(); return; }

    const r = turnoStimato(slot);
    state.turno = r;
    try {
      // Quando il turno avanza, si riprende una volta sola quello appena
      // chiuso: le sue ultime partite sono finite dopo l'ultimo controllo.
      if (ultimoTurnoVisto !== null && r > ultimoTurnoVisto && !chiusi.has(ultimoTurnoVisto)) {
        chiusi.add(ultimoTurnoVisto);
        await prendiTurno(ultimoTurnoVisto);
      }
      await prendiTurno(r);
      ultimoTurnoVisto = r;
      state.errore = null;
    } catch (err) {
      state.errore = err.message;
    }
    state.ultimo = Date.now();
    notifica();
  }

  return {
    get state() { return state; },
    avvia() {
      if (state.attivo) return;
      state.attivo = true;
      notifica();
      giro();
      timer = setInterval(giro, INTERVALLO_MS);
    },
    ferma() {
      state.attivo = false;
      clearInterval(timer);
      timer = null;
      notifica();
    },
    aggiornaOra() { giro(); },
  };
}

function esitoDi(g) {
  const wr = g.white?.result || "";
  const br = g.black?.result || "";
  if (wr === "win") return "w";
  if (br === "win") return "b";
  if (PATTE.has(wr) || PATTE.has(br)) return "d";
  return "?";
}

export function formattaByte(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

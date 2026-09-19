/* ---------------------------------------------------------------
   Lettura diretta delle dirette di Lichess.

   E' il ripiego per la finestra fra "il turno e' finito" e "l'archivio e'
   passato". Coi Titled Tuesday quella finestra dura fino al mercoledi'
   mattina e la copre chesscom.js; qui conta di piu', perche' un torneo
   classico gioca un turno al giorno e aspettare la CI vorrebbe dire vedere
   i punti con un giorno di ritardo tutti i giorni.

   Si puo' fare dal browser perche' gli endpoint /api/ di Lichess mandano
   CORS `*`. Il PGN di un turno sono poche decine di kilobyte e contiene
   tutto quello che serve: giocatori, Elo, risultato.

   Nota: qui il piazzamento resta nullo. Per saperlo servirebbero tutti i
   turni precedenti, e in una lega dove una giornata e' un turno il
   piazzamento vale pochi punti: non merita mezzo mega di PGN.
   --------------------------------------------------------------- */

import { indiceTorneo } from "./fonte.js";

const API = "https://lichess.org/api";

/** Stesso valore della CI: la stessa impresa non puo' valere diversamente. */
const UPSET_MIN = 100;

const TAG = /^\[([A-Za-z0-9_]+)\s+"(.*)"\]\s*$/gm;

/**
 * Dove finisce una partita e comincia la prossima: riga vuota seguita da
 * `[Event`. Dentro le mosse quella sequenza non compare mai, mentre un
 * taglio sulla sola riga vuota separerebbe le intestazioni dalle mosse.
 */
const SEPARATORE = /\n\n(?=\[Event )/;

/** Spezza un PGN nelle sue partite, tenendo solo le intestazioni. */
export function partiteDaPgn(pgn) {
  const fuori = [];
  for (const blocco of String(pgn || "").trim().split(SEPARATORE)) {
    if (!blocco.trim()) continue;
    const g = {};
    TAG.lastIndex = 0;
    let m;
    while ((m = TAG.exec(blocco)) !== null) g[m[1]] = m[2];
    if (Object.keys(g).length) fuori.push(g);
  }
  return fuori;
}

/** L'identita' di uno scacchista: FIDE id, o il nome se manca. Come nella CI. */
export function chiaveGiocatore(g, colore) {
  const fid = (g[`${colore}FideId`] || "").trim();
  if (/^\d+$/.test(fid) && fid !== "0") return `fide:${fid}`;
  const nome = (g[colore] || "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return nome ? `nome:${nome}` : "";
}

const elo = (g, colore) => Number(g[`${colore}Elo`]) || 0;
const esitoDi = (g) => ({ "1-0": "w", "0-1": "b", "1/2-1/2": "d" })[g.Result] || null;

/**
 * Una partita sola, col suo PGN completo, presa dal turno che la contiene.
 *
 * Una chiamata copre tutto il turno — cinquanta partite dei Candidati sono
 * trenta kilobyte — quindi si tiene da parte: chi apre tre partite dello
 * stesso turno scarica una volta.
 */
const turniInMemoria = new Map();

export async function partitaDelTurno(roundId, gameId) {
  if (!turniInMemoria.has(roundId)) {
    turniInMemoria.set(roundId, pgnTurno(roundId).catch(() => ""));
  }
  const pgn = await turniInMemoria.get(roundId);

  for (const blocco of String(pgn || "").trim().split(SEPARATORE)) {
    if (!blocco.includes(`/${gameId}"`)) continue;
    const url = (blocco.match(/\[GameURL "([^"]+)"\]/) || [])[1] || "";
    return { pgn: blocco, url };
  }
  return null;
}

async function pgnTurno(roundId) {
  const res = await fetch(`${API}/broadcast/round/${roundId}.pgn`);
  if (!res.ok) throw new Error(`turno non disponibile (${res.status})`);
  return res.text();
}

/**
 * I risultati di una casella, letti dalla diretta invece che dall'archivio.
 *
 * @param slot   la casella del piano (id "<torneo>/rN" oppure "<torneo>")
 * @param fonte  la fonte normalizzata della lega
 * @returns lo stesso contratto dei file statici, con `live: true`
 */
export async function turnoDiretto(slot, fonte, onProgress = () => {}) {
  try {
    const perTurno = fonte?.tipo === "torneo";
    const tour = perTurno ? String(slot.id).split("/")[0] : String(slot.id);
    const meta = await indiceTorneo(tour);
    if (!meta) return null;

    const turni = perTurno
      ? (meta.rounds || []).filter((r) => `${tour}/r${r.n}` === slot.id)
      : (meta.rounds || []);
    if (!turni.length) return null;

    onProgress(turni.length === 1
      ? "Leggo il turno su Lichess…"
      : `Leggo ${turni.length} turni su Lichess…`);

    const pgns = await Promise.all(turni.map((r) => pgnTurno(r.id)));

    const punti = new Map();
    const h2h = [];
    const upsets = [];

    pgns.forEach((pgn, i) => {
      const n = turni[i].n;
      for (const g of partiteDaPgn(pgn)) {
        const w = chiaveGiocatore(g, "White");
        const b = chiaveGiocatore(g, "Black");
        const e = esitoDi(g);
        if (!w || !b || !e) continue;      // partita in corso o rinviata

        punti.set(w, (punti.get(w) || 0) + (e === "w" ? 1 : e === "d" ? 0.5 : 0));
        punti.set(b, (punti.get(b) || 0) + (e === "b" ? 1 : e === "d" ? 0.5 : 0));
        h2h.push([w, b, e, n]);

        if (e !== "d") {
          const gap = e === "w" ? elo(g, "Black") - elo(g, "White")
            : elo(g, "White") - elo(g, "Black");
          if (gap >= UPSET_MIN) upsets.push([e === "w" ? w : b, Math.round(gap), n]);
        }
      }
    });

    if (!punti.size) return null;

    const standings = new Map();
    for (const [pid, p] of punti) standings.set(pid, { points: p, rank: null });

    return {
      standings, h2h, upsets,
      rounds: perTurno ? 1 : (meta.rounds || []).length,
      total: (meta.players || []).length || punti.size,
      live: true,
    };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------
   Calcolo dei fantapunti.

   Regola di lettura: il punteggio grezzo del torneo (0..11) e' la base,
   tutto il resto sono bonus/malus. Chi non ha giocato viene sostituito
   dal primo panchinaro disponibile, esattamente come nel fantacalcio.
   --------------------------------------------------------------- */

import { SCORING } from "./config.js";

/**
 * Punteggio di un singolo giocatore in una giornata.
 * @param {{played:boolean, points:number, rank:number|null}|null} res
 * @param {object} rules
 * @param {number} rounds turni del torneo (per capire cos'e' "en plein")
 */
export function scorePlayer(res, rules = SCORING, rounds = 11) {
  if (!res || !res.played) {
    return { total: rules.absent, absent: true, breakdown: [] };
  }

  const pts = Number(res.points) || 0;
  const breakdown = [
    { label: `${fmtScore(pts)}/${rounds} nel torneo`, pts: pts * rules.perPoint },
  ];

  if (res.rank) {
    const tier = rules.placement.find((t) => res.rank <= t.max);
    if (tier) {
      breakdown.push({ label: `${ordinale(res.rank)} posto`, pts: tier.bonus });
    }
  }

  if (pts >= rounds) {
    breakdown.push({ label: "En plein", pts: rules.perfectScore });
  } else if (pts >= rules.strongScoreMin) {
    breakdown.push({ label: `Almeno ${fmtScore(rules.strongScoreMin)} punti`, pts: rules.strongScore });
  }

  if (pts < rules.weakScoreMax) {
    breakdown.push({ label: `Sotto ${fmtScore(rules.weakScoreMax)} punti`, pts: rules.weakScore });
  }

  const total = breakdown.reduce((s, b) => s + b.pts, 0);
  return { total: round1(total), absent: false, breakdown };
}

/**
 * Punteggio di una formazione intera.
 *
 * @param {{starters:string[], bench:string[], captain:string}} lineup
 * @param {Map<string, object>} results  playerId -> risultato grezzo
 * @returns {{total:number, rows:Array, subs:Array}}
 */
export function scoreLineup(lineup, results, rules = SCORING, rounds = 11) {
  const starters = lineup?.starters || [];
  const bench = lineup?.bench || [];
  const captain = lineup?.captain || null;

  const usedBench = new Set();
  const rows = [];
  const subs = [];

  for (const pid of starters) {
    const raw = results.get(pid) || null;
    let score = scorePlayer(raw, rules, rounds);
    let effective = pid;
    let subbedFrom = null;

    if (score.absent) {
      // Primo panchinaro che ha effettivamente giocato.
      const rep = bench.find((b) => !usedBench.has(b) && results.get(b)?.played);
      if (rep) {
        usedBench.add(rep);
        subbedFrom = pid;
        effective = rep;
        score = scorePlayer(results.get(rep), rules, rounds);
        subs.push({ out: pid, in: rep });
      }
    }

    // Il bonus capitano si perde se il capitano non ha giocato.
    const isCaptain = pid === captain;
    const captainApplies = isCaptain && !subbedFrom && !score.absent;
    const total = captainApplies ? round1(score.total * rules.captainMultiplier) : score.total;

    rows.push({
      slot: pid,
      playerId: effective,
      subbedFrom,
      isCaptain,
      captainApplied: captainApplies,
      absent: score.absent,
      raw: raw,
      breakdown: score.breakdown,
      base: score.total,
      total,
    });
  }

  return {
    total: round1(rows.reduce((s, r) => s + r.total, 0)),
    rows,
    subs,
  };
}

/* ---------------------------- scontri diretti --------------------------- */

/**
 * Punteggio di una giornata per TUTTA la lega.
 *
 * Gli scontri diretti non si possono calcolare giocatore per giocatore:
 * dipendono da chi hanno schierato gli altri. Serve quindi una passata
 * sull'intera giornata, ed e' questa.
 *
 * @param {Map<string,object>} lineups  uid -> formazione valida
 * @param {Map<string,object>} results  playerId -> risultato grezzo
 * @param {Array} h2h  partite [bianco, nero, "w"|"b"|"d", turno]
 * @returns {Map<string,{total,rows,duels}>}
 */
export function scoreMatchday(lineups, results, h2h = [], rules = SCORING, rounds = 11) {
  const out = new Map();

  // Chi e' sceso in campo per chi. Conta il giocatore EFFETTIVO, quindi
  // anche il panchinaro entrato al posto di un assente.
  const owner = new Map();
  for (const [uid, lu] of lineups) {
    const sc = scoreLineup(lu, results, rules, rounds);
    out.set(uid, { total: sc.total, rows: sc.rows, duels: [] });
    for (const r of sc.rows) {
      if (!r.absent) owner.set(r.playerId, uid);
    }
  }

  for (const [w, b, res] of h2h || []) {
    const uw = owner.get(w);
    const ub = owner.get(b);
    // Serve che entrambi siano in campo, e per due persone diverse:
    // due tuoi giocatori che si incontrano sono una partita di giro.
    if (!uw || !ub || uw === ub) continue;

    const esito = res === "w" ? [rules.duelWin, rules.duelLoss]
      : res === "b" ? [rules.duelLoss, rules.duelWin]
      : [rules.duelDraw, rules.duelDraw];

    registra(out, uw, w, b, ub, esito[0], res === "d" ? "patta" : res === "w" ? "vinto" : "perso");
    registra(out, ub, b, w, uw, esito[1], res === "d" ? "patta" : res === "b" ? "vinto" : "perso");
  }

  for (const v of out.values()) {
    v.total = round1(v.total + v.duels.reduce((s, d) => s + d.pts, 0));
  }
  return out;
}

function registra(out, uid, mine, opp, oppUid, pts, esito) {
  const e = out.get(uid);
  if (!e) return;
  e.duels.push({ playerId: mine, oppId: opp, oppUid, pts, esito });
}

/** Trasforma la classifica di chess.com nella mappa risultati dei propri giocatori. */
export function resultsFromStandings(playerIds, standings, total) {
  const map = new Map();
  for (const pid of playerIds) {
    const s = standings.get(pid);
    map.set(pid, s
      ? { played: true, points: s.points, rank: s.rank, total }
      : { played: false, points: 0, rank: null, total });
  }
  return map;
}

const round1 = (n) => Math.round(n * 10) / 10;
const fmtScore = (n) => (Number.isInteger(n) ? String(n) : String(n));

function ordinale(n) { return `${n}°`; }

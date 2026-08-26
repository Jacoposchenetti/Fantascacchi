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

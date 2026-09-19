/* ---------------------------------------------------------------
   Calcolo dei fantapunti.

   Regola di lettura: il punteggio grezzo del torneo (0..11) e' la base,
   tutto il resto sono bonus/malus. Chi non ha giocato viene sostituito
   dal primo panchinaro disponibile, esattamente come nel fantacalcio.
   --------------------------------------------------------------- */

import { SCORING, SCORING_TURNO, SCORING_CLASSICO } from "./config.js";
import { fonteDi } from "./fonte.js";

/**
 * Punteggio di un singolo giocatore in una giornata.
 * @param {{played:boolean, points:number, rank:number|null}|null} res
 * @param {object} rules
 * @param {number} rounds turni del torneo (per capire cos'e' "en plein")
 */
export function regole(league) {
  const tipo = fonteDi(league).tipo;
  if (tipo === "torneo") return SCORING_TURNO;
  if (tipo === "circuito") return SCORING_CLASSICO;
  return SCORING;
}

export function scorePlayer(res, rules = SCORING, rounds = 11) {
  if (!res || !res.played) {
    return { total: rules.absent, absent: true, breakdown: [] };
  }

  // Una partita sola non si giudica come un torneo di undici: ha una
  // tabella sua, qui accanto.
  if (rules.modo === "turno") return puntiDelTurno(res, rules);

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

  // I tornei classici durano da nove a tredici turni: le soglie si dicono
  // in frazione, altrimenti "almeno 9 punti" e' un traguardo in un torneo
  // e l'en plein in quello dopo.
  const soglieAlta = rules.strongRatio != null
    ? arrotondaMezzo(rounds * rules.strongRatio) : rules.strongScoreMin;
  const sogliaBassa = rules.weakRatio != null
    ? arrotondaMezzo(rounds * rules.weakRatio) : rules.weakScoreMax;

  if (pts >= rounds) {
    breakdown.push({ label: "En plein", pts: rules.perfectScore });
  } else if (pts >= soglieAlta) {
    breakdown.push({ label: `Almeno ${fmtScore(soglieAlta)} punti`, pts: rules.strongScore });
  }

  if (pts < sogliaBassa) {
    breakdown.push({ label: `Sotto ${fmtScore(sogliaBassa)} punti`, pts: rules.weakScore });
  }

  const impresa = bonusImprese(res.upsets, rules);
  if (impresa) breakdown.push(impresa);

  const total = breakdown.reduce((s, b) => s + b.pts, 0);
  return { total: round1(total), absent: false, breakdown };
}

/**
 * Punteggio di un giocatore in UN TURNO di torneo classico.
 *
 * `res.points` vale 1, 0.5 o 0 — il risultato della sua partita — e
 * `res.color` dice da che parte stava, perche' vincere col nero vale di
 * piu'. Il piazzamento e' quello nel torneo dopo il turno: dice se il tuo
 * sta comandando, che e' l'informazione che uno cerca a fine giornata.
 */
function puntiDelTurno(res, rules) {
  const pts = Number(res.points) || 0;
  const esito = pts >= 1 ? "vinta" : pts > 0 ? "patta" : "persa";

  const breakdown = [{
    label: { vinta: "Vittoria", patta: "Patta", persa: "Sconfitta" }[esito],
    pts: { vinta: rules.win, patta: rules.draw, persa: rules.loss }[esito],
  }];

  if (esito === "vinta" && res.color === "b") {
    breakdown.push({ label: "Vittoria col nero", pts: rules.neroBonus });
  }

  if (res.rank === 1) {
    breakdown.push({ label: "In testa al torneo", pts: rules.leader });
  } else if (res.rank && res.rank <= 3) {
    breakdown.push({ label: `${res.rank}° nel torneo`, pts: rules.podio });
  }

  const bonus = bonusImprese(res.upsets, rules);
  if (bonus) breakdown.push(bonus);

  return {
    total: round1(breakdown.reduce((s, b) => s + b.pts, 0)),
    absent: false,
    breakdown,
  };
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
  const vice = lineup?.vice || null;

  /**
   * Chi porta davvero la fascia: il capitano se e' sceso in campo,
   * altrimenti il vice — purche' sia un titolare e abbia giocato pure lui.
   *
   * Va deciso PRIMA del giro sui titolari: il vice puo' venire prima del
   * capitano nell'elenco, e ci si ritroverebbe a raddoppiarlo senza ancora
   * sapere se il capitano c'era.
   *
   * Chi entra dalla panchina non eredita mai niente: la fascia si assegna
   * prima del torneo, non a risultati visti.
   */
  const haGiocato = (pid) => Boolean(pid && results.get(pid)?.played);
  const conFascia = haGiocato(captain) ? captain
    : (vice && haGiocato(vice)) ? vice
    : null;

  /*
     Il vice in panchina non ha bisogno di regole speciali: sta in cima
     alla lista, quindi e' gia' il primo a entrare.

     Ci avevo messo un meccanismo che lo teneva da parte apposta per il
     capitano, ed era sia superfluo sia peggiore: con il capitano presente
     e un altro titolare assente, il vice restava seduto mentre entrava
     qualcun altro. Un giocatore disponibile lasciato fuori per niente.
  */

  const usedBench = new Set();
  const rows = [];
  const subs = [];

  for (const pid of starters) {
    const raw = results.get(pid) || null;
    let score = scorePlayer(raw, rules, rounds);
    let effective = pid;
    let subbedFrom = null;

    if (score.absent) {
      // Il primo della panchina che ha effettivamente giocato.
      const rep = bench.find((b) => !usedBench.has(b) && haGiocato(b));
      if (rep) {
        usedBench.add(rep);
        subbedFrom = pid;
        effective = rep;
        score = scorePlayer(results.get(rep), rules, rounds);
        subs.push({ out: pid, in: rep });
      }
    }

    const isCaptain = pid === captain;
    const isVice = effective === vice;
    // Si guarda CHI E' SCESO IN CAMPO, non il titolare di partenza: se la
    // fascia e' passata a un vice entrato dalla panchina, il raddoppio deve
    // seguirlo. Un sostituto qualsiasi non combacia mai con `conFascia`,
    // quindi non eredita niente.
    const captainApplies = Boolean(conFascia) && effective === conFascia && !score.absent;
    const total = captainApplies ? round1(score.total * rules.captainMultiplier) : score.total;

    rows.push({
      slot: pid,
      playerId: effective,
      subbedFrom,
      isCaptain,
      isVice,
      // Vero quando la fascia si e' spostata sul vice: serve a spiegarlo
      // nel dettaglio, altrimenti uno guarda i punti e non capisce.
      viceSubentrato: captainApplies && conFascia === vice && captain !== vice,
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

/**
 * Imprese: ogni partita vinta contro un avversario molto piu' forte.
 * `upsets` e' la lista dei divari di rating (es. [180, 260]).
 */
function bonusImprese(upsets, rules) {
  const imprese = Array.isArray(upsets) ? upsets : [];
  let tot = 0;
  for (const gap of imprese) {
    const t = rules.upset.find((x) => gap >= x.gap);
    if (t) tot += t.bonus;
  }
  tot = Math.min(tot, rules.upsetCap);
  if (tot <= 0) return null;
  const n = imprese.filter((g) => g >= rules.upset[rules.upset.length - 1].gap).length;
  return { label: `${n} impres${n === 1 ? "a" : "e"} (batte più forti)`, pts: tot };
}

const round1 = (n) => Math.round(n * 10) / 10;
/** Alle mezze unita': i punteggi degli scacchi non hanno decimali diversi. */
const arrotondaMezzo = (n) => Math.round(n * 2) / 2;
const fmtScore = (n) => (Number.isInteger(n) ? String(n) : String(n));

function ordinale(n) { return `${n}°`; }

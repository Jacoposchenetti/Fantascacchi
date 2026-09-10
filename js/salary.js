/* ---------------------------------------------------------------
   Salary cap.

   Nessun turno, nessuna offerta: ogni giocatore ha un prezzo fisso —
   la valutazione del listone — e ognuno compone la rosa entro il budget,
   quando vuole, entro una scadenza. Le rose NON sono esclusive: lo stesso
   giocatore puo' stare in piu' squadre.

   Le rose stanno in `salaryRosters[uid]` come { playerId: prezzo }.
   `js/league.js` legge tutto da li' quando auctionMode e' "salary", quindi
   il resto dell'app non cambia.

   Alla scadenza, chi non ha completato si vede riempire la rosa con i
   giocatori piu' economici che entrano nel budget, e parte la stagione.
   --------------------------------------------------------------- */

import { members, ownedCount, spentBy } from "./league.js";
import { DEFAULTS } from "./config.js";

/** Quanto budget resta a un partecipante. */
export function budgetSalary(league, uid) {
  return (league.budget || 0) - spentBy(league, uid);
}

/** Un giocatore ci sta nella mia rosa? (prezzo entro budget e c'e' posto) */
export function puoiPrendere(league, uid, prezzo) {
  return ownedCount(league, uid) < league.rosterSize
    && prezzo <= budgetSalary(league, uid);
}

export function prossimaScadenzaSalary(league, now = Date.now()) {
  return now + (league.salaryDays || DEFAULTS.salaryDays) * 24 * 3600 * 1000;
}

/** Tutti hanno la rosa piena? */
export function tuttiCompleti(league) {
  return members(league).every((m) => ownedCount(league, m.uid) >= league.rosterSize);
}

/**
 * Aggiunge o toglie un giocatore dalla mia rosa. Da usare in transazione.
 * @returns lo stato nuovo, o null se la mossa non e' valida.
 */
export function togglePlayer(lg, uid, playerId, prezzo) {
  if (lg.phase !== "auction" || lg.auctionMode !== "salary") return null;
  const mia = { ...(lg.salaryRosters?.[uid] || {}) };

  if (mia[playerId] !== undefined) {
    delete mia[playerId];
  } else {
    if (ownedCount(lg, uid) >= lg.rosterSize) return null;
    const restante = (lg.budget || 0) - Object.values(mia).reduce((s, v) => s + v, 0);
    if (prezzo > restante) return null;
    mia[playerId] = prezzo;
  }

  lg.salaryRosters = { ...(lg.salaryRosters || {}), [uid]: mia };
  return lg;
}

/**
 * Chiude la finestra: completa d'ufficio chi non ha finito e avvia la
 * stagione. Idempotente — il primo client che vede la scadenza lo fa.
 *
 * @param liberiPerPrezzo  [{ id, price }] di TUTTO il listone, dal piu'
 *        economico: da qui si pescano i riempitivi.
 */
export function chiudiSalary(lg, liberiPerPrezzo) {
  if (lg.phase !== "auction" || lg.auctionMode !== "salary") return null;

  const rosters = { ...(lg.salaryRosters || {}) };
  for (const m of members(lg)) {
    const mia = { ...(rosters[m.uid] || {}) };
    let spesi = Object.values(mia).reduce((s, v) => s + v, 0);
    for (const p of liberiPerPrezzo) {
      if (Object.keys(mia).length >= lg.rosterSize) break;
      if (mia[p.id] !== undefined) continue;
      if (spesi + p.price > (lg.budget || 0)) continue;
      mia[p.id] = p.price;
      spesi += p.price;
    }
    rosters[m.uid] = mia;
  }

  lg.salaryRosters = rosters;
  lg.salary = { ...(lg.salary || {}), deadline: 0, chiusoIl: Date.now() };
  lg.phase = "season";
  lg.season = { startsAt: Date.now(), matchdays: lg.season?.matchdays || DEFAULTS.matchdays };
  return lg;
}

/** Scadenza leggibile. */
export function mancaAllaSalary(deadline, now = Date.now()) {
  const ms = deadline - now;
  if (ms <= 0) return "scaduta";
  const g = Math.floor(ms / (24 * 3600 * 1000));
  const h = Math.floor((ms % (24 * 3600 * 1000)) / 3600000);
  if (g >= 1) return `${g} giorn${g === 1 ? "o" : "i"} e ${h} ore`;
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

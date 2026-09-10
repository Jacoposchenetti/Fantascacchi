/* ---------------------------------------------------------------
   Draft a serpentina.

   Niente soldi: a turno ognuno sceglie un giocatore libero, e l'ordine
   si inverte a ogni giro (1-2-3-4, poi 4-3-2-1, poi 1-2-3-4...). Le rose
   restano esclusive come in un'asta, quindi a valle il resto del codice
   non cambia: un giocatore scelto entra in `roster` col suo valore di
   listino come prezzo, solo per avere un numero da mostrare.

   Non si blocca: allo scadere del tempo il giocatore piu' quotato ancora
   libero viene assegnato d'ufficio a chi tocca.
   --------------------------------------------------------------- */

import { members, ownedCount } from "./league.js";
import { DEFAULTS } from "./config.js";

/** L'ordine di scelta a un dato giro: dritto ai giri dispari, rovescio ai pari. */
export function ordineGiro(order, round) {
  return round % 2 === 1 ? [...order] : [...order].reverse();
}

/** L'ordine base, per data d'ingresso. Fissato quando parte il draft. */
export function ordineBase(league) {
  return members(league).map((m) => m.uid);
}

/** Quante scelte in tutto: partecipanti x posti in rosa. */
export function totalePick(league) {
  return members(league).length * (league.rosterSize || 0);
}

/** A chi tocca adesso, o null se il draft e' finito. */
export function chiSceglie(league) {
  const d = league.draft || {};
  const order = d.order?.length ? d.order : ordineBase(league);
  if (!order.length) return null;
  if ((d.round || 1) > (league.rosterSize || 0)) return null;
  return ordineGiro(order, d.round || 1)[d.pickIdx || 0] || null;
}

/** Numero della scelta complessiva in corso (1-based), per la UI. */
export function numeroPick(league) {
  const d = league.draft || {};
  const n = (d.order?.length || ordineBase(league).length);
  return ((d.round || 1) - 1) * n + (d.pickIdx || 0) + 1;
}

/** Millisecondi rimasti a chi deve scegliere; null se non c'e' scadenza. */
export function tempoPick(league, now = Date.now()) {
  const end = league.draft?.turnEndsAt || 0;
  return end ? Math.max(0, end - now) : null;
}

export function prossimaScadenza(league, now = Date.now()) {
  return now + (league.draftSeconds || DEFAULTS.draftSeconds) * 1000;
}

/**
 * Registra una scelta. Da usare dentro una transazione.
 * @returns lo stato nuovo, o null se la scelta non e' valida (turno sbagliato,
 *          giocatore gia' preso, ecc.)
 */
export function scegli(lg, uid, playerId, valore) {
  if (lg.phase !== "auction" || lg.auctionMode !== "draft") return null;
  if (chiSceglie(lg) !== uid) return null;
  if (lg.roster?.[playerId]) return null;
  if (ownedCount(lg, uid) >= lg.rosterSize) return null;

  lg.roster = {
    ...lg.roster,
    [playerId]: { playerId, ownerUid: uid, price: valore || 0, at: Date.now() },
  };
  return avanza(lg);
}

/** Sposta il turno alla scelta successiva, chiudendo il draft se era l'ultima. */
export function avanza(lg) {
  const d = lg.draft || {};
  const order = d.order?.length ? d.order : ordineBase(lg);
  let pickIdx = (d.pickIdx || 0) + 1;
  let round = d.round || 1;
  if (pickIdx >= order.length) { pickIdx = 0; round += 1; }

  const finito = round > lg.rosterSize;
  lg.draft = {
    ...d, order, round, pickIdx,
    turnEndsAt: finito ? 0 : Date.now() + (lg.draftSeconds || DEFAULTS.draftSeconds) * 1000,
  };
  if (finito) {
    lg.phase = "season";
    lg.season = { startsAt: Date.now(), matchdays: lg.season?.matchdays || DEFAULTS.matchdays };
  }
  return lg;
}

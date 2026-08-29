/* Stato derivato della lega: catalogo giocatori, proprieta', budget, presenza. */

import { PRESENCE_TTL } from "./config.js";

let _listone = null;

/** Carica il listone (una volta) e lo fonde con eventuali giocatori aggiunti a mano. */
export async function loadCatalog(league) {
  if (!_listone) {
    const res = await fetch("./data/listone.json");
    if (!res.ok) throw new Error("Listone non caricabile (data/listone.json)");
    _listone = await res.json();
  }
  const map = new Map();
  for (const p of _listone.players) map.set(p.id, p);
  for (const p of Object.values(league?.customPlayers || {})) map.set(p.id, p);
  return { map, meta: _listone };
}

export function catalogList(catalog) {
  return [...catalog.map.values()];
}

/** uid del proprietario di un giocatore, o null se ancora libero. */
export function ownerOf(league, pid) {
  return league?.roster?.[pid]?.ownerUid || null;
}

/** Rosa di un partecipante: [{player, price, at}] ordinata per prezzo. */
export function rosterOf(league, catalog, uid) {
  return Object.values(league?.roster || {})
    .filter((r) => r.ownerUid === uid)
    .map((r) => ({ ...r, player: catalog.map.get(r.playerId) }))
    .filter((r) => r.player)
    .sort((a, b) => b.price - a.price);
}

export function spentBy(league, uid) {
  return Object.values(league?.roster || {})
    .filter((r) => r.ownerUid === uid)
    .reduce((s, r) => s + (r.price || 0), 0);
}

export function ownedCount(league, uid) {
  return Object.values(league?.roster || {}).filter((r) => r.ownerUid === uid).length;
}

export function budgetLeft(league, uid) {
  return (league?.budget || 0) - spentBy(league, uid);
}

/**
 * Rilancio massimo consentito: bisogna conservare almeno 1 credito
 * per ogni casella di rosa ancora da riempire dopo questo acquisto.
 */
export function maxBid(league, uid) {
  const slotsLeft = (league?.rosterSize || 0) - ownedCount(league, uid);
  if (slotsLeft <= 0) return 0;
  return Math.max(0, budgetLeft(league, uid) - (slotsLeft - 1));
}

/* ------------------------------- presenza ------------------------------ */

/**
 * Online = ha dato un segno di vita da meno di PRESENCE_TTL.
 * Volutamente approssimativo: serve a sapere se vale la pena aspettare
 * qualcuno, non a fare contabilita'.
 */
export function isOnline(presence, uid, now = Date.now()) {
  const at = presence?.[uid] || 0;
  return now - at < PRESENCE_TTL;
}

export function onlineCount(league, presence) {
  return members(league).filter((m) => isOnline(presence, m.uid)).length;
}

/* ------------------------------- membri -------------------------------- */

export function members(league) {
  return Object.values(league?.members || {})
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
}

export function memberName(league, uid) {
  return league?.members?.[uid]?.name || "Sconosciuto";
}

export function isAdmin(league, uid) {
  return league?.adminUid === uid;
}

/** Tutti hanno la rosa piena? */
export function auctionComplete(league) {
  return members(league).every((m) => ownedCount(league, m.uid) >= league.rosterSize);
}

/** uid di chi ha il turno di nomina all'asta (chiamata a giro, salta chi ha finito). */
export function nominator(league) {
  const ms = members(league).filter((m) => ownedCount(league, m.uid) < league.rosterSize);
  if (!ms.length) return null;
  return ms[(league.auction?.turnIdx || 0) % ms.length].uid;
}

/** Millisecondi rimasti a chi deve chiamare; 0 se il tempo e' finito. */
export function turnLeft(league, now = Date.now()) {
  const end = league?.auction?.turnEndsAt || 0;
  if (!end) return null;             // turno senza scadenza (leghe vecchie)
  return Math.max(0, end - now);
}

/** Istante di scadenza del prossimo turno di chiamata. */
export function nextTurnDeadline(league, now = Date.now()) {
  return now + (league?.turnSeconds || 60) * 1000;
}

/** Link d'invito assoluto, funziona anche in sottocartella su GitHub Pages. */
export function inviteLink(leagueId) {
  const base = location.href.split("#")[0];
  return `${base}#/join/${leagueId}`;
}

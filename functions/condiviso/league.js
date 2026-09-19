/* GENERATO DA tools/sync_condiviso.mjs — NON MODIFICARE QUI.
   La sorgente e' js/league.js: modifica quella e rilancia lo script
   (parte da sola a ogni "firebase deploy"). */
/* Stato derivato della lega: catalogo giocatori, proprieta', budget, presenza. */

import { PRESENCE_TTL } from "./config.js";


export function catalogList(catalog) {
  return [...catalog.map.values()];
}

/** uid del proprietario di un giocatore, o null se ancora libero. */
/**
 * Voci di rosa di un partecipante: [{ playerId, price, at }].
 * Unico punto che sa dove stanno le rose in ogni modalita': live/sealed/draft
 * usano `roster` (esclusivo, un giocatore un proprietario), salary usa
 * `salaryRosters` (non esclusivo).
 */
/**
 * La fonte di una lega, normalizzata.
 *
 * Sta qui e non in fonte.js perche' league.js e' fra i moduli copiati
 * dentro le Cloud Functions: l'asta a buste la risolve anche il server, e
 * deve sapere da che listone pescare. Due definizioni di "fonte" che
 * divergono vorrebbero dire due aste che assegnano giocatori diversi.
 *
 * Le leghe create prima che esistessero le altre fonti non hanno il campo:
 * sono Titled Tuesday, e continuano a funzionare senza che nessuno le tocchi.
 */
export function fonteDi(league) {
  const f = league?.fonte;
  if (!f || !f.tipo || f.tipo === "tt") return { tipo: "tt" };
  if (f.tipo === "torneo") return { tipo: "torneo", tour: f.tour || null };
  if (f.tipo === "circuito") return { tipo: "circuito", tours: f.tours || [] };
  return { tipo: "tt" };
}

export function rosterEntries(league, uid) {
  if (league?.auctionMode === "salary") {
    return Object.entries(league?.salaryRosters?.[uid] || {})
      .map(([playerId, price]) => ({ playerId, price: Number(price) || 0, at: 0 }));
  }
  return Object.values(league?.roster || {}).filter((r) => r.ownerUid === uid);
}

/** Tutti i playerId in rosa a qualcuno, senza duplicati. Per il calcolo punti. */
export function allOwnedPlayerIds(league) {
  const out = new Set();
  if (league?.auctionMode === "salary") {
    for (const r of Object.values(league?.salaryRosters || {})) {
      for (const pid of Object.keys(r || {})) out.add(pid);
    }
  } else {
    for (const r of Object.values(league?.roster || {})) out.add(r.playerId);
  }
  return [...out];
}

/**
 * uid del proprietario ESCLUSIVO di un giocatore, o null.
 * In salary cap nessuno lo possiede in esclusiva, quindi sempre null.
 */
export function ownerOf(league, pid) {
  if (league?.auctionMode === "salary") return null;
  return league?.roster?.[pid]?.ownerUid || null;
}

/** Rosa di un partecipante: [{player, price, at}] ordinata per prezzo. */
export function rosterOf(league, catalog, uid) {
  return rosterEntries(league, uid)
    .map((r) => ({ ...r, player: catalog.map.get(r.playerId) }))
    .filter((r) => r.player)
    .sort((a, b) => b.price - a.price);
}

export function spentBy(league, uid) {
  return rosterEntries(league, uid).reduce((s, r) => s + (r.price || 0), 0);
}

export function ownedCount(league, uid) {
  return rosterEntries(league, uid).length;
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

/* ---------------------------- forma recente ---------------------------- */

/**
 * Presenza nelle ultime `n` giornate, dalla piu' vecchia alla piu' recente.
 *
 * Serve a decidere chi schierare: le iscrizioni ai Titled Tuesday NON sono
 * pubbliche in anticipo (verificato: il campo `registered` dell'API contiene
 * solo residui di tornei vecchi), quindi il segnale migliore disponibile e'
 * chi si e' presentato nelle settimane appena passate.
 */
export function recentForm(player, meta, n = 6) {
  const events = [...(meta?.events || [])]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n)
    .reverse();
  const giocati = new Set((player?.history || []).map((h) => h.d));
  return events.map((e) => ({ date: e.date, played: giocati.has(e.date) }));
}

/** Quante delle ultime giornate ha giocato di fila, partendo dall'ultima. */
export function currentStreak(player, meta, n = 6) {
  const form = recentForm(player, meta, n);
  let k = 0;
  for (let i = form.length - 1; i >= 0 && form[i].played; i--) k++;
  return k;
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

/**
 * Fa partire l'asta live. Restituisce null se non c'e' niente da fare,
 * cosi' si puo' passare dritta a `updateLeague` come mutatore.
 *
 * Sta qui e non nella vista perche' la usano in due: il browser, quando
 * l'admin preme il pulsante o scade l'orario mentre qualcuno guarda, e la
 * Cloud Function che fa partire le aste programmate. Due copie della
 * stessa partenza sarebbero due aste leggermente diverse.
 */
export function avviaAstaLive(lg) {
  if (!lg || lg.phase !== "lobby") return null;
  lg.phase = "auction";
  lg.scheduledStart = 0;          // programmazione consumata
  lg.auction = {
    ...lg.auction, status: "idle", turnIdx: 0, turnEndsAt: nextTurnDeadline(lg),
  };
  return lg;
}

/** Link d'invito assoluto, funziona anche in sottocartella su GitHub Pages. */
export function inviteLink(leagueId) {
  const base = location.href.split("#")[0];
  return `${base}#/join/${leagueId}`;
}

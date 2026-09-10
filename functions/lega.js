/* ---------------------------------------------------------------
   Il minimo indispensabile della logica di lega, ricopiato dal client.

   Sono i gemelli di js/league.js, js/draft.js e js/season.js: qui serve
   solo sapere A CHI tocca e CHI ha finito, non far girare l'asta. Se un
   giorno cambia l'ordine dei turni va cambiato in tutti e due i posti —
   nel dubbio il client resta la fonte di verita', queste funzioni
   decidono soltanto a chi suona il telefono.
   --------------------------------------------------------------- */

/** I partecipanti in ordine d'ingresso: e' l'ordine dei turni. */
export function members(lg) {
  return Object.values(lg?.members || {})
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
}

export function uids(lg) {
  return members(lg).map((m) => m.uid);
}

export function nome(lg, uid) {
  return lg?.members?.[uid]?.name || "qualcuno";
}

/**
 * Quanti giocatori ha in rosa. Nel salary cap le rose non sono esclusive
 * e stanno altrove: le due strade non si possono unire.
 */
export function ownedCount(lg, uid) {
  if (lg?.auctionMode === "salary") {
    return Object.keys(lg.salaryRosters?.[uid] || {}).length;
  }
  return Object.values(lg?.roster || {}).filter((r) => r.ownerUid === uid).length;
}

export function rosaCompleta(lg, uid) {
  return ownedCount(lg, uid) >= (lg?.rosterSize || 0);
}

/** Chi deve ancora finire la rosa. */
export function daCompletare(lg) {
  return uids(lg).filter((u) => !rosaCompleta(lg, u));
}

/* --------------------------------- turni -------------------------------- */

/** Asta live: a chi tocca chiamare. */
export function nominator(lg) {
  const liberi = members(lg).filter((m) => !rosaCompleta(lg, m.uid));
  if (!liberi.length) return null;
  return liberi[(lg.auction?.turnIdx || 0) % liberi.length].uid;
}

/** Draft: l'ordine si inverte a ogni giro. */
export function ordineGiro(order, round) {
  return round % 2 === 1 ? [...order] : [...order].reverse();
}

/** Draft: a chi tocca scegliere, o null se e' finito. */
export function chiSceglie(lg) {
  const d = lg?.draft || {};
  const order = d.order?.length ? d.order : uids(lg);
  if (!order.length) return null;
  if ((d.round || 1) > (lg.rosterSize || 0)) return null;
  return ordineGiro(order, d.round || 1)[d.pickIdx || 0] || null;
}

/* ------------------------------- calendario ------------------------------ */

const TT_HOUR_UTC = 15;
const TT_WEEKDAY = 2;                       // martedi'
export const SETTIMANA_MS = 7 * 24 * 3600 * 1000;

/** Il martedi' alle 15:00 UTC successivo o uguale a `from`. Gemello di season.js. */
export function nextTuesday(from) {
  const d = new Date(from);
  const t = new Date(Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), TT_HOUR_UTC, 0, 0, 0));
  let delta = (TT_WEEKDAY - t.getUTCDay() + 7) % 7;
  if (delta === 0 && t.getTime() < from) delta = 7;
  t.setUTCDate(t.getUTCDate() + delta);
  return t.getTime();
}

/**
 * Che numero di giornata cade nel Titled Tuesday piu' vicino a `now`.
 *
 * Le giornate sono martedi' consecutivi a partire dalla chiusura
 * dell'asta, quindi basta contare le settimane. Se chess.com salta un
 * martedi' il conteggio puo' sfasarsi di uno rispetto al piano che vede
 * il client: il danno massimo e' un promemoria mandato a chi la
 * formazione l'aveva gia' messa, quindi si accetta.
 */
export function numeroGiornata(startsAt, now) {
  if (!startsAt) return null;
  const prima = nextTuesday(startsAt);
  const questa = nextTuesday(now);
  const n = Math.round((questa - prima) / SETTIMANA_MS) + 1;
  return n >= 1 ? n : null;
}

export const slotDocId = (n) => `g${n}`;

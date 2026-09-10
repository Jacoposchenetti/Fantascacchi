/* ---------------------------------------------------------------
   Asta a busta chiusa.

   L'alternativa asincrona all'asta live: invece di trovarsi tutti insieme
   con il cronometro, ognuno manda offerte segrete entro una scadenza, e al
   momento buono si risolvono tutte in una volta.

   Come si risolve
   ---------------
   Tutte le offerte valide finiscono in un'unica lista ordinata dal prezzo
   piu' alto al piu' basso, e si assegna in una sola passata. Chi si prende
   un giocatore caro si ritrova meno crediti per quelli che vengono dopo:
   e' la stessa tensione dell'asta live, solo compressa in un istante.

   A parita' di offerta vince chi ha piu' crediti in cassa, e se sono pari
   anche quelli chi ha mandato l'offerta prima. Serve che sia deterministico:
   la risoluzione la esegue il primo client che si accorge della scadenza, e
   tutti gli altri devono poter ottenere lo stesso identico risultato.

   Sulla segretezza
   ----------------
   Le offerte stanno in un documento per persona, e le regole Firestore ne
   impediscono la lettura altrui finche' la scadenza non e' passata. E'
   segretezza vera, imposta dal server: non basta nascondere i numeri
   nell'interfaccia, perche' chiunque sa aprire la console del browser.
   --------------------------------------------------------------- */

import { members, budgetLeft, ownedCount } from "./league.js";

export const DEFAULT_ORE = 12;
export const DEFAULT_SALTI = 2;

/** Le durate proposte per un giro, in ore. */
export const ORE_GIRO = [1, 3, 6, 12];

/**
 * Il regolamento delle buste chiuse in parole, un punto per riga.
 * Unico posto da cui lobby, schermata d'asta e ingresso lo prendono, cosi'
 * i giocatori vedono sempre le stesse regole, ovunque.
 */
export function regoleBusteChiuse(league) {
  const ore = league?.sealedHours || DEFAULT_ORE;
  const salti = league?.sealedSkipLimit ?? DEFAULT_SALTI;
  return [
    "Nessuno deve essere collegato insieme agli altri.",
    `Ogni giro dura ${ore} ${ore === 1 ? "ora" : "ore"}: mandi un'offerta segreta `
      + "per ogni giocatore che vuoi, nessuno vede le tue prima della scadenza.",
    "Alla scadenza si assegna tutto insieme: vince chi ha offerto di più e paga "
      + "esattamente quanto ha offerto. A parità vince chi ha più crediti, poi "
      + "chi ha offerto prima.",
    "Se le rose non sono piene, parte da solo un altro giro. Si va avanti così "
      + "finché tutti hanno la rosa completa.",
    `Attenzione: chi salta ${salti} giri di fila si vede riempire la rosa `
      + "d'ufficio con i giocatori liberi più economici, a 1 credito l'uno. "
      + "Serve a non bloccare l'asta all'infinito.",
  ];
}

/** Chi deve ancora completare la rosa. */
export function daCompletare(league) {
  return members(league).filter((m) => ownedCount(league, m.uid) < league.rosterSize);
}

/**
 * Offerta massima consentita: come nell'asta live, va tenuto un credito
 * per ogni casella di rosa che resterebbe vuota.
 */
export function maxOfferta(league, uid) {
  const slot = league.rosterSize - ownedCount(league, uid);
  if (slot <= 0) return 0;
  return Math.max(0, budgetLeft(league, uid) - (slot - 1));
}

/**
 * Quanto ho gia' impegnato in offerte non ancora risolte.
 * Serve a dire "stai puntando piu' di quanto potresti spendere", che non e'
 * vietato — si possono perdere delle aste — ma va saputo.
 */
export function impegnato(mieOfferte) {
  return Object.values(mieOfferte || {}).reduce((s, b) => s + (b.amount || 0), 0);
}

/**
 * Risolve un giro di buste chiuse.
 *
 * @param {object} league
 * @param {Object<string, Object<string,{amount:number, at:number}>>} tutte
 *        uid -> playerId -> offerta
 * @returns {{assegnazioni: Array, respinte: Array}}
 */
export function risolvi(league, tutte) {
  const offerte = [];
  for (const [uid, mie] of Object.entries(tutte || {})) {
    if (!league.members?.[uid]) continue;
    for (const [pid, b] of Object.entries(mie || {})) {
      const amount = Math.floor(Number(b?.amount) || 0);
      if (amount < 1) continue;
      if (league.roster?.[pid]) continue;      // gia' di qualcuno
      offerte.push({ pid, uid, amount, at: Number(b.at) || 0 });
    }
  }

  // Fotografia iniziale: i pareggi si sciolgono con i crediti di PARTENZA,
  // non con quelli che restano durante l'assegnazione, altrimenti l'ordine
  // dipenderebbe da se stesso.
  const partenza = new Map();
  const crediti = new Map();
  const slot = new Map();
  for (const m of members(league)) {
    const c = budgetLeft(league, m.uid);
    partenza.set(m.uid, c);
    crediti.set(m.uid, c);
    slot.set(m.uid, league.rosterSize - ownedCount(league, m.uid));
  }

  offerte.sort((a, b) =>
    b.amount - a.amount
    || (partenza.get(b.uid) || 0) - (partenza.get(a.uid) || 0)
    || a.at - b.at
    || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));   // ultimo appiglio: stabile

  const preso = new Set();
  const assegnazioni = [];
  const respinte = [];

  for (const o of offerte) {
    if (preso.has(o.pid)) { respinte.push({ ...o, perche: "superato" }); continue; }
    if ((slot.get(o.uid) || 0) <= 0) { respinte.push({ ...o, perche: "rosa piena" }); continue; }
    const riserva = (slot.get(o.uid) || 0) - 1;         // 1 credito per casella
    if (o.amount > (crediti.get(o.uid) || 0) - riserva) {
      respinte.push({ ...o, perche: "crediti insufficienti" });
      continue;
    }
    preso.add(o.pid);
    crediti.set(o.uid, crediti.get(o.uid) - o.amount);
    slot.set(o.uid, slot.get(o.uid) - 1);
    assegnazioni.push({ playerId: o.pid, uid: o.uid, price: o.amount });
  }

  return { assegnazioni, respinte };
}

/**
 * Applica il risultato alla lega. Da usare dentro una transazione: la
 * risoluzione la lancia il primo che si accorge della scadenza, e chi arriva
 * dopo deve trovare il giro gia' chiuso e non rifarlo.
 *
 * @param opzioni.chiHaOfferto  Set di uid che hanno mandato offerte nel giro
 * @param opzioni.liberiEconomici  playerId liberi, dal piu' economico
 */
export function applica(lg, assegnazioni, oreProssimoGiro, opzioni = {}) {
  for (const a of assegnazioni) {
    if (lg.roster?.[a.playerId]) continue;
    lg.roster = {
      ...lg.roster,
      [a.playerId]: { playerId: a.playerId, ownerUid: a.uid, price: a.price, at: Date.now() },
    };
  }

  const dufficio = riempiChiSalta(lg, assegnazioni, opzioni);

  const finita = daCompletare(lg).length === 0;
  lg.sealed = {
    ...(lg.sealed || {}),
    giro: (lg.sealed?.giro || 1) + (finita ? 0 : 1),
    scadenza: finita ? 0 : Date.now() + oreProssimoGiro * 3600 * 1000,
    ultimoRisultato: assegnazioni,
    dufficio,
    hannoOfferto: [],                  // il giro nuovo riparte da zero
    saltati: lg.sealed?.saltati || {},
    risoltoIl: Date.now(),
  };
  if (finita) {
    lg.phase = "season";
    lg.season = { startsAt: Date.now(), matchdays: lg.season?.matchdays || 10 };
  }
  return lg;
}

/**
 * Chi salta troppi giri di fila si vede riempire la rosa d'ufficio, con i
 * giocatori liberi piu' ECONOMICI a 1 credito.
 *
 * Serve perche' altrimenti una sola persona che non apre mai l'app blocca
 * l'asta all'infinito: gli altri finiscono, i giri continuano a girare a
 * vuoto e la stagione non comincia mai. Verificato: succedeva davvero.
 *
 * Si prendono i piu' economici e non i migliori di proposito: chi non
 * partecipa non deve ritrovarsi premiato con i fuoriclasse gratis.
 */
function riempiChiSalta(lg, assegnazioni, opzioni) {
  const soglia = opzioni.soglia ?? lg.sealedSkipLimit ?? DEFAULT_SALTI;
  const offerto = opzioni.chiHaOfferto || new Set();
  const liberi = (opzioni.liberiEconomici || []).filter((pid) => !lg.roster?.[pid]);
  const saltati = { ...(lg.sealed?.saltati || {}) };
  const fatti = [];

  for (const m of members(lg)) {
    if (ownedCount(lg, m.uid) >= lg.rosterSize) { saltati[m.uid] = 0; continue; }
    const haPartecipato = offerto.has(m.uid)
      || assegnazioni.some((a) => a.uid === m.uid);
    saltati[m.uid] = haPartecipato ? 0 : (saltati[m.uid] || 0) + 1;

    if (saltati[m.uid] < soglia) continue;

    while (ownedCount(lg, m.uid) < lg.rosterSize && liberi.length) {
      const pid = liberi.shift();
      if (lg.roster?.[pid]) continue;
      lg.roster = {
        ...lg.roster,
        [pid]: { playerId: pid, ownerUid: m.uid, price: 1, at: Date.now(), dufficio: true },
      };
      fatti.push({ playerId: pid, uid: m.uid, price: 1 });
    }
    saltati[m.uid] = 0;
  }

  lg.sealed = { ...(lg.sealed || {}), saltati };
  return fatti;
}

/** Quanto manca alla scadenza, in forma leggibile. */
export function mancaAlla(scadenza, now = Date.now()) {
  const ms = scadenza - now;
  if (ms <= 0) return "scaduta";
  const ore = Math.floor(ms / 3600000);
  const min = Math.floor((ms % 3600000) / 60000);
  if (ore >= 24) {
    const g = Math.floor(ore / 24);
    return `${g} giorn${g === 1 ? "o" : "i"} e ${ore % 24} ore`;
  }
  if (ore >= 1) return `${ore}h ${String(min).padStart(2, "0")}m`;
  return `${min} minuti`;
}

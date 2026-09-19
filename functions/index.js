/* ---------------------------------------------------------------
   Notifiche push di Fantascacchi.

   Due sole funzioni, e fanno cose diverse:

   `legaCambiata` scatta a ogni scrittura sul documento della lega e
   confronta il prima col dopo. E' il modo giusto per gli avvisi
   "e' successo qualcosa": tocca a te, e' entrato un amico, l'asta e'
   partita. Arrivano nell'istante esatto, senza interrogare niente.

   `promemoria` gira ogni quarto d'ora e guarda invece le SCADENZE, che
   per definizione non generano nessuna scrittura: nessuno tocca la lega
   nel momento in cui mancano sessanta minuti alla chiusura di un giro.

   Il segnaposto di cosa e' gia' stato mandato sta in `promemoria/{lega}`,
   apposta FUORI dal documento della lega: scriverlo dentro farebbe
   ripartire il trigger qui sopra, all'infinito.
   --------------------------------------------------------------- */

import { onDocumentWritten, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { invia } from "./push.js";
// La logica d'asta e' quella VERA del client, copiata qui dal predeploy
// (tools/sync_condiviso.mjs). Riscriverla a mano significherebbe due
// implementazioni che prima o poi assegnano giocatori diversi.
import { risolvi, applica, DEFAULT_ORE } from "./condiviso/sealed.js";
import { avviaAstaLive, members, fonteDi } from "./condiviso/league.js";
import {
  uids, nome, nominator, chiSceglie, daCompletare,
  numeroGiornata, slotDocId, nextTuesday,
} from "./lega.js";

const VAPID_PRIVATE = defineSecret("VAPID_PRIVATE_KEY");

initializeApp();

// Firestore sta su eur3, quindi le funzioni stanno in Europa: un trigger
// in un continente diverso non si aggancia.
//
// `maxInstances` basso e' il freno a mano sui costi: questa e' un'app fra
// amici, se qualcosa impazzisce meglio una coda che una fattura.
setGlobalOptions({
  region: "europe-west1",
  maxInstances: 5,
  memory: "256MiB",
  timeoutSeconds: 60,
});

const link = (id, tab = "asta") => `#/l/${id}/${tab}`;

/* ==================== quello che succede nella lega ==================== */

export const legaCambiata = onDocumentWritten(
  { document: "leagues/{leagueId}", secrets: [VAPID_PRIVATE] },
  async (event) => {
    const prima = event.data?.before?.data() || null;
    const dopo = event.data?.after?.data() || null;
    if (!dopo) return;                       // lega cancellata
    if (!prima) return;                      // appena creata: c'e' solo l'admin

    const avvisi = cambiamenti(prima, dopo, event.params.leagueId);
    for (const a of avvisi) {
      await invia(a.a, a, VAPID_PRIVATE.value());
    }
  },
);

/**
 * Il confronto prima/dopo, tradotto in notifiche.
 * Restituisce una lista di { a: [uid], titolo, corpo, tag, url }.
 */
export function cambiamenti(prima, dopo, id) {
  const out = [];
  const titolo = dopo.name || "Fantascacchi";
  const modo = dopo.auctionMode || "live";

  /* --- e' entrato qualcuno: lo sa chi ha creato la lega --- */
  const nuovi = uids(dopo).filter((u) => !prima.members?.[u]);
  if (nuovi.length) {
    const nomi = nuovi.map((u) => nome(dopo, u));
    const quanti = uids(dopo).length;
    out.push({
      a: [dopo.adminUid].filter((u) => !nuovi.includes(u)),
      titolo,
      corpo: `${nomi.join(", ")} ${nomi.length > 1 ? "sono entrati" : "è entrato"}`
        + ` nella lega. Ora siete in ${quanti}.`,
      tag: `membri-${id}`,
      url: link(id),
    });
  }

  /* --- la lega ha cambiato fase --- */
  if (prima.phase !== dopo.phase) {
    const tutti = uids(dopo);
    if (dopo.phase === "season") {
      out.push({
        a: tutti,
        titolo,
        corpo: "Rose al completo: comincia la stagione. Schiera la formazione "
          + "per il prossimo Titled Tuesday.",
        tag: `fase-${id}`,
        url: link(id, "formazione"),
      });
    } else if (prima.phase === "lobby") {
      const come = {
        live: "L'asta è cominciata, entra prima che parta il tuo giocatore.",
        sealed: "L'asta a buste chiuse è aperta: manda le tue offerte.",
        draft: "Il draft è cominciato.",
        salary: "La finestra del salary cap è aperta: componi la rosa.",
      };
      out.push({
        a: tutti, titolo, corpo: come[modo] || come.live,
        tag: `fase-${id}`, url: link(id),
      });
    } else if (dopo.phase === "paused") {
      out.push({
        a: tutti, titolo, corpo: "L'asta è in pausa.",
        tag: `fase-${id}`, url: link(id),
      });
    }
  }

  /* --- tocca a te: asta live --- */
  if (dopo.phase === "auction" && modo === "live") {
    const ora = nominator(dopo);
    if (ora && ora !== nominator(prima)) {
      out.push({
        a: [ora], titolo,
        corpo: "Tocca a te chiamare un giocatore.",
        tag: `turno-${id}`, url: link(id),
      });
    }
  }

  /* --- tocca a te: draft --- */
  if (modo === "draft" && dopo.phase !== "season") {
    const ora = chiSceglie(dopo);
    if (ora && ora !== chiSceglie(prima)) {
      const giro = dopo.draft?.round || 1;
      out.push({
        a: [ora], titolo,
        corpo: `Tocca a te scegliere (giro ${giro} di ${dopo.rosterSize}).`,
        tag: `turno-${id}`, url: link(id),
      });
    }
  }

  /* --- buste chiuse: si e' aperto un giro nuovo --- */
  if (modo === "sealed" && dopo.phase !== "season") {
    const giro = dopo.sealed?.giro || 1;
    if (giro > (prima.sealed?.giro || 1)) {
      const presi = (dopo.sealed?.ultimoRisultato || []).length;
      out.push({
        a: daCompletare(dopo),
        titolo,
        corpo: `Giro ${giro}: ${presi ? `${presi} giocatori assegnati. ` : ""}`
          + "Manda le offerte per il prossimo.",
        tag: `giro-${id}`,
        url: link(id),
      });
    }
    // Rosa riempita d'ufficio: chi l'ha subita deve saperlo.
    for (const d of dopo.sealed?.dufficio || []) {
      if ((prima.sealed?.dufficio || []).some((p) => p.playerId === d.playerId)) continue;
      out.push({
        a: [d.uid], titolo,
        corpo: "Hai saltato troppi giri: la rosa è stata completata d'ufficio.",
        tag: `ufficio-${id}`, url: link(id, "rosa"),
      });
    }
  }

  return out.filter((a) => a.a.length);
}

/* ====================== pulizia delle buste chiuse ==================== */

/**
 * A giro concluso, via le offerte.
 *
 * Non lo puo' fare il browser: le regole lasciano scrivere in bids/{uid}
 * solo al diretto interessato, quindi chi risolve il giro riesce a
 * cancellare le proprie e basta. Le altrui restavano li', e al giro dopo
 * venivano ricontate come se fossero appena arrivate: chi non offriva
 * risultava comunque partecipante, il contatore dei giri saltati non
 * saliva mai, la rosa d'ufficio non scattava e l'asta non finiva piu'.
 *
 * Sta in una funzione sua e non dentro `legaCambiata` di proposito: se la
 * logica delle notifiche si rompe, le buste devono sparire lo stesso.
 */
export const busteRipulite = onDocumentWritten("leagues/{leagueId}", async (event) => {
  const prima = event.data?.before?.data();
  const dopo = event.data?.after?.data();
  if (!prima || !dopo) return;
  if ((dopo.auctionMode || "live") !== "sealed") return;

  const giroNuovo = (dopo.sealed?.giro || 1) > (prima.sealed?.giro || 1);
  const astaFinita = prima.phase !== dopo.phase && dopo.phase === "season";
  if (!giroNuovo && !astaFinita) return;

  const db = getFirestore();
  const id = event.params.leagueId;
  try {
    const coll = db.collection("leagues").doc(id).collection("bids");
    const snap = await coll.get();
    if (snap.empty) return;
    const lotto = db.batch();
    snap.docs.forEach((d) => lotto.delete(d.ref));
    await lotto.commit();
    console.log(`lega ${id}: ${snap.size} buste ripulite `
      + `(${astaFinita ? "asta conclusa" : `giro ${dopo.sealed?.giro}`})`);
  } catch (e) {
    console.error(`lega ${id}: pulizia buste non riuscita`, e?.message);
  }
});

/* ======================== pulizia dopo l'eliminazione ================== */

/**
 * Quando una lega sparisce, si porta dietro tutto il resto.
 *
 * Non lo puo' fare il client: le regole lasciano scrivere in `presence/{uid}`
 * e `bids/{uid}` solo al diretto interessato, quindi chi elimina la lega non
 * ha il permesso di cancellare i documenti degli altri. Qui invece si gira
 * con l'Admin SDK, che le regole non le vede.
 *
 * `recursiveDelete` scende da solo in matchdays, presence e bids: sono
 * sottocollezioni, e in Firestore sopravvivono al documento che le contiene
 * se non le cancella qualcuno apposta.
 */
export const legaEliminata = onDocumentDeleted("leagues/{leagueId}", async (event) => {
  const db = getFirestore();
  const id = event.params.leagueId;
  try {
    await db.recursiveDelete(db.collection("leagues").doc(id));
    await db.collection("promemoria").doc(id).delete();
    console.log(`lega ${id}: sottocollezioni e promemoria ripuliti`);
  } catch (e) {
    console.error(`lega ${id}: pulizia non riuscita`, e?.message);
  }
});

/* ========================== le scadenze ============================== */

export const promemoria = onSchedule(
  { schedule: "every 15 minutes", timeZone: "Europe/Rome", secrets: [VAPID_PRIVATE] },
  async () => {
    const db = getFirestore();
    const now = Date.now();
    const snap = await db.collection("leagues").limit(400).get();

    for (const doc of snap.docs) {
      const lg = doc.data();
      const id = doc.id;
      // Prima si fa andare avanti il gioco, poi si avvisa: se un giro era
      // scaduto, gli avvisi giusti sono quelli del giro NUOVO.
      try {
        if (await risolviBusteScadute(db, lg, id, now)) continue;
      } catch (e) {
        console.error(`lega ${id}: risoluzione buste non riuscita`, e?.message);
      }

      const segna = db.collection("promemoria").doc(id);
      const fatti = (await segna.get()).data() || {};
      const nuovi = {};

      for (const a of await scadenze(db, lg, id, now, fatti, nuovi)) {
        await invia(a.a, a, VAPID_PRIVATE.value());
      }
      if (Object.keys(nuovi).length) await segna.set(nuovi, { merge: true });
    }
  },
);

const ORA = 60 * 60 * 1000;

/**
 * Le scadenze che stanno per arrivare. `fatti` dice cosa e' gia' partito,
 * `nuovi` raccoglie i segnaposto da salvare: senza, ogni quarto d'ora
 * ripartirebbe lo stesso avviso.
 */
async function scadenze(db, lg, id, now, fatti, nuovi) {
  const out = [];
  const titolo = lg.name || "Fantascacchi";
  const modo = lg.auctionMode || "live";

  /* --- buste chiuse: manca un'ora alla chiusura del giro --- */
  if (modo === "sealed" && lg.phase !== "season" && lg.sealed?.scadenza) {
    const giro = lg.sealed.giro || 1;
    const manca = lg.sealed.scadenza - now;
    if (manca > 0 && manca <= ORA && fatti.sealedGiro !== giro) {
      const offerto = new Set(lg.sealed.hannoOfferto || []);
      const zitti = daCompletare(lg).filter((u) => !offerto.has(u));
      if (zitti.length) {
        out.push({
          a: zitti, titolo,
          corpo: `Meno di un'ora per offrire nel giro ${giro}. `
            + "Chi salta due giri di fila si vede riempire la rosa d'ufficio.",
          tag: `scadenza-${id}`, url: link(id),
        });
      }
      nuovi.sealedGiro = giro;
    }
  }

  /* --- salary cap: manca poco alla chiusura della finestra --- */
  if (modo === "salary" && lg.phase !== "season" && lg.salary?.deadline) {
    const manca = lg.salary.deadline - now;
    if (manca > 0 && manca <= 2 * ORA && !fatti.salary) {
      const incompleti = daCompletare(lg);
      if (incompleti.length) {
        out.push({
          a: incompleti, titolo,
          corpo: "La finestra del salary cap chiude fra poco e la tua rosa "
            + "non è completa.",
          tag: `scadenza-${id}`, url: link(id),
        });
      }
      nuovi.salary = true;
    }
  }

  /* --- stagione: si gioca fra poco e non hai schierato --- */
  if (lg.phase === "season" && lg.season?.startsAt) {
    // Coi Titled Tuesday la prossima giornata si calcola: sono martedi'
    // consecutivi. Con un torneo classico no — i turni hanno le loro date —
    // e mandare un promemoria di martedi' a chi gioca i Candidati vorrebbe
    // dire svegliare la gente per una giornata che non c'e'.
    const prossima = await prossimaGiornata(lg, now);
    const manca = prossima ? prossima.inizio - now : -1;
    const n = prossima?.n || null;
    const chiave = `g${n}`;
    if (n && (fonteDi(lg).tipo !== "tt" || n <= (lg.season.matchdays || 10))
      && manca > 0 && manca <= 3 * ORA && fatti.formazione !== chiave) {
      const md = await db.collection("leagues").doc(id)
        .collection("matchdays").doc(slotDocId(n)).get();
      const schierati = md.exists ? (md.data().lineups || {}) : {};
      const scordati = uids(lg).filter((u) => !schierati[u]);
      if (scordati.length) {
        out.push({
          a: scordati, titolo,
          corpo: `Si gioca fra poche ore e non hai schierato la `
            + `formazione della giornata ${n}.`,
          tag: `formazione-${id}`, url: link(id, "formazione"),
        });
      }
      nuovi.formazione = chiave;
    }
  }

  return out;
}


/**
 * La prossima giornata della lega e quando comincia.
 *
 * @returns {{n:number, inizio:number}|null}
 */
async function prossimaGiornata(lg, now) {
  const f = fonteDi(lg);

  if (f.tipo === "tt") {
    const n = numeroGiornata(lg.season.startsAt, now);
    return n ? { n, inizio: nextTuesday(now - ORA) } : null;
  }

  // Le date vere stanno nell'archivio pubblicato, lo stesso che legge il
  // browser: cosi' client e server contano le giornate allo stesso modo.
  const tours = f.tipo === "torneo" ? [f.tour] : (f.tours || []);
  const caselle = [];
  for (const t of tours.filter(Boolean)) {
    let m;
    try {
      m = await fileJson(`${SITO}/data/bc/${t}/index.json`);
    } catch {
      continue;
    }
    if (f.tipo === "torneo") {
      for (const r of m.rounds || []) caselle.push((r.start || 0) * 1000);
    } else {
      caselle.push((m.dates || [0])[0] || 0);
    }
  }

  // Stesso filtro del piano lato client: contano solo le caselle dalla
  // chiusura dell'asta in poi, e la numerazione parte da li'.
  const dopo = caselle
    .filter((ms) => ms >= (lg.season.startsAt || 0))
    .sort((a, b) => a - b);
  const i = dopo.findIndex((ms) => ms > now);
  return i >= 0 ? { n: i + 1, inizio: dopo[i] } : null;
}

/* ==================== buste chiuse: risoluzione d'ufficio ============== */

/**
 * Il listone, per sapere quali giocatori sono liberi e quanto costano.
 * Si prende dal sito pubblicato, cosi' e' sempre quello aggiornato dalla
 * GitHub Action del mercoledi' invece di una copia congelata nel bundle.
 */
// L'archivio pubblicato. Si puo' puntare altrove con una variabile
// d'ambiente: serve alle prove, che girano contro il server locale invece
// che contro GitHub Pages.
const SITO = process.env.FANTASCACCHI_SITO
  || "https://jacoposchenetti.github.io/Fantascacchi";

const ORA_MS = 60 * 60 * 1000;
const fileCache = new Map();          // url -> { quando, dati }

async function fileJson(url) {
  const c = fileCache.get(url);
  if (c && Date.now() - c.quando < ORA_MS) return c.dati;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} non raggiungibile (${r.status})`);
  const dati = await r.json();
  fileCache.set(url, { quando: Date.now(), dati });
  return dati;
}

/**
 * Il listone della lega, che dipende da su cosa si gioca.
 *
 * Prima era uno solo, quello dei Titled Tuesday. Con le leghe sui tornei
 * classici sarebbe stato il bug peggiore possibile: le buste chiuse le
 * risolve anche il server, e con il listone sbagliato avrebbe assegnato
 * d'ufficio giocatori che in quella lega non esistono nemmeno.
 */
async function listone(lg) {
  const f = fonteDi(lg);
  if (f.tipo === "tt") {
    return (await fileJson(`${SITO}/data/listone.json`)).players || [];
  }

  const tours = f.tipo === "torneo" ? [f.tour] : (f.tours || []);
  const metas = await Promise.all(
    tours.filter(Boolean).map((t) => fileJson(`${SITO}/data/bc/${t}/index.json`)));

  // Nel circuito lo stesso giocatore compare in piu' tornei: vale una volta
  // sola, col rating piu' alto. Stessa regola del client.
  const per = new Map();
  for (const m of metas) {
    for (const p of m.players || []) {
      const prima = per.get(p.id);
      if (!prima || (p.rating || 0) > (prima.rating || 0)) per.set(p.id, p);
    }
  }
  return [...per.values()];
}

/**
 * Chiude un giro di buste chiuse scaduto.
 *
 * Finora lo faceva solo il browser, e solo mentre qualcuno teneva aperta
 * la pagina dell'asta. Con i giri da 24 ore capitava la cosa ovvia: il
 * giro scadeva di notte, nessuno apriva l'app per un giorno, e l'asta
 * restava semplicemente ferma. Nessun errore, nessun avviso, solo
 * un'asta che non andava avanti.
 *
 * Il client continua a risolvere quando c'e' qualcuno collegato — cosi'
 * e' immediato invece di aspettare il quarto d'ora — e questa e' la rete
 * di sicurezza. Chi arriva secondo trova la scadenza gia' spostata e si
 * ferma: e' la transazione a decidere, non l'ordine di arrivo.
 *
 * @returns true se il giro e' stato chiuso qui.
 */
export async function risolviBusteScadute(db, lg, id, now) {
  if ((lg.auctionMode || "live") !== "sealed") return false;
  if (lg.phase !== "auction") return false;
  const scadenza = lg.sealed?.scadenza || 0;
  if (!scadenza || now < scadenza) return false;

  const ref = db.collection("leagues").doc(id);
  const buste = await ref.collection("bids").get();
  const catalogo = await listone(lg);

  let chiuso = false;
  await db.runTransaction(async (tx) => {
    // Firestore ripete la callback quando due transazioni si contendono lo
    // stesso documento: l'esito va azzerato a ogni tentativo, altrimenti
    // resta acceso da un giro annullato e si annuncia una chiusura che non
    // e' avvenuta.
    chiuso = false;
    const snap = await tx.get(ref);
    const cur = snap.data();
    // Qualcun altro (o un browser aperto) ha gia' chiuso questo giro.
    if (!cur?.sealed?.scadenza || Date.now() < cur.sealed.scadenza) return;
    if (cur.phase !== "auction") return;

    // Le buste rimaste da un giro precedente non contano: sono proprio
    // quelle che tenevano fermo il contatore dei giri saltati.
    const risoltoIl = cur.sealed?.risoltoIl || 0;
    const tutte = {};
    for (const d of buste.docs) {
      const v = d.data() || {};
      const at = v.at || 0;
      if (at && at < risoltoIl) continue;
      const offerte = v.bids || {};
      if (Object.keys(offerte).length) tutte[d.id] = offerte;
    }

    // Tutto si calcola sullo stato letto DENTRO la transazione: usare
    // quello di prima significherebbe assegnare su una fotografia vecchia.
    const { assegnazioni } = risolvi(cur, tutte);
    const presi = cur.roster || {};
    const liberiEconomici = [
      ...catalogo,
      ...Object.values(cur.customPlayers || {}),
    ].filter((p) => !presi[p.id])
      .sort((a, b) => (a.price || 0) - (b.price || 0))
      .map((p) => p.id);

    tx.set(ref, applica(cur, assegnazioni, cur.sealedHours || DEFAULT_ORE, {
      chiHaOfferto: new Set(Object.keys(tutte)),
      liberiEconomici,
    }));
    chiuso = true;
    console.log(`lega ${id}: giro ${cur.sealed?.giro || 1} chiuso d'ufficio, `
      + `${assegnazioni.length} assegnazioni, ${Object.keys(tutte).length} hanno offerto`);
  });

  // Le buste le cancella il trigger `busteRipulite`, che scatta sulla
  // scrittura appena fatta.
  return chiuso;
}


/* ===================== aste live con appuntamento ===================== */

const PREAVVISO = 10 * 60 * 1000;

/**
 * Fa partire le aste live programmate, e avvisa dieci minuti prima.
 *
 * Gira ogni minuto e non ogni quarto d'ora come `promemoria`: a un'asta
 * live la gente si presenta all'ora detta, e cominciare con dodici minuti
 * di ritardo sarebbe come non averla programmata.
 *
 * Puo' permetterselo perche' NON scorre tutte le leghe: interroga solo
 * quelle con un appuntamento in scadenza. `scheduledStart` torna a 0 alla
 * partenza, quindi quasi sempre la risposta e' vuota e il minuto costa una
 * lettura. Una scansione completa al minuto, invece, sarebbe costata piu'
 * letture al giorno di quante ne regali il piano gratuito.
 *
 * Chi ha l'app aperta fa partire l'asta da solo al secondo esatto (vedi
 * `partiOra` in views/lobby.js); questa e' la rete per quando non c'e'
 * nessuno. A decidere chi arriva primo e' la transazione.
 */
export const avvioProgrammato = onSchedule(
  { schedule: "every 1 minutes", timeZone: "Europe/Rome", secrets: [VAPID_PRIVATE] },
  async () => {
    const db = getFirestore();
    const now = Date.now();

    const snap = await db.collection("leagues")
      .where("scheduledStart", ">", 0)
      .where("scheduledStart", "<=", now + PREAVVISO)
      .get();
    if (snap.empty) return;

    for (const doc of snap.docs) {
      const lg = doc.data();
      const id = doc.id;
      const ref = doc.ref;

      // L'asta e' gia' partita (o e' cambiata modalita'): l'appuntamento
      // non ha piu' senso e va tolto, altrimenti resta nella query per
      // sempre e la si rilegge ogni minuto.
      if (lg.phase !== "lobby" || (lg.auctionMode || "live") !== "live") {
        await ref.update({ scheduledStart: 0 }).catch(() => {});
        continue;
      }

      if (lg.scheduledStart <= now) {
        let partita = false;
        await db.runTransaction(async (tx) => {
          partita = false;
          const fresco = (await tx.get(ref)).data();
          if (!fresco?.scheduledStart || Date.now() < fresco.scheduledStart) return;
          const next = avviaAstaLive(fresco);
          if (!next) return;
          tx.set(ref, next);
          partita = true;
        });
        if (partita) {
          console.log(`lega ${id}: asta live partita all'orario programmato`);
          // L'avviso "l'asta e' cominciata" lo manda gia' `legaCambiata`,
          // che scatta su questa stessa scrittura.
        }
        continue;
      }

      // Nella finestra di preavviso: si avvisa una volta sola.
      const segna = db.collection("promemoria").doc(id);
      const fatti = (await segna.get()).data() || {};
      if (fatti.avvisoAvvio === lg.scheduledStart) continue;

      const minuti = Math.max(1, Math.round((lg.scheduledStart - now) / 60000));
      await invia(members(lg).map((m) => m.uid), {
        titolo: lg.name || "Fantascacchi",
        corpo: `L'asta comincia fra ${minuti} minuti. Tieniti pronto: `
          + "i turni di chiamata scorrono a tempo.",
        tag: `avvio-${id}`,
        url: `#/l/${id}/asta`,
      }, VAPID_PRIVATE.value());
      await segna.set({ avvisoAvvio: lg.scheduledStart }, { merge: true });
    }
  },
);

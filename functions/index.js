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

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { invia } from "./push.js";
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

  /* --- stagione: oggi c'e' Titled Tuesday e non hai schierato --- */
  if (lg.phase === "season" && lg.season?.startsAt) {
    const inizio = nextTuesday(now - ORA);       // il torneo di oggi, se c'e'
    const manca = inizio - now;
    const n = numeroGiornata(lg.season.startsAt, now);
    const chiave = `g${n}`;
    if (n && n <= (lg.season.matchdays || 10)
      && manca > 0 && manca <= 3 * ORA && fatti.formazione !== chiave) {
      const md = await db.collection("leagues").doc(id)
        .collection("matchdays").doc(slotDocId(n)).get();
      const schierati = md.exists ? (md.data().lineups || {}) : {};
      const scordati = uids(lg).filter((u) => !schierati[u]);
      if (scordati.length) {
        out.push({
          a: scordati, titolo,
          corpo: `Titled Tuesday fra poche ore e non hai schierato la `
            + `formazione della giornata ${n}.`,
          tag: `formazione-${id}`, url: link(id, "formazione"),
        });
      }
      nuovi.formazione = chiave;
    }
  }

  return out;
}

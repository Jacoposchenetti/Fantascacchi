/* ---------------------------------------------------------------
   Il tutorial: una partita intera in tre minuti, con due avversari finti.

   La scelta importante e' che qui sotto NON c'e' una ricostruzione
   dell'asta: c'e' l'asta. Le stesse funzioni, lo stesso cronometro, gli
   stessi pulsanti che si useranno per davvero. Cambia solo da dove
   arrivano i dati (un negozio in memoria) e chi sta dall'altra parte
   (due bot invece di due amici).

   Costa qualche riga in piu' di un carosello di schermate, e in cambio
   non diventa mai una bugia: il giorno che l'asta cambia, cambia anche
   il tutorial, da solo.
   --------------------------------------------------------------- */

import { el, toast } from "../ui.js";
import { loadCatalog, allOwnedPlayerIds, ownedCount } from "../league.js";
import { demoStore, pianoDemo, risultatoDemo, TU, BOT } from "../demo/finto.js";
import { creaMotore } from "../demo/bot.js";

import auctionView from "./auction.js";
import lineupView from "./lineup.js";
import matchdaysView from "./matchdays.js";
import standingsView from "./standings.js";

/* --------------------------- stato del tutorial ------------------------- */

let S = null;

function azzera() {
  S?.motore?.ferma();
  S?.stacca?.();
  if (S?.battito) clearInterval(S.battito);
  S = null;
}

/** Il passo e' concluso? Allora si va avanti, senza chiedere niente. */
function controllaAvanzamento() {
  if (!S || !S.league || S.inAvanzamento) return;
  const passo = PASSI[S.passo];
  if (!passo?.fatto || !passo.fatto(S.league)) return;
  S.inAvanzamento = true;
  const bersaglio = S.passo + 1;
  setTimeout(() => { S.inAvanzamento = false; vaiA(bersaglio); }, 700);
}

function avvia(ctxApp) {
  S = {
    store: demoStore(ctxApp.store.me?.name || "Tu"),
    motore: null,
    catalog: null,
    league: null,
    matchdays: [],
    plan: pianoDemo(0),
    results: new Map(),
    passo: 0,
    inAvanzamento: false,
    stacca: null,
    ricarica: ctxApp.refresh,
  };

  // L'avanzamento e' un battito indipendente, non un effetto del disegno.
  //
  // Prima stava dentro il render, e li' sbagliava due volte: durante l'asta
  // i ridisegni sono decine al secondo e accodavano raffiche di timeout che
  // cascavano uno sull'altro saltando tutti i passi; mentre quando l'app
  // aspetta una mossa non ridisegna affatto, e allora il passo non avanzava
  // piu' nemmeno a obiettivo raggiunto. Un intervallo suo risolve entrambe.
  S.battito = setInterval(controllaAvanzamento, 500);

  const off1 = S.store.watchLeague("demo", (lg) => { S.league = lg; S.ricarica(); });
  const off2 = S.store.watchMatchdays("demo", (m) => { S.matchdays = m; S.ricarica(); });
  S.stacca = () => { off1(); off2(); };

  loadCatalog(S.league).then((cat) => {
    S.catalog = cat;
    S.motore = creaMotore(S.store, cat);
    S.ricarica();
  }).catch((e) => toast(e.message, "err"));
}

/* -------------------------------- i passi ------------------------------- */

/**
 * `fatto` decide da solo quando si puo' andare avanti guardando lo stato:
 * cosi' il tutorial non chiede "hai capito?" ma si accorge che hai fatto.
 * Dove non c'e' niente da fare, `avanti` mette un pulsante.
 */
const PASSI = [
  {
    id: "intro",
    titolo: "Una lega intera in tre minuti",
    testo: "Qui sotto c'è l'app vera, con due avversari finti: Bea e Cico. "
      + "Farai un'asta, schiererai la formazione e vedrai da dove arrivano i "
      + "punti. Non si rompe niente e non resta niente: è tutto finto.",
    avanti: "Comincia dall'asta",
  },
  {
    id: "chiama",
    vista: "asta",
    titolo: "Tocca a te: chiama un giocatore",
    testo: "Nell'asta si va a turno. Chi ha la mano sceglie CHI mettere "
      + "all'asta — non se lo aggiudica, lo propone a tutti. Scorri il listone "
      + "e premi «Chiama».",
    obiettivo: "Chiama un giocatore dal listone",
    fatto: (lg) => lg.auction?.status === "running"
      || Object.keys(lg.roster || {}).length > 0,
  },
  {
    id: "rilancio",
    vista: "asta",
    titolo: "Adesso si rilancia",
    testo: "Parte da 1 credito e il cronometro riparte a ogni offerta: "
      + "finché qualcuno rilancia, il lotto non si chiude. Bea paga volentieri "
      + "sopra prezzo, Cico cerca solo affari. Se lasci correre, lo prendono loro.",
    obiettivo: "Aspetta che il lotto si chiuda — rilancia se lo vuoi",
    fatto: (lg) => Object.keys(lg.roster || {}).length > 0,
    salta: { testo: "Salta alla fine dell'asta", fa: concludiAsta },
  },
  {
    id: "budget",
    vista: "asta",
    titolo: "Il budget è la vera regola",
    testo: "Hai 120 crediti per 3 giocatori, e devi tenerne 1 per ogni posto "
      + "ancora vuoto: per questo il massimo che puoi offrire scende man mano. "
      + "Spendere tutto sul primo significa raccattare gli avanzi dopo. "
      + "Si va avanti finché tutte le rose sono piene.",
    obiettivo: "Completa l'asta: 3 giocatori a testa",
    fatto: (lg) => lg.phase === "season",
    salta: { testo: "Salta alla fine dell'asta", fa: concludiAsta },
  },
  {
    id: "formazione",
    vista: "formazione",
    titolo: "Prima del torneo: la formazione",
    testo: "Ogni martedì c'è un Titled Tuesday. Scegli chi schierare e chi fa "
      + "il capitano: il capitano raddoppia i punti, ma solo se gioca davvero. "
      + "Chi non si presenta viene sostituito dalla panchina.",
    obiettivo: "Salva la formazione con un capitano",
    fatto: () => Boolean(S.store.formazioni(1)[TU]),
  },
  {
    id: "punti",
    vista: "giornate",
    titolo: "I punti arrivano da soli",
    testo: "Il torneo è finito e i risultati sono arrivati da chess.com: "
      + "nessuno ha dovuto caricare niente. Apri la giornata qui sotto per "
      + "vedere il conto esatto — punti del torneo, piazzamento, capitano, "
      + "scontri diretti e imprese contro avversari più forti.",
    alEntrare: giocaLaGiornata,
    avanti: "Vai alla classifica",
  },
  {
    id: "classifica",
    vista: "classifica",
    titolo: "E si ricomincia",
    testo: "La classifica somma le giornate. Una stagione vera ne ha dieci, "
      + "circa due mesi e mezzo: tutti i martedì, senza che nessuno debba "
      + "organizzare niente.",
    avanti: "Ho capito",
  },
  {
    id: "fine",
    titolo: "Tutto qui",
    testo: "Questo era il giro completo. In una lega vera scegli tu quanti "
      + "giocatori in rosa, quanti crediti e come si compongono le rose: "
      + "asta live come questa, buste chiuse, draft a serpentina o salary cap.",
    finale: true,
  },
];

/* ------------------------------- la vista ------------------------------- */

export default function tutorialView(ctxApp) {
  if (!S) avvia(ctxApp);
  S.ricarica = ctxApp.refresh;

  if (!S.catalog || !S.league) {
    return el("div.card", el("p.center.muted", { style: "margin:0" },
      "Preparo la lega di prova…"));
  }

  const passo = PASSI[S.passo];

  // Il motore gira solo quando c'e' un'asta da mandare avanti.
  if (S.league.phase === "auction" && passo.vista === "asta") S.motore.avvia();
  else S.motore.ferma();

  return el("div.stack", { style: "gap:1.2rem" },
    guida(ctxApp, passo),
    passo.vista ? el("div.tut-palco", vistaSotto(passo.vista)) : cartaFinale(ctxApp, passo),
  );
}

/* ------------------------------- la guida ------------------------------- */

function guida(ctxApp, passo) {
  const n = S.passo + 1;
  const tot = PASSI.length;

  return el("div.card.card-hi.guida",
    el("div.spread", { style: "align-items:flex-start;gap:1rem" },
      el("div", { style: "min-width:0" },
        el("div.small.mute-2", { style: "margin-bottom:.2rem" },
          `Tutorial · passo ${n} di ${tot}`),
        el("h2", { style: "margin:0 0 .35rem" }, passo.titolo),
        el("p.muted.small", { style: "margin:0;max-width:62ch" }, passo.testo),
      ),
      el("button.btn.btn-sm.btn-ghost", {
        style: "flex:0 0 auto",
        onclick: () => { azzera(); ctxApp.go("#/"); },
      }, "Esci"),
    ),

    el("div.bar", { style: "margin:.7rem 0 0" },
      el("i", { style: `width:${Math.round((n / tot) * 100)}%` })),

    (passo.obiettivo || passo.avanti || passo.salta) && el("div.row",
      { style: "margin-top:.7rem" },
      passo.avanti && el("button.btn.btn-primary.btn-sm", {
        onclick: () => vaiA(S.passo + 1),
      }, passo.avanti),
      passo.obiettivo && el("span.small", { style: "color:var(--gold)" },
        "→ ", passo.obiettivo),
      passo.salta && el("button.btn.btn-sm.btn-ghost", {
        style: "margin-left:auto",
        onclick: async () => { await passo.salta.fa(); },
      }, passo.salta.testo),
    ),
  );
}

/** La vista vera, con un contesto che somiglia in tutto a quello normale. */
function vistaSotto(quale) {
  const viste = {
    asta: auctionView,
    formazione: lineupView,
    giornate: matchdaysView,
    classifica: standingsView,
  };
  const ctx = ctxDemo();
  try {
    return viste[quale](ctx);
  } catch (err) {
    console.error("tutorial", err);
    return el("div.card", el("p.small.mono", String(err?.message || err)));
  }
}

function ctxDemo() {
  const presenza = {};
  [TU, ...BOT.map((b) => b.uid)].forEach((u) => { presenza[u] = Date.now(); });

  return {
    store: S.store,
    uid: TU,
    me: S.store.me,
    league: S.league,
    matchdays: S.matchdays,
    catalog: S.catalog,
    presence: presenza,
    plan: S.plan,
    results: S.results,
    isAdmin: true,
    go: () => { /* nel tutorial non si naviga: comanda la guida */ },
    refresh: () => S.ricarica(),
    async mutate(fn) {
      try { await S.store.updateLeague("demo", fn); } catch (e) {
        toast(e.message || "Non si può", "err");
      }
    },
  };
}

function cartaFinale(ctxApp, passo) {
  if (!passo.finale) return null;
  return el("div.card.stack",
    el("p.muted", { style: "margin:0" },
      "La lega di prova sparisce adesso: non è mai stata salvata da nessuna parte."),
    el("div.row",
      el("button.btn.btn-primary.btn-lg", {
        onclick: () => { azzera(); ctxApp.go("#/"); },
      }, "Crea una lega vera"),
      el("button.btn.btn-ghost", {
        onclick: () => { azzera(); ctxApp.refresh(); },
      }, "Rifallo da capo"),
    ),
  );
}

/* ------------------------------- passaggi ------------------------------- */

function vaiA(i) {
  if (!S || i <= S.passo || i >= PASSI.length) return;
  S.passo = i;
  const passo = PASSI[i];
  if (passo.alEntrare) passo.alEntrare();
  S.ricarica();
}

/**
 * Scorciatoia per chi non ha voglia di aspettare nove lotti: assegna quello
 * che manca a prezzi plausibili e fa partire la stagione.
 */
async function concludiAsta() {
  const cat = S.catalog;
  await S.store.updateLeague("demo", (lg) => {
    const presi = new Set(allOwnedPlayerIds(lg));
    const liberi = (cat.meta?.players || [])
      .filter((p) => !presi.has(p.id))
      .sort((a, b) => (b.price || 0) - (a.price || 0));

    for (const m of Object.values(lg.members)) {
      while (ownedCount(lg, m.uid) < lg.rosterSize && liberi.length) {
        const p = liberi.splice(Math.floor(Math.random() * 8), 1)[0] || liberi.shift();
        lg.roster[p.id] = {
          playerId: p.id, ownerUid: m.uid,
          price: Math.max(1, Math.round((p.price || 10) * 0.7)), at: Date.now(),
        };
      }
    }
    lg.auction = { status: "idle", playerId: null, bid: 0, bidderUid: null,
      endsAt: 0, turnIdx: 0, turnEndsAt: 0 };
    lg.phase = "season";
    lg.season = { startsAt: Date.now(), matchdays: S.plan.total };
    return lg;
  });
}

/**
 * Fa succedere il Titled Tuesday: schiera d'ufficio i due avversari, inventa
 * un risultato e lo mette dove il resto dell'app si aspetta di trovarlo.
 * Da li' in poi sono `scoring.js` e le viste vere a fare i conti.
 */
function giocaLaGiornata() {
  const lg = S.league;

  // I bot schierano i primi che hanno: senza formazioni loro non ci sarebbero
  // scontri diretti, e lo scontro diretto e' meta' del sugo del gioco.
  for (const b of BOT) {
    const suoi = Object.values(lg.roster || {})
      .filter((r) => r.ownerUid === b.uid).map((r) => r.playerId);
    if (!suoi.length) continue;
    S.store.setLineup("demo", "g1", b.uid, {
      starters: suoi.slice(0, lg.lineupSize),
      bench: suoi.slice(lg.lineupSize),
      captain: suoi[0],
    });
  }

  S.results.set(1, risultatoDemo(allOwnedPlayerIds(lg), S.catalog));
  S.plan = pianoDemo(1);
}

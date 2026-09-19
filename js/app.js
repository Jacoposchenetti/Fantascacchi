/* ---------------------------------------------------------------
   Bootstrap, router a hash (obbligatorio su GitHub Pages) e chrome.

   Ogni vista e' una funzione pura (ctx) -> Node. L'app si risottoscrive
   ai dati della lega e ridisegna la vista attiva a ogni cambiamento;
   il focus e la posizione del cursore vengono ripristinati dopo il
   ridisegno, cosi' scrivere in un campo di ricerca non "salta".
   --------------------------------------------------------------- */

import { $, render, el, toast, spinner } from "./ui.js";
import { getStore } from "./store.js";
import { isAdmin as isAdminOf, inviteLink } from "./league.js";
import { loadCatalog } from "./fonte.js";
import { PRESENCE_BEAT } from "./config.js";
import { loadCalendar, seasonPlan, loadResults } from "./season.js";
import { initInstall } from "./install.js";
import { initAvvisi, avvisiSlot } from "./views/avvisi.js";

import homeView from "./views/home.js";
import loginView from "./views/login.js";
import joinView from "./views/join.js";
import auctionView from "./views/auction.js";
import squadView from "./views/squad.js";
import lineupView from "./views/lineup.js";
import matchdaysView from "./views/matchdays.js";
import standingsView from "./views/standings.js";
import partiteView from "./views/partite.js";
import settingsView from "./views/settings.js";
import tutorialView from "./views/tutorial.js";

const TABS = [
  { key: "asta",         label: "Asta",       view: auctionView },
  { key: "rosa",         label: "Rose",       view: squadView },
  { key: "formazione",   label: "Formazione", view: lineupView },
  { key: "giornate",     label: "Giornate",   view: matchdaysView },
  { key: "classifica",   label: "Classifica", view: standingsView },
  { key: "partite",      label: "Partite",    view: partiteView },
  { key: "impostazioni", label: "Impostazioni", view: settingsView },
];

const state = {
  store: null,
  route: { name: "home", leagueId: null, tab: null },
  league: null,
  matchdays: [],
  catalog: null,
  loading: false,
  error: null,
  unsubs: [],
  subscribedTo: null,
  presence: {},
  calendar: null,      // indice dei Titled Tuesday con risultati
  plan: null,          // piano della stagione, derivato dalla lega
  results: new Map(),  // n giornata -> classifica del torneo
};

/* -------------------------------- router ------------------------------- */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length) return { name: "home", leagueId: null, tab: null };
  if (parts[0] === "demo") return { name: "demo", leagueId: null, tab: null };
  if (parts[0] === "join" && parts[1]) return { name: "join", leagueId: parts[1], tab: null };
  if (parts[0] === "l" && parts[1]) {
    return { name: "league", leagueId: parts[1], tab: parts[2] || "asta" };
  }
  return { name: "home", leagueId: null, tab: null };
}

export function go(hash) {
  if (location.hash === hash) renderApp();
  else location.hash = hash;
}

/* ---------------------------- sottoscrizioni --------------------------- */

function unsubscribeAll() {
  state.unsubs.forEach((u) => { try { u(); } catch { /* gia' chiuso */ } });
  state.unsubs = [];
  stopHeartbeat();
}

/* ------------------------------- presenza ------------------------------ */

let heartbeat = null;

/**
 * Un battito periodico dice agli altri che sei collegato. Serve soprattutto
 * durante l'asta: sapere che qualcuno non c'e' cambia se ha senso aspettarlo.
 * Si batte anche al ritorno sulla scheda, per non risultare spento appena
 * riaperto il telefono.
 */
function startHeartbeat(id) {
  stopHeartbeat();
  const beat = () => {
    if (!state.store.touchPresence || !state.store.me) return;
    state.store.touchPresence(id, state.store.me.uid).catch(() => {});
  };
  beat();
  heartbeat = setInterval(beat, PRESENCE_BEAT);
  document.addEventListener("visibilitychange", onVisibleBeat);
}

function onVisibleBeat() {
  if (document.hidden || !state.subscribedTo) return;
  state.store.touchPresence?.(state.subscribedTo, state.store.me.uid).catch(() => {});
}

function stopHeartbeat() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  document.removeEventListener("visibilitychange", onVisibleBeat);
}

async function subscribeLeague(id) {
  unsubscribeAll();
  state.league = null;
  state.matchdays = [];
  state.catalog = null;
  state.presence = {};
  state.plan = null;
  state.results = new Map();
  ancoraStagione = null;
  state.error = null;
  state.loading = true;
  renderApp();

  let first = true;
  state.unsubs.push(state.store.watchLeague(id, async (lg) => {
    state.league = lg;
    state.loading = false;
    if (!lg) {
      state.error = "Lega non trovata. Il link e' giusto?";
      renderApp();
      return;
    }
    try {
      state.catalog = await loadCatalog(lg);
    } catch (err) {
      state.error = err.message;
    }
    await syncSeason();
    if (first) {
      first = false;
      state.unsubs.push(state.store.watchMatchdays(id, (mds) => {
        state.matchdays = [...mds].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        renderApp();
      }));
      if (state.store.watchPresence) {
        state.unsubs.push(state.store.watchPresence(id, (pres) => {
          state.presence = pres || {};
          renderApp();
        }));
      }
      startHeartbeat(id);
    }
    renderApp();
  }));
}

/* ------------------------------- stagione ------------------------------ */

/**
 * Ricalcola il piano della stagione e carica i risultati che mancano.
 *
 * Nessuno crea piu' le giornate a mano: sono i primi Titled Tuesday dopo la
 * chiusura dell'asta, e i punteggi arrivano da file statici pubblicati dalla
 * GitHub Action. Qui si scaricano solo quelli non ancora visti.
 */
let ancoraStagione = null;

async function syncSeason() {
  if (!state.league) return;
  // Il calendario si rilegge a ogni sincronizzazione: due leghe aperte
  // nella stessa sessione possono avere fonti diverse, e tenerne una copia
  // sola qui dentro voleva dire mostrare i turni di un torneo classico a
  // una lega sui Titled Tuesday. La cache vera sta in fonte.js.
  state.calendar = await loadCalendar(state.league);

  // I risultati stanno in una mappa indicizzata per NUMERO di giornata, e
  // quel numero non e' stabile: finche' l'asta e' aperta `startsAt` vale 0 e
  // il piano si riempie di Titled Tuesday gia' archiviati, tutti con i loro
  // punteggi; alla chiusura dell'asta `startsAt` diventa adesso e le stesse
  // caselle 1..N passano a indicare martedi' futuri. Senza svuotare, la
  // giornata 1 di domani si ritrovava addosso i punti di un torneo di mesi
  // fa: bastava avere una formazione per vedersi assegnare centinaia di
  // fantapunti prima ancora di giocare.
  const ancora = state.league.season?.startsAt || 0;
  if (ancora !== ancoraStagione) {
    ancoraStagione = ancora;
    state.results = new Map();
  }

  state.plan = seasonPlan(state.league, state.calendar);

  for (const slot of state.plan.slots) {
    if (slot.status !== "scored" && slot.status !== "pending") continue;
    if (state.results.has(slot.n)) continue;
    // In parallelo e senza bloccare: la pagina si ridisegna quando arrivano.
    loadResults(slot, state.league)
      .then((r) => { if (r) { state.results.set(slot.n, r); renderApp(); } })
      .catch(() => { /* giornata senza risultati: resta in attesa */ });
  }
}

/* ------------------------------ contesto ------------------------------- */

function buildCtx() {
  const store = state.store;
  const uid = store.me.uid;
  return {
    store,
    uid,
    me: store.me,
    league: state.league,
    matchdays: state.matchdays,
    catalog: state.catalog,
    presence: state.presence,
    plan: state.plan,
    results: state.results,
    isAdmin: isAdminOf(state.league, uid),
    go,
    refresh: renderApp,
    /** Scrittura transazionale sulla lega, con errore a schermo. */
    async mutate(fn) {
      try {
        await store.updateLeague(state.league.id, fn);
      } catch (err) {
        toast(err.message || "Operazione non riuscita", "err");
      }
    },
  };
}

/* ------------------------------- rendering ----------------------------- */

/** Ricorda focus e cursore prima di ridisegnare, per non interrompere chi scrive. */
function captureFocus() {
  const a = document.activeElement;
  if (!a || !a.dataset?.keep) return null;
  return {
    keep: a.dataset.keep,
    start: a.selectionStart ?? null,
    end: a.selectionEnd ?? null,
  };
}

function restoreFocus(snap) {
  if (!snap) return;
  const node = document.querySelector(`[data-keep="${CSS.escape(snap.keep)}"]`);
  if (!node) return;
  node.focus({ preventScroll: true });
  if (snap.start !== null && node.setSelectionRange) {
    try { node.setSelectionRange(snap.start, snap.end); } catch { /* non testuale */ }
  }
}

/* ------------------------------ menu laterale --------------------------- */

/**
 * Su schermo stretto le sei schede non stanno in orizzontale: diventano un
 * cassetto. Aprirlo blocca lo scorrimento dietro, altrimenti scorrendo il
 * menu si trascina anche la pagina sotto.
 */
function apriMenu() {
  if (document.body.classList.contains("menu-aperto")) return;
  document.body.classList.add("menu-aperto");
  document.body.style.overflow = "hidden";
  $("#btn-menu").setAttribute("aria-expanded", "true");
  // Il fuoco entra nel cassetto: chi naviga da tastiera non deve inseguirlo.
  $("#drawer").querySelector("button")?.focus({ preventScroll: true });
}

function chiudiMenu({ tornaAlPulsante = false } = {}) {
  if (!document.body.classList.contains("menu-aperto")) return;
  document.body.classList.remove("menu-aperto");
  document.body.style.overflow = "";
  const bottone = $("#btn-menu");
  bottone.setAttribute("aria-expanded", "false");
  if (tornaAlPulsante && !bottone.hidden) bottone.focus({ preventScroll: true });
}

function initMenu() {
  $("#btn-menu").onclick = () => {
    document.body.classList.contains("menu-aperto")
      ? chiudiMenu({ tornaAlPulsante: true })
      : apriMenu();
  };
  $("#btn-menu-close").onclick = () => chiudiMenu({ tornaAlPulsante: true });
  $("#scrim").onclick = () => chiudiMenu();
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") chiudiMenu({ tornaAlPulsante: true });
  });
  // Allargando la finestra il cassetto sparisce per CSS: se restasse
  // "aperto" lo scorrimento della pagina rimarrebbe bloccato a vuoto.
  window.addEventListener("resize", () => {
    if (window.innerWidth > 880) chiudiMenu();
  });
}

/* -------------------------------- chrome ------------------------------- */

function renderChrome() {
  const bar = $("#topbar");
  const inLeague = state.route.name === "league" && state.league;
  // La barra c'e' sempre da loggati: dentro una lega con le sue schede,
  // altrove solo col nome, che apre il profilo. Cosi' si vede sempre con
  // che account si e' entrati e da dove uscire.
  bar.hidden = !isAuthed();

  const tabsBox = $("#tabs");
  const invite = $("#btn-invite");
  const me = $("#me");

  const apriProfilo = (legaCorrente) => () => {
    chiudiMenu();
    import("./views/profile.js").then((m) =>
      m.showProfile(buildCtxLite(), { legaCorrente }));
  };

  if (!inLeague) {
    render(tabsBox);
    render($("#drawer-tabs"));
    render($("#drawer-foot"));
    $("#btn-menu").hidden = true;
    chiudiMenu();
    invite.hidden = true;
    // Fuori da una lega il chip serve solo se c'e' un account dietro:
    // in modalita' locale senza nome non mostra nulla di utile.
    const mostraChip = state.store.needsAuth || Boolean(state.store.me?.name);
    me.hidden = !mostraChip;
    me.textContent = state.store.me?.name || "Profilo";
    me.title = "Profilo e le tue leghe";
    me.onclick = apriProfilo(null);
    return;
  }
  me.hidden = false;
  $("#btn-menu").hidden = false;
  $("#drawer-title").textContent = state.league.name || "Lega";

  // Gli stessi comandi in due posti: in orizzontale sopra, in verticale nel
  // cassetto. Si costruiscono due volte perche' lo stesso nodo non puo'
  // stare in due punti del documento.
  const schede = () => TABS.map((t) => el("button.tab", {
    type: "button",
    onclick: () => { chiudiMenu(); go(`#/l/${state.league.id}/${t.key}`); },
    "aria-current": state.route.tab === t.key ? "page" : null,
  }, t.label));

  render(tabsBox, schede());
  render($("#drawer-tabs"), schede());

  const apriInvito = () => {
    chiudiMenu();
    import("./views/invite.js").then((m) => m.showInvite(state.league));
  };

  render($("#drawer-foot"),
    el("button.btn.btn-sm", { type: "button", onclick: apriInvito }, "Invita"),
    el("button.btn.btn-sm.btn-ghost", {
      type: "button", onclick: apriProfilo(state.league.id),
    }, "Profilo e altre leghe"),
  );

  invite.hidden = false;
  invite.onclick = apriInvito;
  me.textContent = state.store.me.name || "";
  me.title = "Profilo e altre leghe";
  me.onclick = apriProfilo(state.league.id);
}

function renderApp() {
  const root = $("#view");
  const snap = captureFocus();
  renderChrome();
  renderAvvisi();

  try {
    if (state.route.name === "demo") {
      // Il tutorial si guarda anche da sconosciuti: e' la vetrina, chiedere
      // di accedere prima di far vedere cos'e' sarebbe il modo piu' rapido
      // di perdere chi e' appena arrivato.
      render(root, tutorialView(buildCtxLite()));
    } else if (!isAuthed()) {
      render(root, loginView(buildCtxLite(), state.route.leagueId));
    } else if (state.route.name === "home") {
      render(root, homeView(buildCtxLite()));
    } else if (state.route.name === "join") {
      render(root, joinView(buildCtxLite(), state.route.leagueId));
    } else if (state.loading || (!state.league && !state.error)) {
      render(root, spinner());
    } else if (state.error) {
      render(root, el("div.card.stack",
        el("h2", "Ops"),
        el("p.muted", state.error),
        el("a.btn.btn-primary", { href: "#/" }, "Torna alla home"),
      ));
    } else {
      const tab = TABS.find((t) => t.key === state.route.tab) || TABS[0];
      render(root, tab.view(buildCtx()));
    }
  } catch (err) {
    console.error(err);
    render(root, el("div.card.stack",
      el("h2", "Errore imprevisto"),
      el("p.muted.small.mono", String(err?.message || err)),
      el("a.btn", { href: "#/" }, "Torna alla home"),
    ));
  }

  restoreFocus(snap);
  document.title = state.league ? `${state.league.name} · Fantascacchi` : "Fantascacchi";
}

/**
 * La striscia degli inviti in cima. Solo da loggati: a chi deve ancora
 * entrare non si chiede di installare niente.
 */
function renderAvvisi() {
  const slot = $("#avvisi");
  if (!slot) return;
  if (!isAuthed()) { render(slot); return; }
  try {
    render(slot, avvisiSlot({ ...buildCtxLite(), league: state.league }));
  } catch (err) {
    console.error("avvisi", err);
    render(slot);
  }
}

/** Contesto ridotto per le viste che non hanno una lega caricata. */
function buildCtxLite() {
  // Nella schermata di login `me` e' ancora null: niente accessi ciechi a .uid.
  const me = state.store.me;
  return { store: state.store, me, uid: me?.uid || null, go, refresh: renderApp };
}

/* -------------------------------- avvio -------------------------------- */

/** C'e' una sessione utilizzabile? In locale sempre; su Firebase solo dopo il login. */
function isAuthed() {
  return !state.store.needsAuth || Boolean(state.store.me);
}

async function onRouteChange() {
  state.route = parseHash();

  if (state.route.name === "demo") {
    unsubscribeAll();
    state.subscribedTo = null;
    renderApp();
    return;
  }

  // Senza sessione non si legge nulla da Firestore: si mostra il login.
  if (!isAuthed()) {
    unsubscribeAll();
    state.subscribedTo = null;
    state.league = null;
    renderApp();
    return;
  }

  if (state.route.name === "league") {
    // Confrontare le rotte non basterebbe: dopo il login la rotta e' la
    // stessa di prima, ma la sottoscrizione non era mai partita.
    if (state.subscribedTo !== state.route.leagueId) {
      state.subscribedTo = state.route.leagueId;
      await subscribeLeague(state.route.leagueId);
      return;
    }
  } else {
    unsubscribeAll();
    state.subscribedTo = null;
  }
  renderApp();
}

async function main() {
  // Prima di tutto: l'evento di installazione arriva presto e una volta sola.
  initInstall();
  initMenu();
  try {
    state.store = await getStore();
  } catch (err) {
    render($("#view"), el("div.card.stack",
      el("h2", "Avvio non riuscito"),
      el("p.muted", String(err?.message || err)),
    ));
    return;
  }
  window.addEventListener("hashchange", onRouteChange);
  // Login e logout devono rieseguire il routing: e' cosi' che chi arriva
  // da un link d'invito ci finisce sopra subito dopo essersi autenticato.
  state.store.onAuthChange(() => { onRouteChange(); });
  await onRouteChange();

  // In coda: legge lo stato delle notifiche e riallinea l'iscrizione push.
  // Non deve rallentare il primo disegno, quindi niente await.
  initAvvisi(buildCtxLite()).catch(() => {});

  if (state.store.mode === "local") {
    console.info("Fantascacchi: modalita' LOCALE (dati solo in questo browser). "
      + "Per giocare online configura Firebase in js/config.js.");
  }
}

export { inviteLink };
main();

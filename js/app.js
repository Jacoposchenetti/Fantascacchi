/* ---------------------------------------------------------------
   Bootstrap, router a hash (obbligatorio su GitHub Pages) e chrome.

   Ogni vista e' una funzione pura (ctx) -> Node. L'app si risottoscrive
   ai dati della lega e ridisegna la vista attiva a ogni cambiamento;
   il focus e la posizione del cursore vengono ripristinati dopo il
   ridisegno, cosi' scrivere in un campo di ricerca non "salta".
   --------------------------------------------------------------- */

import { $, render, el, toast, spinner } from "./ui.js";
import { getStore } from "./store.js";
import { loadCatalog, isAdmin as isAdminOf, inviteLink } from "./league.js";

import homeView from "./views/home.js";
import joinView from "./views/join.js";
import auctionView from "./views/auction.js";
import squadView from "./views/squad.js";
import lineupView from "./views/lineup.js";
import matchdaysView from "./views/matchdays.js";
import standingsView from "./views/standings.js";
import settingsView from "./views/settings.js";

const TABS = [
  { key: "asta",         label: "Asta",       view: auctionView },
  { key: "rosa",         label: "Rose",       view: squadView },
  { key: "formazione",   label: "Formazione", view: lineupView },
  { key: "giornate",     label: "Giornate",   view: matchdaysView },
  { key: "classifica",   label: "Classifica", view: standingsView },
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
};

/* -------------------------------- router ------------------------------- */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length) return { name: "home", leagueId: null, tab: null };
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
}

async function subscribeLeague(id) {
  unsubscribeAll();
  state.league = null;
  state.matchdays = [];
  state.catalog = null;
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
    if (first) {
      first = false;
      state.unsubs.push(state.store.watchMatchdays(id, (mds) => {
        state.matchdays = [...mds].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        renderApp();
      }));
    }
    renderApp();
  }));
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

function renderChrome() {
  const bar = $("#topbar");
  const inLeague = state.route.name === "league" && state.league;
  bar.hidden = !inLeague && state.route.name !== "join";

  const tabsBox = $("#tabs");
  const invite = $("#btn-invite");

  if (!inLeague) {
    render(tabsBox);
    invite.hidden = true;
    $("#me").textContent = "";
    return;
  }

  render(tabsBox, TABS.map((t) => el("button.tab", {
    type: "button",
    onclick: () => go(`#/l/${state.league.id}/${t.key}`),
    "aria-current": state.route.tab === t.key ? "page" : null,
  }, t.label)));

  invite.hidden = false;
  invite.onclick = () => {
    import("./views/invite.js").then((m) => m.showInvite(state.league));
  };
  $("#me").textContent = state.store.me.name || "";
  $("#me").title = state.store.me.name || "";
}

function renderApp() {
  const root = $("#view");
  const snap = captureFocus();
  renderChrome();

  try {
    if (state.route.name === "home") {
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

/** Contesto ridotto per le viste che non hanno una lega caricata. */
function buildCtxLite() {
  const me = state.store.me;
  return { store: state.store, me, uid: me.uid, go, refresh: renderApp };
}

/* -------------------------------- avvio -------------------------------- */

async function onRouteChange() {
  const next = parseHash();
  const changedLeague = next.leagueId !== state.route.leagueId || next.name !== state.route.name;
  state.route = next;

  if (next.name === "league" && changedLeague) {
    await subscribeLeague(next.leagueId);
    return;
  }
  if (next.name !== "league") unsubscribeAll();
  renderApp();
}

async function main() {
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
  await onRouteChange();

  if (state.store.mode === "local") {
    console.info("Fantascacchi: modalita' LOCALE (dati solo in questo browser). "
      + "Per giocare online configura Firebase in js/config.js.");
  }
}

export { inviteLink };
main();

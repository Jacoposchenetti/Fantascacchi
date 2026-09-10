/* ---------------------------------------------------------------
   Salary cap — schermata.

   Ognuno compone la propria rosa in autonomia: prezzo fisso, budget da
   rispettare, nessuna competizione per i giocatori. Alla scadenza chi
   non ha finito viene completato d'ufficio e parte la stagione.
   --------------------------------------------------------------- */

import { el, toast, empty, flag, confirmDialog } from "../ui.js";
import {
  catalogList, ownedCount, budgetLeft, members, memberName, rosterOf,
} from "../league.js";
import {
  budgetSalary, togglePlayer, chiudiSalary, tuttiCompleti,
  prossimaScadenzaSalary, mancaAllaSalary,
} from "../salary.js";
import { showPlayer } from "./player.js";
import lobbyView from "./lobby.js";

let filtro = "";
let ticker = null;
let chiudendo = false;

export default function salaryView(ctx) {
  clearInterval(ticker);
  ticker = null;

  const { league, catalog } = ctx;
  if (!catalog) return el("div.card", "Carico il listone…");
  if (league.phase === "lobby") return lobbyView(ctx);
  if (league.phase !== "auction") return null;

  const scad = league.salary?.deadline || 0;
  const scaduta = scad > 0 && Date.now() >= scad;
  if (scaduta || (scad > 0 && tuttiCompleti(league))) provaAChiudere(ctx);

  return el("div.stack", { style: "gap:1.4rem" },
    testata(ctx, scad, scaduta),
    !scaduta && laMiaRosa(ctx),
    !scaduta && listone(ctx),
    ...members(league).filter((m) => m.uid !== ctx.uid).map((m) => rosaAltro(ctx, m)),
  );
}

/* ------------------------------- testata ------------------------------- */

function testata(ctx, scad, scaduta) {
  const { league } = ctx;

  if (!scad) {
    return el("div.card.card-hi.stack-s", { style: "text-align:center" },
      el("span.badge.badge-gold", { style: "margin:0 auto" }, "Salary cap"),
      el("h2", "Non è ancora aperto"),
      el("p.muted.small", { style: "margin:0" },
        ctx.isAdmin
          ? "Apri la finestra: da lì ognuno compone la rosa quando vuole, entro la scadenza."
          : `Aspetta che ${memberName(league, league.adminUid)} apra la finestra.`),
      ctx.isAdmin && el("button.btn.btn-primary", { onclick: () => apri(ctx) },
        "Apri il salary cap"),
    );
  }

  const nodo = el("div.auction-timer", { style: "margin:0" }, "—");
  if (!scaduta) {
    const tick = () => {
      nodo.textContent = mancaAllaSalary(scad);
      nodo.classList.toggle("urgent", scad - Date.now() < 3600e3);
      if (Date.now() >= scad) { clearInterval(ticker); ctx.refresh(); }
    };
    tick();
    ticker = setInterval(tick, 1000);
  } else {
    nodo.textContent = "Scaduta";
  }

  const restano = members(league).filter(
    (m) => ownedCount(league, m.uid) < league.rosterSize).length;

  return el("div.card.card-hi.stack-s", { style: "text-align:center" },
    el("span.badge.badge-gold", { style: "margin:0 auto" }, "Salary cap"),
    el("h2", scaduta ? "Chiusura in corso…" : "Finestra aperta"),
    nodo,
    el("p.muted.small", { style: "margin:0" },
      scaduta
        ? "Completo le rose non finite e faccio partire la stagione."
        : `${restano} ${restano === 1 ? "partecipante deve" : "partecipanti devono"} `
          + "ancora completare la rosa. Lo stesso giocatore può stare in più rose."),
    ctx.isAdmin && !scaduta && el("button.btn.btn-ghost.btn-sm", {
      style: "justify-self:center",
      onclick: () => chiudiOra(ctx),
    }, "Chiudi adesso"),
  );
}

/* ------------------------------ la mia rosa -------------------------- */

function laMiaRosa(ctx) {
  const { league, catalog, uid } = ctx;
  const rows = rosterOf(league, catalog, uid);
  const budget = budgetSalary(league, uid);
  const slot = league.rosterSize - rows.length;

  return el("section",
    el("div.section-head",
      el("h2", "La tua rosa"),
      el("span.small.muted",
        el("span.mono", `${budget}`), " crediti · ",
        el("span.mono", `${slot}`), " da riempire")),

    el("div.bar", { style: "margin-bottom:.6rem" },
      el("i", { style: `width:${Math.round((budget / league.budget) * 100)}%` })),

    rows.length === 0
      ? el("div.card.card-tight.center.mute-2.small", "Vuota. Scegli dal listone qui sotto.")
      : el("div.plist", rows.map(({ player: p, price }) => el("div.pcard.pcard-split",
          el("button.pcard-main", { type: "button", onclick: () => showPlayer(ctx, p) },
            p.avatar
              ? el("img.pav", { src: p.avatar, alt: "", loading: "lazy" })
              : el("div.pav", { style: "display:grid;place-items:center" }, "♟"),
            el("div.pmain",
              el("div.pname",
                p.title && el("span.title-tag", { class: p.title.toLowerCase() }, p.title),
                el("span", p.name)),
              el("div.pmeta", el("span", `${p.rating} blitz`),
                p.window && el("span", `presente ${p.events}/${p.window}`)))),
          el("div.pcard-side",
            el("div.pprice", price),
            el("button.btn.btn-sm.btn-ghost", {
              onclick: () => toggle(ctx, p), "aria-label": "Togli dalla rosa",
            }, "Togli")),
        ))),
  );
}

/* -------------------------------- listone ---------------------------- */

function listone(ctx) {
  const { league, catalog, uid } = ctx;
  const mia = league.salaryRosters?.[uid] || {};
  const budget = budgetSalary(league, uid);
  const pieno = ownedCount(league, uid) >= league.rosterSize;

  const q = filtro.trim().toLowerCase();
  let list = catalogList(catalog);
  if (q) {
    list = list.filter((p) =>
      p.name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q));
  }
  list.sort((a, b) => b.price - a.price);

  return el("section",
    el("div.section-head", el("h2", "Listone"),
      el("span.small.muted", `${list.length} giocatori`)),

    pieno && el("div.notice", "Rosa completa. Togli qualcuno per cambiare."),

    el("input", {
      type: "search", placeholder: "Cerca…", value: filtro,
      "data-keep": "salary-search", style: "margin-bottom:.7rem",
      oninput: (e) => { filtro = e.target.value; ctx.refresh(); },
    }),

    el("div.plist", list.slice(0, 200).map((p) => {
      const preso = mia[p.id] !== undefined;
      const troppoCaro = !preso && p.price > budget;
      return el("div.pcard.pcard-split", { class: preso ? "is-picked" : "" },
        el("button.pcard-main", { type: "button", onclick: () => showPlayer(ctx, p) },
          p.avatar
            ? el("img.pav", { src: p.avatar, alt: "", loading: "lazy" })
            : el("div.pav", { style: "display:grid;place-items:center" }, "♟"),
          el("div.pmain",
            el("div.pname",
              p.title && el("span.title-tag", { class: p.title.toLowerCase() }, p.title),
              el("span", p.name)),
            el("div.pmeta",
              flag(p.country) && el("span", flag(p.country)),
              el("span", `${p.rating} blitz`),
              p.window && el("span", `presente ${p.events}/${p.window}`))),
        ),
        el("div.pcard-side",
          el("div.pprice", p.price),
          el("button.btn.btn-sm", {
            class: preso ? "btn-primary" : "",
            disabled: !preso && (pieno || troppoCaro),
            onclick: () => toggle(ctx, p),
          }, preso ? "Tolta" : troppoCaro ? "Fuori budget" : "Prendi"),
        ),
      );
    })),
  );
}

function rosaAltro(ctx, m) {
  const rows = rosterOf(ctx.league, ctx.catalog, m.uid);
  return el("section",
    el("div.section-head",
      el("h3", m.name),
      el("span.small.muted",
        `${rows.length}/${ctx.league.rosterSize} · ${budgetLeft(ctx.league, m.uid)} crediti`)),
    rows.length === 0
      ? el("div.card.card-tight.center.mute-2.small", "Non ha ancora scelto")
      : el("div.plist", rows.map(({ player: p, price }) => el("div.pcard",
          el("div.pav", { style: "display:grid;place-items:center" }, "♟"),
          el("div.pmain", el("div.pname",
            p.title && el("span.title-tag", { class: p.title.toLowerCase() }, p.title),
            el("span", p.name))),
          el("div.pright.pprice", price),
        ))),
  );
}

/* -------------------------------- azioni ----------------------------- */

async function toggle(ctx, p) {
  await ctx.mutate((lg) => togglePlayer(lg, ctx.uid, p.id, p.price));
}

async function apri(ctx) {
  const g = ctx.league.salaryDays || 3;
  const ok = await confirmDialog("Aprire il salary cap?",
    `Tutti avranno ${g} ${g === 1 ? "giorno" : "giorni"} per comporre la rosa. `
    + "Alla scadenza chi non ha finito viene completato d'ufficio.", "Apri");
  if (!ok) return;
  await ctx.mutate((lg) => {
    if (lg.salary?.deadline) return null;
    lg.salary = { ...(lg.salary || {}), deadline: prossimaScadenzaSalary(lg) };
    return lg;
  });
}

async function chiudiOra(ctx) {
  const ok = await confirmDialog("Chiudere adesso?",
    "Le rose non complete vengono riempite d'ufficio e comincia la stagione.", "Chiudi");
  if (!ok) return;
  await ctx.mutate((lg) => { lg.salary = { ...lg.salary, deadline: Date.now() }; return lg; });
}

async function provaAChiudere(ctx) {
  if (chiudendo) return;
  chiudendo = true;
  try {
    const liberi = catalogList(ctx.catalog)
      .map((p) => ({ id: p.id, price: p.price }))
      .sort((a, b) => a.price - b.price);
    await ctx.mutate((lg) => {
      if (lg.phase !== "auction") return null;
      const scad = lg.salary?.deadline || 0;
      if (!scad || (Date.now() < scad && !tuttiCompleti(lg))) return null;
      return chiudiSalary(lg, liberi);
    });
  } finally {
    chiudendo = false;
  }
}

/* ---------------------------------------------------------------
   Draft a serpentina — schermata.

   Turni, niente offerte. Quando tocca a te scegli un giocatore dalla
   lista; allo scadere del tempo lo sceglie l'app per te (il più quotato
   ancora libero), così il draft non si blocca mai.
   --------------------------------------------------------------- */

import { el, toast, empty, flag, confirmDialog } from "../ui.js";
import {
  catalogList, ownerOf, ownedCount,
  members, memberName, rosterOf,
} from "../league.js";
import {
  chiSceglie, numeroPick, tempoPick, totalePick, ordineGiro,
  scegli, avanza, prossimaScadenza,
} from "../draft.js";
import { showPlayer } from "./player.js";
import lobbyView from "./lobby.js";

let filtro = "";
let ticker = null;
let autoInCorso = false;

export default function draftView(ctx) {
  clearInterval(ticker);
  ticker = null;

  const { league, catalog } = ctx;
  if (!catalog) return el("div.card", "Carico il listone…");
  if (league.phase === "lobby") return lobbyView(ctx);
  if (league.phase !== "auction") return null;   // gestito da auction.js

  const turno = chiSceglie(league);
  const mio = turno === ctx.uid;
  const scaduto = (tempoPick(league) ?? 1) <= 0;

  // Allo scadere: chi tocca sceglie d'ufficio il migliore libero.
  if (turno && scaduto) autoPick(ctx, turno);

  return el("div.stack", { style: "gap:1.4rem" },
    testata(ctx, turno, mio),
    tabellone(ctx),
    !turno ? null : listone(ctx, mio),
    ...members(league).map((m) => rosaMembro(ctx, m)),
  );
}

/* ------------------------------- testata ------------------------------- */

function testata(ctx, turno, mio) {
  const { league } = ctx;
  const fatte = numeroPick(league) - 1;
  const tot = totalePick(league);

  if (!turno) {
    return el("div.card.card-hi.stack-s", { style: "text-align:center" },
      el("h2", "Draft completato"),
      el("p.muted.small", { style: "margin:0" }, "Le rose sono fatte. Comincia la stagione."),
      el("button.btn.btn-primary", {
        onclick: () => ctx.go(`#/l/${league.id}/formazione`),
      }, "Vai alla formazione"),
    );
  }

  const nodoTempo = el("div.auction-timer", { style: "margin:0" }, "—");
  const end = league.draft?.turnEndsAt || 0;
  if (end) {
    const tick = () => {
      const left = Math.max(0, end - Date.now());
      nodoTempo.textContent = left > 0 ? `${Math.ceil(left / 1000)}s` : "Scelta d'ufficio…";
      nodoTempo.classList.toggle("urgent", left > 0 && left <= 10000);
      if (left <= 0) { clearInterval(ticker); ctx.refresh(); }
    };
    tick();
    ticker = setInterval(tick, 250);
  }

  return el("div.card.card-hi.stack-s", { style: "text-align:center" },
    el("span.badge.badge-gold", { style: "margin:0 auto" },
      `Giro ${league.draft?.round || 1} di ${league.rosterSize} · scelta ${fatte + 1}/${tot}`),
    el("h2", mio ? "Tocca a te scegliere" : `Sceglie ${memberName(league, turno)}`),
    nodoTempo,
    el("p.muted.small", { style: "margin:0" },
      mio ? "Prendi un giocatore dalla lista qui sotto: è tuo, senza rilanci."
          : "Appena sceglie, il turno passa al prossimo. L'ordine si inverte a ogni giro."),
  );
}

/* ------------------------------ il tabellone -------------------------- */

function tabellone(ctx) {
  const { league } = ctx;
  const d = league.draft || {};
  const order = d.order?.length ? d.order : members(league).map((m) => m.uid);
  const seq = ordineGiro(order, d.round || 1);
  const idx = d.pickIdx || 0;

  return el("div.card.card-tight",
    el("div.small.mute-2", { style: "margin-bottom:.4rem" },
      `Ordine del giro ${d.round || 1}`),
    el("div.row", { style: "gap:.4rem" }, seq.map((uid, i) => el("span.badge", {
      class: i === idx ? "badge-gold" : i < idx ? "" : "badge-blue",
      style: i < idx ? "opacity:.5" : "",
    }, `${i + 1}. ${memberName(league, uid)}`))),
  );
}

/* -------------------------------- listone ---------------------------- */

function listone(ctx, mio) {
  const { league, catalog } = ctx;
  const q = filtro.trim().toLowerCase();
  let list = catalogList(catalog).filter((p) => !ownerOf(league, p.id));
  if (q) {
    list = list.filter((p) =>
      p.name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q));
  }
  list.sort((a, b) => b.price - a.price);

  return el("section",
    el("div.section-head", el("h2", "Giocatori liberi"),
      el("span.small.muted", `${list.length}`)),

    el("input", {
      type: "search", placeholder: "Cerca…", value: filtro,
      "data-keep": "draft-search", style: "margin-bottom:.7rem",
      oninput: (e) => { filtro = e.target.value; ctx.refresh(); },
    }),

    list.length === 0
      ? empty("🔍", "Nessun giocatore")
      : el("div.plist", list.slice(0, 200).map((p) => el("div.pcard.pcard-split",
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
            mio
              ? el("button.btn.btn-sm.btn-primary", { onclick: () => fai(ctx, p) }, "Scegli")
              : el("div.small.mute-2", "valore"),
          ),
        ))),
  );
}

function rosaMembro(ctx, m) {
  const rows = rosterOf(ctx.league, ctx.catalog, m.uid);
  if (!rows.length) return null;
  return el("section",
    el("div.section-head",
      el("h3", m.name, m.uid === ctx.uid ? el("span.muted.small", " · tu") : null),
      el("span.small.muted", `${rows.length}/${ctx.league.rosterSize}`)),
    el("div.plist", rows.map(({ player: p }) => el("div.pcard",
      el("div.pav", { style: "display:grid;place-items:center" }, "♟"),
      el("div.pmain", el("div.pname",
        p.title && el("span.title-tag", { class: p.title.toLowerCase() }, p.title),
        el("span", p.name))),
      el("div.pright.small.mute-2", `${p.rating}`),
    ))),
  );
}

/* -------------------------------- azioni ----------------------------- */

async function fai(ctx, p) {
  await ctx.mutate((lg) => scegli(lg, ctx.uid, p.id, p.price));
}

async function autoPick(ctx, turno) {
  // Solo un client fa la scelta d'ufficio: gli altri trovano il turno avanzato.
  if (autoInCorso) return;
  autoInCorso = true;
  try {
    const migliore = catalogList(ctx.catalog)
      .filter((p) => !ownerOf(ctx.league, p.id))
      .sort((a, b) => b.price - a.price)[0];
    await ctx.mutate((lg) => {
      if (chiSceglie(lg) !== turno) return null;             // gia' avanzato
      if ((lg.draft?.turnEndsAt || 0) > Date.now()) return null;
      if (migliore && !lg.roster?.[migliore.id]) {
        return scegli(lg, turno, migliore.id, migliore.price);
      }
      return avanza(lg);                                     // listone finito
    });
  } finally {
    autoInCorso = false;
  }
}

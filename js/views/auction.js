/* ---------------------------------------------------------------
   Asta a chiamata.

   Il lotto vive dentro league.auction: { playerId, bid, bidderUid, endsAt }.
   endsAt e' un istante assoluto, quindi ogni client calcola da solo quanto
   manca. Quando scade, il PRIMO client che se ne accorge prova a chiudere
   il lotto con una transazione; gli altri trovano lo stato gia' cambiato
   e non fanno nulla. Nessun server, nessuna doppia assegnazione.
   --------------------------------------------------------------- */

import { el, toast, empty, flag, confirmDialog, modal } from "../ui.js";
import {
  catalogList, ownerOf, ownedCount, budgetLeft, maxBid,
  members, memberName, nominator, auctionComplete,
} from "../league.js";

let filter = "";
let onlyFree = true;
let ticker = null;

export default function auctionView(ctx) {
  clearInterval(ticker);
  ticker = null;

  const { league, catalog } = ctx;
  if (!catalog) return el("div.card", "Carico il listone…");

  if (league.phase !== "auction") {
    return el("div.stack",
      el("div.card.stack",
        el("h2", "Asta chiusa"),
        el("p.muted", { style: "margin:0" }, "Le rose sono complete. Da qui si gioca a colpi di formazione."),
        el("div.row",
          el("button.btn.btn-primary", { onclick: () => ctx.go(`#/l/${league.id}/formazione`) }, "Vai alla formazione"),
          ctx.isAdmin && el("button.btn.btn-ghost", {
            onclick: async () => {
              if (await confirmDialog("Riaprire l'asta?",
                "Le rose restano come sono, ma si potranno comprare altri giocatori.", "Riapri")) {
                ctx.mutate((lg) => { lg.phase = "auction"; return lg; });
              }
            },
          }, "Riapri l'asta"),
        ),
      ),
      memberPanel(ctx),
    );
  }

  const a = league.auction || {};
  const running = a.status === "running" && a.playerId;

  return el("div.stack",
    running ? lotStage(ctx, a) : nominationStage(ctx),
    memberPanel(ctx),
    !running && playerPicker(ctx),
  );
}

/* ------------------------------- il lotto ------------------------------ */

function lotStage(ctx, a) {
  const { league, catalog, uid } = ctx;
  const p = catalog.map.get(a.playerId);
  const leader = a.bidderUid;
  const iLead = leader === uid;
  const myMax = maxBid(league, uid);
  const canBid = !iLead && ownedCount(league, uid) < league.rosterSize && myMax > a.bid;

  const timerNode = el("div.auction-timer", "—");
  startTicker(ctx, a, timerNode);

  const steps = [1, 5, 10, 25].filter((s) => a.bid + s <= myMax);

  return el("div.auction-stage",
    el("span.badge.badge-gold", { style: "justify-self:center" }, "All'asta"),

    el("div.auction-player",
      p?.avatar && el("img", { src: p.avatar, alt: "", loading: "lazy" }),
      el("div", { style: "text-align:left" },
        el("div", { style: "font:800 1.25rem/1.15 var(--display)" },
          p?.title ? el("span.title-tag", { class: titleClass(p.title) }, p.title) : null,
          " " + (p?.name || a.playerId)),
        el("div.muted.small",
          flag(p?.country), " ", p?.rating ? `${p.rating} blitz` : "",
          p?.avgPoints ? ` · media ${p.avgPoints}/11` : ""),
      ),
    ),

    el("div",
      el("div.auction-bid", a.bid, el("span", { style: "font-size:.4em" }, " cr")),
      el("div.small.muted",
        iLead ? el("strong", { style: "color:var(--gold)" }, "Sei tu al comando")
              : `Offerta di ${memberName(league, leader)}`),
    ),

    timerNode,

    canBid
      ? el("div.stack-s",
          el("div.bidbar", steps.map((s) => el("button.btn", {
            onclick: () => bid(ctx, a.bid + s),
          }, "+" + s))),
          el("div.row", { style: "justify-content:center" },
            el("button.btn.btn-primary", { onclick: () => openCustomBid(ctx, a, myMax) },
              "Offerta libera"),
            myMax > a.bid && el("button.btn.btn-ghost", { onclick: () => bid(ctx, myMax) },
              `Tutto (${myMax})`),
          ),
          el("div.small.mute-2", `Puoi arrivare a ${myMax} crediti`),
        )
      : el("div.small.muted",
          iLead ? "Aspetta: se nessuno rilancia, è tuo."
                : ownedCount(league, uid) >= league.rosterSize ? "Hai la rosa piena."
                : "Crediti insufficienti per rilanciare."),

    ctx.isAdmin && el("button.btn.btn-ghost.btn-sm", {
      style: "justify-self:center",
      onclick: async () => {
        if (await confirmDialog("Annullare il lotto?",
          `${p?.name || a.playerId} torna libero e nessuno paga.`, "Annulla lotto")) {
          ctx.mutate((lg) => {
            lg.auction = { ...lg.auction, status: "idle", playerId: null, bid: 0, bidderUid: null, endsAt: 0 };
            return lg;
          });
        }
      },
    }, "Annulla il lotto"),
  );
}

/** Aggiorna solo il nodo del timer, e alla scadenza prova a chiudere. */
function startTicker(ctx, a, node) {
  let closing = false;
  const tick = () => {
    const left = Math.max(0, (a.endsAt || 0) - Date.now());
    const secs = Math.ceil(left / 1000);
    node.textContent = left > 0 ? `${secs}s` : "Assegnato…";
    node.classList.toggle("urgent", left > 0 && left <= 5000);
    if (left <= 0 && !closing) {
      closing = true;
      clearInterval(ticker);
      closeLot(ctx);
    }
  };
  tick();
  ticker = setInterval(tick, 200);
}

async function bid(ctx, amount) {
  const uid = ctx.uid;
  await ctx.mutate((lg) => {
    const a = lg.auction || {};
    if (a.status !== "running") throw new Error("Il lotto si è già chiuso");
    if (Date.now() > a.endsAt) throw new Error("Tempo scaduto");
    if (a.bidderUid === uid) return null;
    if (amount <= a.bid) throw new Error("Devi superare l'offerta attuale");
    if (ownedCount(lg, uid) >= lg.rosterSize) throw new Error("Hai già la rosa piena");
    if (amount > maxBid(lg, uid)) {
      throw new Error(`Puoi arrivare al massimo a ${maxBid(lg, uid)} crediti`);
    }
    lg.auction = {
      ...a, bid: amount, bidderUid: uid,
      endsAt: Date.now() + (lg.bidSeconds || 20) * 1000,
    };
    return lg;
  });
}

/** Chiude il lotto. Idempotente: chi arriva secondo non trova nulla da fare. */
async function closeLot(ctx) {
  await ctx.mutate((lg) => {
    const a = lg.auction || {};
    if (a.status !== "running" || !a.playerId) return null;
    if (Date.now() < a.endsAt) return null;
    if (lg.roster?.[a.playerId]) return null;

    lg.roster = {
      ...lg.roster,
      [a.playerId]: { playerId: a.playerId, ownerUid: a.bidderUid, price: a.bid, at: Date.now() },
    };
    lg.auction = {
      status: "idle", playerId: null, bid: 0, bidderUid: null, endsAt: 0,
      turnIdx: (a.turnIdx || 0) + 1,
    };
    if (auctionComplete(lg)) lg.phase = "season";
    return lg;
  });
}

function openCustomBid(ctx, a, myMax) {
  modal((close) => {
    const form = el("form.stack", {
      onsubmit: (ev) => {
        ev.preventDefault();
        const v = Number(new FormData(form).get("amt"));
        close();
        bid(ctx, v);
      },
    },
      el("h2", "Offerta libera"),
      el("label.field", `Fra ${a.bid + 1} e ${myMax} crediti`,
        el("input", {
          type: "number", name: "amt", min: a.bid + 1, max: myMax,
          value: Math.min(a.bid + 10, myMax), required: true, autofocus: true,
        })),
      el("div.row", { style: "justify-content:flex-end" },
        el("button.btn.btn-ghost", { type: "button", onclick: close }, "Annulla"),
        el("button.btn.btn-primary", { type: "submit" }, "Rilancia"),
      ),
    );
    return form;
  });
}

/* ------------------------------ la chiamata ---------------------------- */

function nominationStage(ctx) {
  const { league, uid } = ctx;
  const turn = nominator(league);
  const mine = turn === uid;

  if (!turn) {
    return el("div.card.stack",
      el("h2", "Rose complete"),
      el("p.muted", { style: "margin:0" }, "Tutti hanno riempito la rosa."),
      ctx.isAdmin && el("button.btn.btn-primary", {
        onclick: () => ctx.mutate((lg) => { lg.phase = "season"; return lg; }),
      }, "Chiudi l'asta e inizia la stagione"),
    );
  }

  return el("div.card.card-hi.stack-s", { style: "text-align:center" },
    el("span.badge.badge-gold", { style: "margin:0 auto" }, "Turno di chiamata"),
    el("h2", mine ? "Tocca a te" : `Tocca a ${memberName(league, turn)}`),
    el("p.muted.small", { style: "margin:0" },
      mine ? "Scegli un giocatore dalla lista qui sotto: parte da 1 credito e sei tu il primo offerente."
           : "Appena chiama, il lotto compare qui e potrai rilanciare."),
  );
}

async function nominate(ctx, playerId) {
  const uid = ctx.uid;
  await ctx.mutate((lg) => {
    if (lg.auction?.status === "running") throw new Error("C'è già un lotto in corso");
    if (nominator(lg) !== uid) throw new Error("Non è il tuo turno di chiamata");
    if (lg.roster?.[playerId]) throw new Error("Giocatore già assegnato");
    if (ownedCount(lg, uid) >= lg.rosterSize) throw new Error("Hai già la rosa piena");
    if (maxBid(lg, uid) < 1) throw new Error("Non hai crediti sufficienti");
    lg.auction = {
      status: "running", playerId, bid: 1, bidderUid: uid,
      endsAt: Date.now() + (lg.bidSeconds || 20) * 1000,
      turnIdx: lg.auction?.turnIdx || 0,
    };
    return lg;
  });
}

/* ------------------------------ lista scelta --------------------------- */

function playerPicker(ctx) {
  const { league, catalog, uid } = ctx;
  const myTurn = nominator(league) === uid;

  const q = filter.trim().toLowerCase();
  let list = catalogList(catalog);
  if (onlyFree) list = list.filter((p) => !ownerOf(league, p.id));
  if (q) {
    list = list.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.username.toLowerCase().includes(q) ||
      (p.title || "").toLowerCase() === q);
  }
  list.sort((a, b) => b.price - a.price);

  return el("section",
    el("div.section-head",
      el("h2", "Listone"),
      el("span.small.muted", `${list.length} giocatori`)),

    el("div.row", { style: "margin-bottom:.7rem" },
      el("input", {
        type: "search", placeholder: "Cerca per nome, username o titolo…",
        value: filter, "data-keep": "auction-search",
        style: "flex:1;min-width:180px",
        oninput: (e) => { filter = e.target.value; ctx.refresh(); },
      }),
      el("div.seg",
        el("button", {
          type: "button", "aria-pressed": String(onlyFree),
          onclick: () => { onlyFree = true; ctx.refresh(); },
        }, "Liberi"),
        el("button", {
          type: "button", "aria-pressed": String(!onlyFree),
          onclick: () => { onlyFree = false; ctx.refresh(); },
        }, "Tutti"),
      ),
    ),

    list.length === 0
      ? empty("🔍", "Nessun giocatore trovato")
      : el("div.plist", list.slice(0, 120).map((p) => playerRow(ctx, p, myTurn))),

    list.length > 120 && el("p.center.small.mute-2",
      `…e altri ${list.length - 120}. Affina la ricerca.`),
  );
}

function playerRow(ctx, p, myTurn) {
  const { league } = ctx;
  const owner = ownerOf(league, p.id);
  const disabled = Boolean(owner) || !myTurn;

  return el(myTurn && !owner ? "button.pcard" : "div.pcard", {
    class: owner ? "is-owned" : "",
    type: myTurn && !owner ? "button" : null,
    disabled: disabled && myTurn ? true : null,
    onclick: myTurn && !owner ? () => nominate(ctx, p.id) : null,
  },
    p.avatar
      ? el("img.pav", { src: p.avatar, alt: "", loading: "lazy" })
      : el("div.pav", { style: "display:grid;place-items:center;font-size:1rem" }, "♟"),
    el("div.pmain",
      el("div.pname",
        p.title && el("span.title-tag", { class: titleClass(p.title) }, p.title),
        el("span", p.name)),
      el("div.pmeta",
        flag(p.country) && el("span", flag(p.country)),
        el("span", `${p.rating} blitz`),
        p.avgPoints ? el("span", `media ${p.avgPoints}/11`) : null,
        owner ? el("span", { style: "color:var(--gold)" }, memberName(league, owner)) : null),
    ),
    el("div.pright",
      el("div.pprice", p.price),
      el("div.small.mute-2", "base 1"),
    ),
  );
}

/* ------------------------------- pannello ------------------------------ */

function memberPanel(ctx) {
  const { league, uid } = ctx;
  const turn = nominator(league);

  return el("section",
    el("div.section-head", el("h2", "Partecipanti")),
    el("div.grid", members(league).map((m) => {
      const left = budgetLeft(league, m.uid);
      const owned = ownedCount(league, m.uid);
      const pct = Math.round((left / league.budget) * 100);
      return el("div.card.card-tight.stack-s", {
        class: m.uid === turn ? "card-hi" : "",
      },
        el("div.spread",
          el("strong", m.name, m.uid === uid ? el("span.muted.small", " (tu)") : null),
          owned >= league.rosterSize
            ? el("span.badge.badge-green", "Completa")
            : el("span.badge", `${owned}/${league.rosterSize}`)),
        el("div.bar", el("i", { style: `width:${pct}%` })),
        el("div.spread.small.muted",
          el("span", `${left} crediti`),
          el("span", `max ${maxBid(league, m.uid)}`)),
      );
    })),
  );
}

function titleClass(t) {
  return (t || "").toLowerCase();
}

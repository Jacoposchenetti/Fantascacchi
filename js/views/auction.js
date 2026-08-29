/* ---------------------------------------------------------------
   Asta a chiamata.

   Due cronometri, non uno:
   - il LOTTO (auction.endsAt) dura bidSeconds e riparte a ogni rilancio;
   - il TURNO DI CHIAMATA (auction.turnEndsAt) dura turnSeconds e allo
     scadere passa da solo al successivo.

   Il secondo mancava, e bastava una persona distratta per congelare
   l'asta all'infinito.

   Nessun server arbitra: chi si accorge per primo che un tempo e' scaduto
   prova a far avanzare lo stato con una transazione, e chi arriva dopo lo
   trova gia' cambiato e non fa nulla.
   --------------------------------------------------------------- */

import { el, empty, flag, confirmDialog, modal, presenceClass } from "../ui.js";
import {
  catalogList, ownerOf, ownedCount, budgetLeft, maxBid,
  members, memberName, nominator, auctionComplete, isOnline, nextTurnDeadline,
} from "../league.js";
import { alertNewLot, alertYourTurn, isMuted, setMuted, primeAudio, stopFlash } from "../alerts.js";
import lobbyView from "./lobby.js";

let filter = "";
let onlyFree = true;
let ticker = null;

// Ultimo stato osservato, per capire cos'e' CAMBIATO e avvisare solo allora.
let seen = { lot: undefined, turn: undefined };

export default function auctionView(ctx) {
  clearInterval(ticker);
  ticker = null;

  const { league, catalog } = ctx;
  if (!catalog) return el("div.card", "Carico il listone…");

  if (league.phase === "lobby") return lobbyView(ctx);
  if (league.phase === "paused") return pausedStage(ctx);
  if (league.phase !== "auction") return closedStage(ctx);

  migrateTurnDeadline(ctx);
  handleAlerts(ctx);

  const a = league.auction || {};
  const running = a.status === "running" && a.playerId;

  return el("div.stack",
    running ? lotStage(ctx, a) : nominationStage(ctx),
    soundRow(ctx),
    memberPanel(ctx),
    !running && playerPicker(ctx),
  );
}

/* ------------------------------ transizioni ---------------------------- */

/**
 * Le leghe create prima del timer di chiamata non hanno turnEndsAt.
 * Lo imposta l'admin, una volta sola, cosi' non restano bloccate su un
 * turno senza scadenza.
 */
function migrateTurnDeadline(ctx) {
  const a = ctx.league.auction || {};
  if (!ctx.isAdmin || a.status === "running" || a.turnEndsAt) return;
  ctx.mutate((lg) => {
    if (lg.auction?.turnEndsAt || lg.auction?.status === "running") return null;
    lg.auction = { ...lg.auction, turnEndsAt: nextTurnDeadline(lg) };
    return lg;
  });
}

/** Avvisa solo sui cambi di stato, mai al primo disegno della pagina. */
function handleAlerts(ctx) {
  const a = ctx.league.auction || {};
  const running = a.status === "running";
  const lot = running ? a.playerId : null;
  const turn = running ? null : nominator(ctx.league);

  if (seen.lot !== undefined) {
    // Lotto nuovo: avvisa tutti tranne chi l'ha appena chiamato.
    if (lot && lot !== seen.lot && a.bidderUid !== ctx.uid) {
      alertNewLot(ctx.catalog.map.get(lot)?.name || "Un giocatore");
    }
    // Il turno e' arrivato a te.
    if (turn && turn !== seen.turn && turn === ctx.uid) {
      alertYourTurn();
    }
  }
  seen.lot = lot;
  seen.turn = turn;
}

/* -------------------------------- pausa -------------------------------- */

/**
 * Mette l'asta in pausa. Il turno NON avanza: alla ripresa chiama la stessa
 * persona, con cronometro pieno e non con i secondi che le erano rimasti.
 *
 * Un lotto in corso viene annullato e il giocatore torna libero. Congelarlo
 * sarebbe peggio: chi era al comando resterebbe appeso a un'offerta per
 * mezz'ora, e alla ripresa i secondi residui diventerebbero un vantaggio
 * arbitrario.
 */
async function pauseAuction(ctx) {
  const a = ctx.league.auction || {};
  const running = a.status === "running" && a.playerId;
  const name = running ? (ctx.catalog.map.get(a.playerId)?.name || a.playerId) : null;

  const ok = await confirmDialog(
    "Mettere l'asta in pausa?",
    running
      ? `Il lotto su ${name} viene annullato e nessuno paga: alla ripresa `
        + "tornerà a chiamare chi aveva la mano."
      : "I cronometri si fermano. Alla ripresa il turno riparte da capo "
        + "per chi ha la mano adesso.",
    "Metti in pausa",
  );
  if (!ok) return;

  await ctx.mutate((lg) => {
    if (lg.phase !== "auction") return null;
    const au = lg.auction || {};
    const released = au.status === "running" ? au.playerId : null;
    lg.phase = "paused";
    lg.auction = {
      ...au,
      status: "idle", playerId: null, bid: 0, bidderUid: null, endsAt: 0,
      turnEndsAt: 0,                  // fermo: nessun conto alla rovescia attivo
      // turnIdx resta com'e': la mano non si perde per una pausa.
      pausedBy: ctx.uid,
      pausedAt: Date.now(),
      releasedPlayer: released,
    };
    return lg;
  });
}

async function resumeAuction(ctx) {
  await ctx.mutate((lg) => {
    if (lg.phase !== "paused") return null;
    lg.phase = "auction";
    lg.auction = {
      ...lg.auction,
      status: "idle", playerId: null, bid: 0, bidderUid: null, endsAt: 0,
      turnEndsAt: nextTurnDeadline(lg),
      pausedBy: null, pausedAt: 0, releasedPlayer: null,
    };
    return lg;
  });
}

function pausedStage(ctx) {
  const { league } = ctx;
  const a = league.auction || {};
  const turn = nominator(league);
  const freed = a.releasedPlayer ? ctx.catalog.map.get(a.releasedPlayer) : null;

  return el("div.stack",
    el("div.card.card-hi.stack", { style: "text-align:center" },
      el("span.badge.badge-red", { style: "margin:0 auto" }, "In pausa"),
      el("h2", "Asta in pausa"),
      el("p.muted.small", { style: "margin:0" },
        a.pausedBy ? `Messa in pausa da ${memberName(league, a.pausedBy)}.` : "",
        " I cronometri sono fermi: nessuno può chiamare o rilanciare."),

      freed && el("div.notice",
        el("strong", freed.name), " era all'asta: è tornato libero e nessuno ha pagato."),

      turn && el("p.muted.small", { style: "margin:0" },
        "Alla ripresa chiama ", el("strong", memberName(league, turn)),
        `, con ${league.turnSeconds || 60} secondi pieni.`),

      ctx.isAdmin
        ? el("button.btn.btn-primary.btn-lg", { onclick: () => resumeAuction(ctx) },
            "Riprendi l'asta")
        : el("p.muted", { style: "margin:0" },
            "Riprende quando ",
            el("strong", league.members?.[league.adminUid]?.name || "chi gestisce la lega"),
            " la fa ripartire. Puoi lasciare aperta la pagina."),
    ),
    memberPanel(ctx),
  );
}

/** Pulsanti che l'admin ha sempre sottomano durante l'asta. */
function adminBar(ctx) {
  if (!ctx.isAdmin) return null;
  return el("button.btn.btn-ghost.btn-sm", {
    style: "justify-self:center",
    onclick: () => pauseAuction(ctx),
  }, "⏸ Metti in pausa");
}

/* ------------------------------- il lotto ------------------------------ */

function lotStage(ctx, a) {
  const { league, uid } = ctx;
  const p = ctx.catalog.map.get(a.playerId);
  const iLead = a.bidderUid === uid;
  const myMax = maxBid(league, uid);
  const canBid = !iLead && ownedCount(league, uid) < league.rosterSize && myMax > a.bid;

  const timerNode = el("div.auction-timer", "—");
  startTicker(
    () => (a.endsAt || 0) - Date.now(),
    (left) => {
      timerNode.textContent = left > 0 ? `${Math.ceil(left / 1000)}s` : "Assegnato…";
      timerNode.classList.toggle("urgent", left > 0 && left <= 5000);
    },
    () => closeLot(ctx),
  );

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
          p?.avgPoints ? ` · ${p.avgPoints}/11 quando gioca` : "",
          p?.window ? el("span", { class: presenceClass(p) },
            ` · presente ${p.events}/${p.window}`) : ""),
      ),
    ),

    el("div",
      el("div.auction-bid", a.bid, el("span", { style: "font-size:.4em" }, " cr")),
      el("div.small.muted",
        iLead ? el("strong", { style: "color:var(--gold)" }, "Sei tu al comando")
              : `Offerta di ${memberName(league, a.bidderUid)}`),
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
            lg.auction = {
              ...lg.auction, status: "idle", playerId: null, bid: 0,
              bidderUid: null, endsAt: 0, turnEndsAt: nextTurnDeadline(lg),
            };
            return lg;
          });
        }
      },
    }, "Annulla il lotto"),

    adminBar(ctx),
  );
}

/**
 * Cronometro condiviso fra lotto e turno.
 * L'handle sta in una variabile locale: se nel frattempo e' partito un altro
 * render, `ticker` punta gia' all'intervallo nuovo e fermare quello
 * lascerebbe questo a girare a vuoto per sempre.
 */
function startTicker(remaining, paint, onExpire) {
  let fired = false;
  let handle = null;
  const tick = () => {
    const left = Math.max(0, remaining());
    paint(left);
    if (left <= 0 && !fired) {
      fired = true;
      clearInterval(handle);
      if (ticker === handle) ticker = null;
      onExpire();
    }
  };
  tick();
  // Se era gia' scaduto al primo giro non serve alcun intervallo.
  if (!fired) {
    handle = setInterval(tick, 200);
    ticker = handle;
  }
}

async function bid(ctx, amount) {
  const uid = ctx.uid;
  primeAudio();
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

/** Chiude il lotto e apre il turno successivo. Idempotente. */
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
      turnEndsAt: nextTurnDeadline(lg),
    };
    if (auctionComplete(lg)) lg.phase = "season";
    return lg;
  });
}

/** Passa la mano. Idempotente: chi arriva secondo trova la scadenza gia' spostata. */
async function skipTurn(ctx, manual = false) {
  await ctx.mutate((lg) => {
    const a = lg.auction || {};
    if (lg.phase !== "auction" || a.status === "running") return null;
    if (!manual && a.turnEndsAt && Date.now() < a.turnEndsAt) return null;
    lg.auction = {
      ...a,
      turnIdx: (a.turnIdx || 0) + 1,
      turnEndsAt: nextTurnDeadline(lg),
    };
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

  const deadline = league.auction?.turnEndsAt || 0;
  const timerNode = el("div.auction-timer", { style: "margin:0" }, deadline ? "—" : "");

  if (deadline) {
    startTicker(
      () => deadline - Date.now(),
      (left) => {
        timerNode.textContent = left > 0
          ? `${Math.ceil(left / 1000)}s per chiamare`
          : "Turno saltato…";
        timerNode.classList.toggle("urgent", left > 0 && left <= 10000);
      },
      () => skipTurn(ctx),
    );
  }

  const offline = !isOnline(ctx.presence, turn);

  return el("div.card.card-hi.stack-s", { style: "text-align:center" },
    el("span.badge.badge-gold", { style: "margin:0 auto" }, "Turno di chiamata"),
    el("h2", mine ? "Tocca a te" : `Tocca a ${memberName(league, turn)}`),

    timerNode,

    el("p.muted.small", { style: "margin:0" },
      mine ? "Scegli un giocatore dalla lista qui sotto: parte da 1 credito e sei tu il primo offerente."
           : offline ? "Non risulta collegato: allo scadere il turno passa da solo."
           : "Appena chiama, il lotto compare qui e potrai rilanciare."),

    !mine && el("button.btn.btn-ghost.btn-sm", {
      style: "justify-self:center",
      onclick: () => skipTurn(ctx, true),
    }, "Salta il turno"),

    adminBar(ctx),
  );
}

async function nominate(ctx, playerId) {
  const uid = ctx.uid;
  primeAudio();
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
      turnEndsAt: 0,
    };
    return lg;
  });
}

/* -------------------------------- chiusa ------------------------------- */

function closedStage(ctx) {
  const { league } = ctx;
  return el("div.stack",
    el("div.card.stack",
      el("h2", "Asta chiusa"),
      el("p.muted", { style: "margin:0" },
        "Le rose sono complete. Da qui si gioca a colpi di formazione."),
      el("div.row",
        el("button.btn.btn-primary", {
          onclick: () => ctx.go(`#/l/${league.id}/formazione`),
        }, "Vai alla formazione"),
        ctx.isAdmin && el("button.btn.btn-ghost", {
          onclick: async () => {
            if (await confirmDialog("Riaprire l'asta?",
              "Le rose restano come sono, ma si potranno comprare altri giocatori.", "Riapri")) {
              ctx.mutate((lg) => {
                lg.phase = "auction";
                lg.auction = { ...lg.auction, status: "idle", turnEndsAt: nextTurnDeadline(lg) };
                return lg;
              });
            }
          },
        }, "Riapri l'asta"),
      ),
    ),
    memberPanel(ctx),
  );
}

/* -------------------------------- avvisi ------------------------------- */

function soundRow(ctx) {
  const muted = isMuted();
  return el("div.row", { style: "justify-content:center" },
    el("button.btn.btn-sm.btn-ghost", {
      onclick: () => {
        setMuted(!muted);
        if (muted) primeAudio();       // riattivando, sblocca subito l'audio
        else stopFlash();
        ctx.refresh();
      },
      "aria-pressed": String(!muted),
    }, muted ? "🔕 Avvisi disattivati" : "🔔 Avvisi attivi"),
  );
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
  const clickable = myTurn && !owner;

  return el(clickable ? "button.pcard" : "div.pcard", {
    class: owner ? "is-owned" : "",
    type: clickable ? "button" : null,
    onclick: clickable ? () => nominate(ctx, p.id) : null,
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
        p.avgPoints ? el("span", `${p.avgPoints}/11 quando gioca`) : null,
        p.window ? el("span", { class: presenceClass(p) },
          `presente ${p.events}/${p.window}`) : null,
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
  const { league, uid, presence } = ctx;
  const turn = league.phase === "auction" ? nominator(league) : null;
  const ms = members(league);
  const online = ms.filter((m) => isOnline(presence, m.uid)).length;

  return el("section",
    el("div.section-head",
      el("h2", "Partecipanti"),
      el("span.small.muted", `${online}/${ms.length} online`)),

    el("div.grid", ms.map((m) => {
      const left = budgetLeft(league, m.uid);
      const owned = ownedCount(league, m.uid);
      const pct = Math.round((left / league.budget) * 100);
      const up = isOnline(presence, m.uid);
      return el("div.card.card-tight.stack-s", {
        class: m.uid === turn ? "card-hi" : "",
      },
        el("div.spread",
          el("strong",
            el("span.dot", {
              class: up ? "dot-on" : "dot-off",
              title: up ? "Collegato" : "Non collegato",
            }),
            m.name, m.uid === uid ? el("span.muted.small", " (tu)") : null),
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

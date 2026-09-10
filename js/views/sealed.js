/* ---------------------------------------------------------------
   Asta a busta chiusa.

   Nessuno deve essere collegato nello stesso momento: si mandano offerte
   segrete entro una scadenza, e quando scade si risolve tutto insieme.

   La risoluzione la lancia il primo client che si accorge che il tempo e'
   finito, dentro una transazione. Chi arriva dopo trova il giro gia'
   chiuso e non lo rifa': stesso schema dell'assegnazione nell'asta live.
   --------------------------------------------------------------- */

import { el, toast, empty, flag, modal, confirmDialog, presenceClass } from "../ui.js";
import {
  catalogList, ownerOf, ownedCount, budgetLeft, members, memberName,
} from "../league.js";
import {
  risolvi, applica, maxOfferta, impegnato, daCompletare, mancaAlla,
  regoleBusteChiuse, DEFAULT_ORE, DEFAULT_SALTI,
} from "../sealed.js";
import { showPlayer } from "./player.js";
import lobbyView from "./lobby.js";

let filtro = "";
let mieOfferte = null;      // cache locale, sostituita dalle sottoscrizioni
let unsubBids = null;
let legaSeguita = null;
let risolvendo = false;
let ticker = null;

export default function sealedView(ctx) {
  clearInterval(ticker);
  ticker = null;

  const { league, catalog, uid } = ctx;
  if (!catalog) return el("div.card", "Carico il listone…");
  if (league.phase === "lobby") return lobbyView(ctx);
  if (league.phase !== "auction") return null;   // gestito da auction.js

  sottoscriviOfferte(ctx);

  const s = league.sealed || {};
  const scaduta = s.scadenza > 0 && Date.now() >= s.scadenza;
  if (scaduta) provaARisolvere(ctx);

  return el("div.stack", { style: "gap:1.4rem" },
    testata(ctx, s, scaduta),
    regolamento(ctx),
    s.ultimoRisultato?.length > 0 && risultatoScorso(ctx, s),
    leMieOfferte(ctx),
    pannelloPartecipanti(ctx),
    !scaduta && listone(ctx),
  );
}

/* ------------------------------ dati vivi ------------------------------ */

function sottoscriviOfferte(ctx) {
  if (legaSeguita === ctx.league.id) return;
  unsubBids?.();
  legaSeguita = ctx.league.id;
  mieOfferte = null;
  unsubBids = ctx.store.watchMyBids(ctx.league.id, ctx.uid, (b) => {
    mieOfferte = b || {};
    ctx.refresh();
  });
}

/* ------------------------------- testata ------------------------------- */

function testata(ctx, s, scaduta) {
  const { league } = ctx;
  const restano = daCompletare(league).length;

  if (!s.scadenza) {
    return el("div.card.card-hi.stack-s", { style: "text-align:center" },
      el("span.badge.badge-gold", { style: "margin:0 auto" }, "Buste chiuse"),
      el("h2", "Il primo giro non è ancora aperto"),
      el("p.muted.small", { style: "margin:0" },
        ctx.isAdmin
          ? "Apri il giro quando volete: da lì ognuno ha tempo per mandare le sue offerte."
          : `Aspetta che ${memberName(league, league.adminUid)} apra il primo giro.`),
      ctx.isAdmin && el("button.btn.btn-primary", { onclick: () => apriGiro(ctx) },
        "Apri il primo giro"),
    );
  }

  const nodoTempo = el("div.auction-timer", { style: "margin:0" }, "—");
  if (!scaduta) {
    const tick = () => {
      nodoTempo.textContent = mancaAlla(s.scadenza);
      nodoTempo.classList.toggle("urgent", s.scadenza - Date.now() < 3600e3);
      if (Date.now() >= s.scadenza) { clearInterval(ticker); ctx.refresh(); }
    };
    tick();
    ticker = setInterval(tick, 1000);
  } else {
    nodoTempo.textContent = "Scaduta";
  }

  return el("div.card.card-hi.stack-s", { style: "text-align:center" },
    el("span.badge.badge-gold", { style: "margin:0 auto" }, `Giro ${s.giro || 1}`),
    el("h2", scaduta ? "Sto assegnando i giocatori…" : "Offerte aperte"),
    nodoTempo,
    el("p.muted.small", { style: "margin:0" },
      scaduta
        ? "Le offerte sono state svelate: fra un istante compaiono le assegnazioni."
        : `Chiude ${new Date(s.scadenza).toLocaleString("it-IT",
            { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}. `
          + `${restano} ${restano === 1 ? "partecipante deve" : "partecipanti devono"} ancora completare la rosa.`),
    el("p.small.mute-2", { style: "margin:0" },
      "Nessuno vede le offerte degli altri prima della scadenza."),
    ctx.isAdmin && !scaduta && el("button.btn.btn-ghost.btn-sm", {
      style: "justify-self:center",
      onclick: () => chiudiSubito(ctx),
    }, "Chiudi il giro adesso"),
  );
}

/* ------------------------------- regolamento -------------------------- */

let regoleAperte = false;

function regolamento(ctx) {
  const punti = regoleBusteChiuse(ctx.league);
  return el("details.card.card-tight", { open: regoleAperte,
    ontoggle: (e) => { regoleAperte = e.target.open; } },
    el("summary", { style: "cursor:pointer;font-weight:600" }, "Come funziona l'asta a buste chiuse"),
    el("ul", { style: "margin:.6rem 0 0;padding-left:1.1rem" },
      punti.map((r) => el("li", { style: "margin:.25rem 0;font-size:.9rem" }, r))),
  );
}

/* ------------------------------ le mie offerte ------------------------- */

function leMieOfferte(ctx) {
  const { league, catalog, uid } = ctx;
  const mie = mieOfferte || {};
  const voci = Object.entries(mie)
    .filter(([pid]) => !ownerOf(league, pid))
    .sort((a, b) => b[1].amount - a[1].amount);

  const tot = impegnato(mie);
  const max = maxOfferta(league, uid);
  const slot = league.rosterSize - ownedCount(league, uid);

  return el("section",
    el("div.section-head",
      el("h2", "Le tue offerte"),
      el("span.small.muted",
        `${budgetLeft(league, uid)} crediti · ${slot} caselle da riempire`)),

    voci.length === 0
      ? el("div.card.card-tight.center.mute-2.small",
          "Nessuna offerta. Scegli dal listone qui sotto.")
      : el("div.plist", voci.map(([pid, b]) => {
          const p = catalog.map.get(pid);
          return el("div.pcard.pcard-split",
            el("button.pcard-main", { type: "button", onclick: () => showPlayer(ctx, p) },
              p?.avatar
                ? el("img.pav", { src: p.avatar, alt: "", loading: "lazy" })
                : el("div.pav", { style: "display:grid;place-items:center" }, "♟"),
              el("div.pmain",
                el("div.pname",
                  p?.title && el("span.title-tag", { class: p.title.toLowerCase() }, p.title),
                  el("span", p?.name || pid)),
                el("div.pmeta",
                  p?.window && el("span", { class: presenceClass(p) },
                    `presente ${p.events}/${p.window}`),
                  el("span", `valutato ${p?.price ?? "?"}`))),
            ),
            el("div.pcard-side",
              el("div.pprice", b.amount),
              el("div.row", { style: "gap:.25rem;flex-wrap:nowrap" },
                el("button.btn.btn-sm.btn-ghost", {
                  onclick: () => apriOfferta(ctx, p || { id: pid, name: pid }, b.amount),
                }, "Modifica"),
                el("button.btn.btn-sm.btn-ghost", {
                  onclick: () => salvaOfferta(ctx, pid, 0),
                  "aria-label": "Ritira l'offerta",
                }, "✕")),
            ),
          );
        })),

    voci.length > 0 && el("div.card.card-tight.spread", { style: "margin-top:.6rem" },
      el("span.small.muted", `Impegnato in totale`),
      el("strong.mono", { class: tot > max ? "pts-neg" : "" }, `${tot} / ${max}`)),

    tot > max && el("div.notice.warn",
      "Stai offrendo più di quanto potresti spendere. Non è vietato — è normale "
      + "puntare su più giocatori sapendo di non prenderli tutti — ma se le vinci "
      + "tutte, quelle che non stanno nel budget vengono scartate partendo dalle "
      + "più economiche."),
  );
}

/* ------------------------------- risultato ----------------------------- */

function risultatoScorso(ctx, s) {
  const { catalog, league } = ctx;
  return el("section",
    el("div.section-head",
      el("h2", `Esito del giro ${(s.giro || 1) - 1 || 1}`),
      el("span.small.mute-2",
        s.risoltoIl ? new Date(s.risoltoIl).toLocaleString("it-IT",
          { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "")),
    s.ultimoRisultato.length === 0
      ? el("div.card.card-tight.center.mute-2.small", "Nessuna assegnazione in quel giro.")
      : el("div.plist", s.ultimoRisultato.map((a) => {
          const p = catalog.map.get(a.playerId);
          return el("div.pcard",
            el("div.pav", { style: "display:grid;place-items:center" }, "♟"),
            el("div.pmain",
              el("div.pname", el("span", p?.name || a.playerId)),
              el("div.pmeta", el("span", `a ${memberName(league, a.uid)}`))),
            el("div.pright", el("div.pprice", a.price, el("span.small.mute-2", " cr"))),
          );
        })),
  );
}

/* ------------------------------ partecipanti --------------------------- */

function pannelloPartecipanti(ctx) {
  const { league, uid } = ctx;
  const haOfferto = new Set(league.sealed?.hannoOfferto || []);
  const saltati = league.sealed?.saltati || {};
  const soglia = league.sealedSkipLimit ?? DEFAULT_SALTI;
  const aRischio = members(league).filter(
    (m) => ownedCount(league, m.uid) < league.rosterSize
      && (saltati[m.uid] || 0) >= soglia - 1 && !haOfferto.has(m.uid));

  return el("section",
    el("div.section-head", el("h2", "Partecipanti")),
    aRischio.length > 0 && el("div.notice.warn", { style: "margin-bottom:.6rem" },
      aRischio.map((m) => m.name).join(", "),
      aRischio.length === 1 ? " non offre da un po'. " : " non offrono da un po'. ",
      `Se salta${aRischio.length === 1 ? "" : "no"} anche questo giro, la rosa `
      + "viene riempita d'ufficio con i giocatori liberi più economici, a 1 credito. "
      + "Meglio mandare un messaggio."),
    el("div.grid", members(league).map((m) => {
      const left = budgetLeft(league, m.uid);
      const owned = ownedCount(league, m.uid);
      return el("div.card.card-tight.stack-s",
        el("div.spread",
          el("strong", m.name, m.uid === uid ? el("span.muted.small", " (tu)") : null),
          owned >= league.rosterSize
            ? el("span.badge.badge-green", "Completa")
            : el("span.badge", `${owned}/${league.rosterSize}`)),
        el("div.bar", el("i", { style: `width:${Math.round((left / league.budget) * 100)}%` })),
        el("div.spread.small.muted",
          el("span", `${left} crediti`),
          owned >= league.rosterSize
            ? el("span.mute-2", "—")
            : haOfferto.has(m.uid)
              ? el("span", { class: "pres-ok" }, "ha offerto")
              : el("span", { class: saltati[m.uid] ? "pres-low" : "mute-2" },
                  saltati[m.uid]
                    ? `saltato ${saltati[m.uid]} giro${saltati[m.uid] > 1 ? "i" : ""}`
                    : "non ancora")),
      );
    })),
  );
}

/* -------------------------------- listone ------------------------------ */

function listone(ctx) {
  const { league, catalog, uid } = ctx;
  const q = filtro.trim().toLowerCase();
  const mie = mieOfferte || {};

  let list = catalogList(catalog).filter((p) => !ownerOf(league, p.id));
  if (q) {
    list = list.filter((p) =>
      p.name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q));
  }
  list.sort((a, b) => b.price - a.price);

  const pieno = ownedCount(league, uid) >= league.rosterSize;

  return el("section",
    el("div.section-head", el("h2", "Listone"),
      el("span.small.muted", `${list.length} liberi`)),

    pieno && el("div.notice", "Hai la rosa completa: non puoi più offrire."),

    el("input", {
      type: "search", placeholder: "Cerca…", value: filtro,
      "data-keep": "sealed-search", style: "margin-bottom:.7rem",
      oninput: (e) => { filtro = e.target.value; ctx.refresh(); },
    }),

    list.length === 0
      ? empty("🔍", "Nessun giocatore")
      : el("div.plist", list.slice(0, 100).map((p) => {
          const mia = mie[p.id]?.amount || 0;
          return el("div.pcard.pcard-split",
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
                  p.window && el("span", { class: presenceClass(p) },
                    `presente ${p.events}/${p.window}`))),
            ),
            el("div.pcard-side",
              el("div.pprice", p.price),
              el("button.btn.btn-sm", {
                class: mia ? "btn-primary" : "",
                disabled: pieno,
                onclick: () => apriOfferta(ctx, p, mia),
              }, mia ? `Offerta ${mia}` : "Offri")),
          );
        })),
  );
}

/* -------------------------------- azioni ------------------------------- */

function apriOfferta(ctx, p, attuale) {
  const max = maxOfferta(ctx.league, ctx.uid);
  modal((close) => {
    const form = el("form.stack", {
      onsubmit: (ev) => {
        ev.preventDefault();
        const v = Math.floor(Number(new FormData(form).get("amt")) || 0);
        close();
        salvaOfferta(ctx, p.id, v);
      },
    },
      el("h2", p.name),
      el("p.muted.small", { style: "margin:0" },
        `Valutazione ${p.price ?? "?"} crediti. Puoi arrivare a ${max}.`),
      el("label.field", "La tua offerta segreta",
        el("input", {
          type: "number", name: "amt", min: 0, max, required: true,
          value: attuale || Math.min(p.price || 1, max), autofocus: true,
        })),
      el("p.small.mute-2", { style: "margin:0" },
        "Vince chi offre di più, e paga esattamente quanto ha offerto. "
        + "A parità vince chi ha più crediti in cassa."),
      el("div.row", { style: "justify-content:flex-end" },
        el("button.btn.btn-ghost", { type: "button", onclick: close }, "Annulla"),
        el("button.btn.btn-primary", { type: "submit" }, attuale ? "Aggiorna" : "Offri"),
      ),
    );
    return form;
  });
}

async function salvaOfferta(ctx, pid, amount) {
  const max = maxOfferta(ctx.league, ctx.uid);
  if (amount > max) { toast(`Puoi arrivare al massimo a ${max}`, "err"); return; }
  const mie = { ...(mieOfferte || {}) };
  if (amount < 1) delete mie[pid];
  else mie[pid] = { amount, at: Date.now() };
  try {
    await ctx.store.setBids(ctx.league.id, ctx.uid, mie);
    mieOfferte = mie;
    // Elenco pubblico di CHI ha offerto, senza gli importi: serve a poter
    // sollecitare chi manca prima che scada il giro.
    const partecipa = Object.keys(mie).length > 0;
    await ctx.mutate((lg) => {
      const attuale = new Set(lg.sealed?.hannoOfferto || []);
      if (partecipa === attuale.has(ctx.uid)) return null;
      partecipa ? attuale.add(ctx.uid) : attuale.delete(ctx.uid);
      lg.sealed = { ...(lg.sealed || {}), hannoOfferto: [...attuale] };
      return lg;
    });
    toast(amount < 1 ? "Offerta ritirata" : `Offerta di ${amount} registrata`, "ok");
    ctx.refresh();
  } catch (err) {
    toast(err.message || "Non sono riuscito a salvare l'offerta", "err");
  }
}

async function apriGiro(ctx) {
  const ore = ctx.league.sealedHours || DEFAULT_ORE;
  const ok = await confirmDialog("Aprire il giro di offerte?",
    `Tutti avranno ${ore} ore per mandare le loro offerte segrete. `
    + "Alla scadenza si assegnano i giocatori e, se le rose non sono piene, "
    + "si apre un altro giro.", "Apri");
  if (!ok) return;
  await ctx.mutate((lg) => {
    if (lg.sealed?.scadenza) return null;
    lg.sealed = { ...(lg.sealed || {}), giro: lg.sealed?.giro || 1,
      scadenza: Date.now() + ore * 3600 * 1000 };
    return lg;
  });
}

async function chiudiSubito(ctx) {
  const ok = await confirmDialog("Chiudere il giro adesso?",
    "Le offerte vengono svelate e i giocatori assegnati subito. "
    + "Chi non ha ancora offerto resta fuori da questo giro.", "Chiudi");
  if (!ok) return;
  await ctx.mutate((lg) => {
    if (!lg.sealed?.scadenza) return null;
    lg.sealed = { ...lg.sealed, scadenza: Date.now() };
    return lg;
  });
}

/**
 * Risoluzione. Idempotente: il primo che ci arriva assegna, gli altri
 * trovano la scadenza gia' spostata e si fermano.
 */
async function provaARisolvere(ctx) {
  if (risolvendo) return;
  risolvendo = true;
  try {
    const tutte = await ctx.store.readAllBids(ctx.league.id);
    const { assegnazioni } = risolvi(ctx.league, tutte);
    const chiHaOfferto = new Set(
      Object.entries(tutte).filter(([, m]) => Object.keys(m || {}).length).map(([u]) => u));
    // Dal piu' economico: chi salta i giri viene riempito con quelli, non
    // con i fuoriclasse, altrimenti non partecipare converrebbe.
    const liberiEconomici = catalogList(ctx.catalog)
      .filter((pl) => !ctx.league.roster?.[pl.id])
      .sort((a, b) => a.price - b.price)
      .map((pl) => pl.id);

    await ctx.store.updateLeague(ctx.league.id, (lg) => {
      // Qualcun altro ha gia' risolto questo giro.
      if (!lg.sealed?.scadenza || Date.now() < lg.sealed.scadenza) return null;
      return applica(lg, assegnazioni, lg.sealedHours || DEFAULT_ORE,
        { chiHaOfferto, liberiEconomici });
    });
    await ctx.store.clearBids(ctx.league.id);
  } catch (err) {
    console.error("risoluzione buste chiuse", err);
  } finally {
    risolvendo = false;
  }
}

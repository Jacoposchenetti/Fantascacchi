/* ---------------------------------------------------------------
   Pannello "Diretta" della giornata in corso.

   Mostra le partite APPENA FINITE che coinvolgono scacchisti in rosa a
   qualcuno, con la pastiglia di chi li ha schierati e un filtro per
   proprietario. Le partite ancora in gioco non sono ottenibili: per
   quelle c'e' il link alle scacchiere di chess.com.

   Non parte da solo, e dichiara quanti dati consuma: 800 KB a richiesta
   non sono una cosa da far succedere alle spalle di chi e' in giro col
   telefono.
   --------------------------------------------------------------- */

import { el, flag } from "../ui.js";
import { members, memberName } from "../league.js";
import { effectiveLineup } from "../season.js";
import { creaFeed, inDiretta, linkTorneo, formattaByte, INTERVALLO_MS } from "../live.js";

let feed = null;
let feedSlot = null;
let stato = null;
let filtro = "tutti";      // "tutti" | "miei" | uid di un avversario

export { inDiretta, linkTorneo };

export default function livePanel(ctx, slot) {
  const { league } = ctx;

  // Chi conta: gli scacchisti schierati da qualcuno per questa giornata.
  const schierati = new Map();     // username -> uid
  for (const m of members(league)) {
    const lu = effectiveLineup(ctx.matchdays, slot.n, m.uid);
    for (const pid of [...(lu?.starters || []), ...(lu?.bench || [])]) {
      if (!schierati.has(pid)) schierati.set(pid, m.uid);
    }
  }
  // Chi e' in rosa ma non schierato: interessa comunque vederlo giocare.
  for (const r of Object.values(league.roster || {})) {
    if (!schierati.has(r.playerId)) schierati.set(r.playerId, r.ownerUid);
  }

  if (feedSlot !== slot.n) {
    feed?.ferma();
    feed = null;
    feedSlot = slot.n;
    stato = null;
  }
  if (!feed) {
    feed = creaFeed(slot, new Set(schierati.keys()), (s) => {
      stato = s;
      ctx.refresh();
    });
  }

  const s = stato || feed.state;

  return el("div.card.card-hi.stack-s",
    el("div.spread",
      el("div",
        el("h3", "Diretta"),
        el("div.small.mute-2",
          s.attivo
            ? `turno ${s.turno || "?"} · ${formattaByte(s.byte)} scaricati in ${s.richieste} richieste`
            : "le partite compaiono appena finiscono")),
      el("a.btn.btn-sm.btn-ghost", {
        href: linkTorneo(slot), target: "_blank", rel: "noopener noreferrer",
      }, "Scacchiere live ↗")),

    !s.attivo
      ? el("div.stack-s",
          el("p.small.muted", { style: "margin:0" },
            "Legge il turno in corso ogni ",
            el("strong", `${INTERVALLO_MS / 60000} minuti`), ": ",
            el("strong", "circa 800 KB a richiesta"),
            ", quindi una trentina di megabyte se la lasci accesa per tutto il "
            + "torneo. Il contatore qui sopra ti dice sempre a che punto sei, e "
            + "puoi fermarla quando vuoi."),
          el("p.small.mute-2", { style: "margin:0" },
            "Le partite compaiono ", el("strong", "quando finiscono"),
            ": chess.com non pubblica le partite in corso. Per vedere le "
            + "scacchiere muoversi c'è il link qui sopra."),
          el("button.btn.btn-primary", { onclick: () => feed.avvia() }, "Segui la diretta"))
      : el("div.stack-s",
          el("div.row",
            el("button.btn.btn-sm.btn-ghost", { onclick: () => feed.ferma() }, "⏸ Ferma"),
            el("button.btn.btn-sm.btn-ghost", { onclick: () => feed.aggiornaOra() }, "Aggiorna ora"),
            s.ultimo && el("span.small.mute-2",
              `ultimo controllo ${new Date(s.ultimo).toLocaleTimeString("it-IT",
                { hour: "2-digit", minute: "2-digit" })}`)),

          s.cercando && el("p.small.muted", { style: "margin:0" }, "Cerco il torneo di oggi…"),
          s.errore && el("div.notice.warn", s.errore),

          filtri(ctx),
          lista(ctx, s, schierati),
        ),
  );
}

/* -------------------------------- filtri ------------------------------- */

function filtri(ctx) {
  const opzioni = [
    { k: "tutti", label: "Tutte" },
    { k: "miei", label: "Le mie" },
    ...members(ctx.league)
      .filter((m) => m.uid !== ctx.uid)
      .map((m) => ({ k: m.uid, label: m.name })),
  ];
  return el("div.seg", { style: "flex-wrap:wrap" }, opzioni.map((o) => el("button", {
    type: "button",
    "aria-pressed": String(filtro === o.k),
    onclick: () => { filtro = o.k; ctx.refresh(); },
  }, o.label)));
}

/* -------------------------------- elenco ------------------------------- */

function lista(ctx, s, schierati) {
  const visibili = s.partite.filter((p) => {
    const uidW = schierati.get(p.bianco);
    const uidB = schierati.get(p.nero);
    if (filtro === "tutti") return true;
    const target = filtro === "miei" ? ctx.uid : filtro;
    return uidW === target || uidB === target;
  });

  if (!s.partite.length) {
    return el("p.small.mute-2", { style: "margin:0" },
      "Ancora nessuna partita conclusa fra i giocatori che vi interessano.");
  }
  if (!visibili.length) {
    return el("p.small.mute-2", { style: "margin:0" },
      "Nessuna partita per questo filtro, per ora.");
  }

  return el("div.stack-s",
    el("div.small.mute-2", `${visibili.length} partite`),
    visibili.slice(0, 40).map((p) => rigaPartita(ctx, p, schierati)),
  );
}

function rigaPartita(ctx, p, schierati) {
  const { catalog, league } = ctx;
  const lato = (user, vince) => {
    const pl = catalog.map.get(user);
    const uid = schierati.get(user);
    return el("div.lg-side", { class: vince ? "lg-win" : "" },
      el("div.lg-name",
        pl?.title && el("span.title-tag", { class: pl.title.toLowerCase() }, pl.title),
        el("span", pl?.name || user),
        pl?.country && flag(pl.country)),
      uid && el("span.badge", { class: uid === ctx.uid ? "badge-gold" : "" },
        memberName(league, uid)),
    );
  };

  const esito = p.esito === "w" ? "1–0" : p.esito === "b" ? "0–1"
    : p.esito === "d" ? "½–½" : "—";

  return el("a.lg-row", {
    href: p.url, target: "_blank", rel: "noopener noreferrer",
    title: "Apri la partita su chess.com",
  },
    lato(p.bianco, p.esito === "w"),
    el("div.lg-score",
      el("span.lg-res", esito),
      el("span.small.mute-2", `t${p.turno}`)),
    lato(p.nero, p.esito === "b"),
  );
}

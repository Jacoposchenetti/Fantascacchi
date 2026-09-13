/* ---------------------------------------------------------------
   Calendario della stagione.

   Vista di sola lettura: le giornate non si creano piu' a mano, sono i
   primi Titled Tuesday dopo la chiusura dell'asta. Gli schieramenti si
   chiudono da soli all'ora d'inizio del torneo, e i punti compaiono
   appena i risultati sono disponibili.
   --------------------------------------------------------------- */

import { el, empty, modal, fmtPts, ptsClass } from "../ui.js";
import { scoreMatchday } from "../scoring.js";
import { members, memberName, allOwnedPlayerIds } from "../league.js";
import { effectiveLineup, giaGiocata, dataLunga, quando } from "../season.js";
import livePanel, { inDiretta, linkTorneo } from "./live.js";

const duelSum = (r) => (r.detail?.duels || []).reduce((s, d) => s + d.pts, 0);

const STATI = {
  scored:   ["badge-green", "Punti assegnati"],
  pending:  ["badge-gold",  "In attesa dei risultati"],
  open:     ["badge-blue",  "Schieramenti aperti"],
  upcoming: ["",            "In programma"],
};

export default function matchdaysView(ctx) {
  const { league, plan, catalog } = ctx;
  if (!catalog) return el("div.card", "Carico il listone…");

  if (league.phase !== "season") {
    return el("div.card.stack",
      el("h2", "La stagione non è ancora iniziata"),
      el("p.muted", { style: "margin:0" },
        "Il calendario si genera da solo alla chiusura dell'asta: saranno i "
        + "primi Titled Tuesday che arrivano da quel momento."),
      el("button.btn.btn-primary", { onclick: () => ctx.go(`#/l/${league.id}/asta`) },
        "Vai all'asta"),
    );
  }

  if (!plan) return el("div.card", "Carico il calendario…");

  const pct = Math.round((plan.done / plan.total) * 100);

  return el("div.stack", { style: "gap:1.4rem" },

    el("div.card.card-hi.stack-s",
      el("div.spread",
        el("div",
          el("h2", `Giornata ${Math.min(plan.done + 1, plan.total)} di ${plan.total}`),
          el("div.small.muted",
            plan.done >= plan.total
              ? "Stagione conclusa."
              : `${plan.done} giocate · si chiude il ${dataLunga(plan.slots[plan.total - 1].date)}`)),
        el("span.badge.badge-gold", `${pct}%`)),
      el("div.bar", el("i", { style: `width:${pct}%` })),
      el("p.small.mute-2", { style: "margin:.3rem 0 0" },
        "Nessuno deve creare le giornate né caricare i punti: i Titled Tuesday "
        + "entrano da soli e i punteggi arrivano appena disponibili."),
    ),

    plan.slots.length === 0
      ? empty("🗓️", "Nessuna giornata in calendario")
      : el("div.stack", plan.slots.map((slot) => slotCard(ctx, slot))),
  );
}

/* ------------------------------- la scheda ----------------------------- */

function slotCard(ctx, slot) {
  const { league, results } = ctx;
  const res = results.get(slot.n);
  const [cls, label] = STATI[slot.status] || ["", slot.status];

  return el("div.card.stack-s", { class: slot.status === "open" ? "card-hi" : "" },
    el("div.spread",
      el("div",
        el("h3", `Giornata ${slot.n}`,
          el("span.muted.small", { style: "font-weight:400" },
            ` · ${dataLunga(slot.date)}`)),
        el("div.small.mute-2",
          slot.estimated && slot.status !== "pending"
            ? `martedì previsto, ${quando(slot.start)}`
            : slot.status === "pending"
              ? "torneo giocato, risultati in arrivo"
              : `${slot.played} partecipanti`)),
      el("span.badge." + cls, label)),

    inDiretta(slot) && livePanel(ctx, slot),

    slot.status === "pending" && !inDiretta(slot) && el("div.notice",
      "Il torneo si è giocato. I punteggi compaiono da soli non appena la "
      + "classifica è disponibile — di solito entro il mercoledì mattina."),

    // Mai punteggi per un torneo non ancora giocato. Il risultato in memoria
    // puo' essere avanzato da un piano precedente: le giornate sono numerate,
    // e alla chiusura dell'asta la numerazione si sposta tutta.
    res && giaGiocata(slot) && scoreTable(ctx, slot, res),

    el("div.row",
      slot.status === "open" && el("button.btn.btn-sm.btn-primary", {
        onclick: () => ctx.go(`#/l/${league.id}/formazione`),
      }, "Metti la formazione"),
      slot.id && el("a.btn.btn-sm.btn-ghost", {
        href: linkTorneo(slot), target: "_blank", rel: "noopener noreferrer",
      }, "Il torneo su chess.com ↗"),
    ),
  );
}

/**
 * Punteggio della giornata per TUTTA la lega.
 *
 * Passa da scoreMatchday e non da scoreLineup perche' gli scontri diretti
 * dipendono da chi hanno schierato gli altri: non si possono calcolare una
 * persona alla volta.
 */
export function scoreSlot(ctx, slot, res) {
  const lineups = new Map();
  for (const m of members(ctx.league)) {
    const lu = effectiveLineup(ctx.matchdays, slot.n, m.uid, ctx.league, ctx.catalog);
    if (lu) lineups.set(m.uid, lu);
  }
  return scoreMatchday(lineups, resultsMap(ctx, slot, res), res.h2h,
    undefined, slot.rounds);
}

function scoreTable(ctx, slot, res) {
  const { league } = ctx;
  const scored = scoreSlot(ctx, slot, res);

  const rows = members(league).map((m) => {
    const sc = scored.get(m.uid);
    if (!sc) return { name: m.name, uid: m.uid, total: 0, missing: true, detail: null };
    return { name: m.name, uid: m.uid, total: sc.total, missing: false, detail: sc };
  }).sort((a, b) => b.total - a.total);

  return el("div.tablewrap",
    el("table",
      el("thead", el("tr",
        el("th", "Partecipante"), el("th.num", "Scontri"),
        el("th.num", "Fantapunti"), el("th"))),
      el("tbody", rows.map((r, i) => el("tr", { class: r.uid === ctx.uid ? "is-me" : "" },
        el("td",
          el("span.rankcell", { class: i < 3 ? `rank-${i + 1}` : "" }, `${i + 1}. `),
          r.name,
          ),
        el("td.num", { class: ptsClass(duelSum(r)) },
          r.detail?.duels?.length ? fmtPts(duelSum(r)) : "—"),
        el("td.num", { class: ptsClass(r.total) }, r.total.toFixed(1)),
        el("td", { style: "width:1%" }, !r.missing && el("button.btn.btn-sm.btn-ghost", {
          onclick: () => showDetail(ctx, r, slot),
        }, "Dettaglio")),
      ))),
    ),
  );
}

/**
 * Dalla classifica del torneo ai risultati dei soli giocatori posseduti.
 * Chi non compare non ha giocato: e' il caso che fa entrare la panchina.
 */
export function resultsMap(ctx, slot, res) {
  const owned = allOwnedPlayerIds(ctx.league);

  // Imprese per username: [gap, gap, ...]. Le entry sono [username, gap, turno].
  const imprese = new Map();
  for (const [u, gap] of res.upsets || []) {
    if (!imprese.has(u)) imprese.set(u, []);
    imprese.get(u).push(gap);
  }

  const out = new Map();
  for (const pid of owned) {
    const s = res.standings.get(pid);
    out.set(pid, s
      ? { played: true, points: s.points, rank: s.rank, total: res.total,
          upsets: imprese.get(pid) || [] }
      : { played: false, points: 0, rank: null, total: res.total });
  }
  return out;
}

function showDetail(ctx, row, slot) {
  const { catalog } = ctx;
  modal((close) => el("div.stack",
    el("h2", row.name),
    el("p.muted.small", { style: "margin:0" }, `Giornata ${slot.n} · ${dataLunga(slot.date)}`),

    el("div.stack-s", row.detail.rows.map((r) => {
      const p = catalog.map.get(r.playerId);
      const out = r.subbedFrom ? catalog.map.get(r.subbedFrom) : null;
      return el("div.card.card-tight.stack-s",
        el("div.spread",
          el("div",
            el("strong", p?.name || r.playerId),
            r.captainApplied && el("span.badge.badge-gold", { style: "margin-left:.4rem" }, "C ×2"),
            out && el("div.small.mute-2", `entrato per ${out.name}`)),
          el("strong.mono", { class: ptsClass(r.total) }, r.total.toFixed(1)),
        ),
        r.absent
          ? el("div.small.mute-2", "Non ha giocato il torneo e non c'era nessuno in panchina")
          : el("div.small.muted", r.breakdown.map((b) =>
              el("div.spread", el("span", b.label),
                el("span.mono", { class: ptsClass(b.pts) }, fmtPts(b.pts))))),
      );
    })),

    row.detail.duels?.length > 0 && el("div.stack-s",
      el("h3", { style: "margin:.4rem 0 0" }, "Scontri diretti"),
      row.detail.duels.map((d) => {
        const mio = ctx.catalog.map.get(d.playerId);
        const suo = ctx.catalog.map.get(d.oppId);
        return el("div.card.card-tight.spread",
          el("div",
            el("strong", mio?.name || d.playerId),
            el("span.muted.small", ` ha ${d.esito} contro `),
            el("strong", suo?.name || d.oppId),
            el("div.small.mute-2", `schierato da ${memberName(ctx.league, d.oppUid)}`)),
          el("strong.mono", { class: ptsClass(d.pts) }, fmtPts(d.pts)));
      })),

    el("div.spread", { style: "border-top:1px solid var(--line);padding-top:.6rem" },
      el("strong", "Totale"),
      el("strong.mono", { style: "color:var(--gold)" }, row.total.toFixed(1))),

    el("div.row", { style: "justify-content:flex-end" },
      el("button.btn.btn-ghost", { onclick: close }, "Chiudi")),
  ));
}

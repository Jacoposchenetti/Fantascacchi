/* ---------------------------------------------------------------
   Calendario della stagione.

   Vista di sola lettura: le giornate non si creano piu' a mano, le porta
   la fonte della lega — i Titled Tuesday dopo la chiusura dell'asta, i
   turni di un torneo classico, i tornei di un circuito. Gli schieramenti
   si chiudono da soli all'ora d'inizio, e i punti compaiono appena i
   risultati sono disponibili.

   Le parole cambiano con la fonte (`parole`): chiamare "giornata" un
   turno dei Candidati e' sbagliato quanto chiamare "turno" un martedi'.
   --------------------------------------------------------------- */

import { el, empty, modal, fmtPts, ptsClass, scorrimento } from "../ui.js";
import { scoreMatchday, regole } from "../scoring.js";
import { members, memberName, allOwnedPlayerIds } from "../league.js";
import { effectiveLineup, giaGiocata, dataLunga, quando } from "../season.js";
import { inDiretta, linkTorneo } from "./live.js";
import { parole } from "../fonte.js";
import { apriPartiteSu } from "./partite.js";

const duelSum = (r) => (r.detail?.duels || []).reduce((s, d) => s + d.pts, 0);

const STATI = {
  scored:   ["badge-green", "Punti assegnati"],
  pending:  ["badge-gold",  "In attesa dei risultati"],
  open:     ["badge-blue",  "Schieramenti aperti"],
  upcoming: ["",            "In programma"],
};

export default function matchdaysView(ctx) {
  const { league, plan, catalog } = ctx;
  const p = parole(league);
  if (!catalog) return el("div.card", "Carico il listone…");

  if (league.phase !== "season") {
    return el("div.card.stack",
      el("h2", "La stagione non è ancora iniziata"),
      el("p.muted", { style: "margin:0" }, p.calendario),
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
          el("h2", `${p.Giornata} ${Math.min(plan.done + 1, plan.total)} di ${plan.total}`),
          el("div.small.muted",
            plan.done >= plan.total
              ? "Stagione conclusa."
              : `${plan.done} giocate · si chiude il ${dataLunga(plan.slots[plan.total - 1].date)}`)),
        el("span.badge.badge-gold", `${pct}%`)),
      el("div.bar", el("i", { style: `width:${pct}%` })),
      el("p.small.mute-2", { style: "margin:.3rem 0 0" }, p.automatico),
    ),

    plan.slots.length === 0
      ? empty("🗓️", `Nessuna ${p.giornata} in calendario`)
      : el("div.stack", plan.slots.map((slot) => slotCard(ctx, slot))),
  );
}

/* ------------------------------- la scheda ----------------------------- */

function slotCard(ctx, slot) {
  const { league, results } = ctx;
  const p = parole(league);
  const res = results.get(slot.n);
  const [cls, label] = STATI[slot.status] || ["", slot.status];

  return el("div.card.stack-s", { class: slot.status === "open" ? "card-hi" : "" },
    el("div.spread",
      el("div",
        el("h3", `${p.Giornata} ${slot.n}`,
          el("span.muted.small", { style: "font-weight:400" },
            ` · ${dataLunga(slot.date)}`)),
        el("div.small.mute-2",
          slot.status !== "pending" && (slot.estimated || slot.status === "upcoming"
            || slot.status === "open")
            ? `${p.previsto}, ${quando(slot.start)}`
            : slot.status === "pending"
              ? `${p.evento} giocato, risultati in arrivo`
              : `${slot.played} partecipanti`)),
      el("span.badge." + cls, label)),

    // La diretta sta in "Partite": questa pagina e' il calendario e i punti,
    // quella e' dove si va per guardare. Qui resta solo l'indicazione che
    // sta succedendo adesso, che e' l'informazione da calendario.
    inDiretta(slot) && el("div.notice",
      el("strong", "Si sta giocando adesso. "),
      "La telecronaca e le partite appena finite sono in ",
      el("button.btn.btn-sm", {
        style: "margin-left:.3rem",
        onclick: () => ctx.go(`#/l/${league.id}/partite`),
      }, "Partite"),
    ),

    slot.status === "pending" && !inDiretta(slot) && el("div.notice", p.inArrivo),

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
      }, p.link),
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
  // Le regole dipendono dalla fonte: un turno di classico non si conta
  // come un Titled Tuesday.
  return scoreMatchday(lineups, resultsMap(ctx, slot, res), res.h2h,
    regole(ctx.league), slot.rounds);
}

function scoreTable(ctx, slot, res) {
  const { league } = ctx;
  const scored = scoreSlot(ctx, slot, res);

  const rows = members(league).map((m) => {
    const sc = scored.get(m.uid);
    if (!sc) return { name: m.name, uid: m.uid, total: 0, missing: true, detail: null };
    return { name: m.name, uid: m.uid, total: sc.total, missing: false, detail: sc };
  }).sort((a, b) => b.total - a.total);

  return scorrimento(el("div.tablewrap",
    el("table",
      el("thead", el("tr",
        el("th", "Partecipante"), el("th.num.col-extra", "Scontri"),
        el("th.num", "Fantapunti"), el("th"))),
      el("tbody", rows.map((r, i) => el("tr", { class: r.uid === ctx.uid ? "is-me" : "" },
        el("td",
          el("span.rankcell", { class: i < 3 ? `rank-${i + 1}` : "" }, `${i + 1}. `),
          r.name,
          r.detail?.duels?.length
            ? el("span.sottoriga", "scontri ", el("b", fmtPts(duelSum(r))))
            : null,
          ),
        el("td.num.col-extra", { class: ptsClass(duelSum(r)) },
          r.detail?.duels?.length ? fmtPts(duelSum(r)) : "—"),
        el("td.num", { class: ptsClass(r.total) }, r.total.toFixed(1)),
        el("td", { style: "width:1%" }, !r.missing && el("button.btn.btn-sm.btn-ghost", {
          onclick: () => showDetail(ctx, r, slot),
        }, "Dettaglio")),
      ))),
    ),
  ));
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
          color: s.color || null,
          upsets: imprese.get(pid) || [] }
      : { played: false, points: 0, rank: null, total: res.total });
  }
  return out;
}

function showDetail(ctx, row, slot) {
  const { catalog } = ctx;

  // I nomi portano alle partite, ma l'archivio contiene solo quelle dei
  // PROPRI giocatori: sul dettaglio di un avversario il rimando finirebbe
  // su una pagina che non parla di lui. E senza id non c'e' archivio.
  const rimanda = row.uid === ctx.uid && Boolean(slot.id);

  modal((close) => {
    const nome = (pid, testo) => (rimanda
      ? el("button.nomelink", {
          type: "button",
          title: `Rivedi le partite di ${testo} in questa giornata`,
          onclick: () => { close(); apriPartiteSu(ctx, slot, pid); },
        }, testo, el("span.freccia", "›"))
      : el("strong", testo));

    return el("div.stack",
      el("h2", row.name),
      el("p.muted.small", { style: "margin:0" }, `Giornata ${slot.n} · ${dataLunga(slot.date)}`),
      rimanda && el("p.small.mute-2", { style: "margin:0" },
        "Tocca un nome per rivedere le sue partite sulla scacchiera."),

      el("div.stack-s", row.detail.rows.map((r) => {
        const p = catalog.map.get(r.playerId);
        const out = r.subbedFrom ? catalog.map.get(r.subbedFrom) : null;
        return el("div.card.card-tight.stack-s",
          el("div.spread",
            el("div",
              nome(r.playerId, p?.name || r.playerId),
              r.captainApplied && el("span.badge.badge-gold", { style: "margin-left:.4rem" },
                r.viceSubentrato ? "V ×2" : "C ×2"),
              // Senza spiegazione uno vede il raddoppio su chi non aveva
              // nominato capitano e pensa a un errore.
              r.viceSubentrato && el("div.small", { style: "color:var(--gold)" },
                "il capitano non ha giocato: la fascia è passata al vice"),
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
              nome(d.playerId, mio?.name || d.playerId),
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
    );
  });
}

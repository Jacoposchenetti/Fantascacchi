/* ---------------------------------------------------------------
   Giornate: si crea scegliendo un Titled Tuesday vero, si chiudono
   gli schieramenti, poi si scaricano i risultati da chess.com.

   Il download pesante (la classifica completa del torneo) lo fa UNA
   sola persona: il risultato viene salvato dentro la giornata, e tutti
   gli altri leggono quello.
   --------------------------------------------------------------- */

import { el, toast, empty, modal, spinner, confirmDialog, fmtPts, ptsClass } from "../ui.js";
import { discoverTitledTuesdays, fetchStandings, fetchPlayerResult } from "../chesscom.js";
import { scoreLineup } from "../scoring.js";
import { members, memberName, rosterOf } from "../league.js";

export default function matchdaysView(ctx) {
  const { league, matchdays, catalog } = ctx;
  if (!catalog) return el("div.card", "Carico il listone…");

  return el("div.stack", { style: "gap:1.4rem" },
    el("div.section-head",
      el("h2", "Giornate"),
      ctx.isAdmin && el("button.btn.btn-primary.btn-sm", {
        onclick: () => openPicker(ctx),
      }, "+ Nuova giornata"),
    ),

    !ctx.isAdmin && el("p.muted.small", { style: "margin:0" },
      "Solo chi ha creato la lega può aprire e chiudere le giornate."),

    matchdays.length === 0
      ? empty("🗓️", "Nessuna giornata",
          ctx.isAdmin
            ? el("p.small.mute-2", "Crea la prima scegliendo un Titled Tuesday recente.")
            : null)
      : el("div.stack", matchdays.map((md) => matchdayCard(ctx, md))),
  );
}

/* ------------------------------- la scheda ----------------------------- */

function matchdayCard(ctx, md) {
  const { league } = ctx;
  const nLineups = Object.keys(md.lineups || {}).length;
  const nMembers = members(league).length;

  const badge = {
    open:   ["badge-blue", "Schieramenti aperti"],
    locked: ["badge-gold", "Schieramenti chiusi"],
    scored: ["badge-green", "Punti assegnati"],
  }[md.status] || ["", md.status];

  return el("div.card.stack-s",
    el("div.spread",
      el("div",
        el("h3", md.label || md.id),
        el("div.small.mute-2.mono", md.tournamentId)),
      el("span.badge." + badge[0], badge[1]),
    ),

    md.status !== "scored" && el("div.small.muted",
      `${nLineups}/${nMembers} formazioni consegnate`),

    md.status === "scored" && scoreTable(ctx, md),

    ctx.isAdmin && el("div.row", { style: "margin-top:.3rem" },
      md.status === "open" && el("button.btn.btn-sm", {
        onclick: () => ctx.store.setMatchday(league.id, { id: md.id, status: "locked" }),
      }, "Chiudi schieramenti"),

      md.status === "locked" && el("button.btn.btn-sm", {
        onclick: () => ctx.store.setMatchday(league.id, { id: md.id, status: "open" }),
      }, "Riapri schieramenti"),

      md.status !== "scored" && el("button.btn.btn-primary.btn-sm", {
        onclick: () => computeResults(ctx, md),
      }, "Scarica risultati e calcola"),

      md.status === "scored" && el("button.btn.btn-ghost.btn-sm", {
        onclick: () => computeResults(ctx, md),
      }, "Ricalcola"),

      el("button.btn.btn-danger.btn-sm", {
        onclick: async () => {
          if (await confirmDialog("Eliminare la giornata?",
            `"${md.label}" e i suoi punti spariscono.`, "Elimina")) {
            await ctx.store.deleteMatchday(league.id, md.id);
            toast("Giornata eliminata");
          }
        },
      }, "Elimina"),
    ),
  );
}

function scoreTable(ctx, md) {
  const { league, catalog } = ctx;
  const results = new Map(Object.entries(md.results || {}));
  const rounds = md.rounds || 11;

  const rows = members(league).map((m) => {
    const lu = md.lineups?.[m.uid];
    if (!lu) return { name: m.name, uid: m.uid, total: 0, missing: true, detail: null };
    const sc = scoreLineup(lu, results, undefined, rounds);
    return { name: m.name, uid: m.uid, total: sc.total, missing: false, detail: sc };
  }).sort((a, b) => b.total - a.total);

  return el("div.tablewrap",
    el("table",
      el("thead", el("tr",
        el("th", "Partecipante"), el("th.num", "Fantapunti"), el("th"))),
      el("tbody", rows.map((r, i) => el("tr", { class: r.uid === ctx.uid ? "is-me" : "" },
        el("td",
          el("span.rankcell", { class: i < 3 ? `rank-${i + 1}` : "" }, `${i + 1}. `),
          r.name,
          r.missing && el("span.badge.badge-red", { style: "margin-left:.4rem" }, "No formazione")),
        el("td.num", { class: ptsClass(r.total) }, r.total.toFixed(1)),
        el("td", { style: "width:1%" }, !r.missing && el("button.btn.btn-sm.btn-ghost", {
          onclick: () => showDetail(ctx, r, md),
        }, "Dettaglio")),
      ))),
    ),
  );
}

function showDetail(ctx, row, md) {
  const { catalog } = ctx;
  modal((close) => el("div.stack",
    el("h2", row.name),
    el("p.muted.small", { style: "margin:0" }, md.label),

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
                el("span.mono", { class: ptsClass(b.pts) }, fmtPts(b.pts)))),
            ),
      );
    })),

    el("div.spread", { style: "border-top:1px solid var(--line);padding-top:.6rem" },
      el("strong", "Totale"),
      el("strong.mono", { style: "color:var(--gold)" }, row.total.toFixed(1))),

    el("div.row", { style: "justify-content:flex-end" },
      el("button.btn.btn-ghost", { onclick: close }, "Chiudi")),
  ));
}

/* --------------------------- crea una giornata ------------------------- */

function openPicker(ctx) {
  modal((close) => {
    const box = el("div.stack",
      el("h2", "Nuova giornata"),
      el("p.muted.small", { style: "margin:0" },
        "Scelgo dai Titled Tuesday realmente giocati su chess.com."),
      spinner(),
    );

    discoverTitledTuesdays(12).then((events) => {
      const already = new Set(ctx.matchdays.map((m) => m.tournamentId));
      const free = events.filter((e) => !already.has(e.id));

      box.replaceChildren(
        el("h2", "Nuova giornata"),
        el("p.muted.small", { style: "margin:0" },
          "Scelgo dai Titled Tuesday realmente giocati su chess.com."),
        free.length === 0
          ? el("p.muted", "Li hai già usati tutti. Aspetta il prossimo martedì.")
          : el("div.plist", { style: "max-height:50vh;overflow:auto" },
              free.map((e) => el("button.pcard", {
                onclick: async () => {
                  close();
                  await ctx.store.setMatchday(ctx.league.id, {
                    id: e.id, tournamentId: e.id, label: `Titled Tuesday · ${e.label}`,
                    date: e.date, status: "open", rounds: 11, lineups: {}, results: {},
                    createdAt: Date.now(),
                  });
                  toast("Giornata aperta: " + e.label, "ok");
                },
              },
                el("div", { style: "font-size:1.2rem" }, "🗓️"),
                el("div.pmain",
                  el("div.pname", el("span", e.label)),
                  el("div.pmeta", el("span.mono", e.id))),
                el("div.pright.muted", "›"),
              ))),
        el("div.row", { style: "justify-content:flex-end" },
          el("button.btn.btn-ghost", { onclick: close }, "Chiudi")),
      );
    }).catch((err) => {
      box.replaceChildren(
        el("h2", "Non riesco a leggere chess.com"),
        el("p.muted.small", err.message),
        el("div.row", { style: "justify-content:flex-end" },
          el("button.btn.btn-ghost", { onclick: close }, "Chiudi")),
      );
    });

    return box;
  });
}

/* ---------------------------- calcolo dei punti ------------------------ */

async function computeResults(ctx, md) {
  const { league, catalog } = ctx;

  // Tutti i giocatori posseduti da qualcuno: sono gli unici che ci interessano.
  const owned = [...new Set(Object.values(league.roster || {}).map((r) => r.playerId))];
  if (!owned.length) { toast("Nessun giocatore in rosa", "err"); return; }

  const status = el("div.stack", el("h2", "Calcolo in corso"), spinner(),
    el("p.center.muted.small", { style: "margin:0" }, "Contatto chess.com…"));
  const close = modal(() => status);
  const say = (t) => { status.lastChild.textContent = t; };

  try {
    const st = await fetchStandings(md.tournamentId, say);

    const results = {};
    const missing = [];
    for (const pid of owned) {
      const row = st.standings.get(pid);
      if (row) results[pid] = { played: true, points: row.points, rank: row.rank, total: st.total };
      else missing.push(pid);
    }

    // Chi non e' nella classifica finale puo' essersi ritirato a meta' torneo:
    // per quei pochi si controlla il suo storico personale.
    for (let i = 0; i < missing.length; i++) {
      const pid = missing[i];
      say(`Controllo i ritirati… (${i + 1}/${missing.length})`);
      const r = await fetchPlayerResult(pid, md.tournamentId);
      results[pid] = r
        ? { played: true, points: r.points, rank: r.rank, total: r.total || st.total, withdrew: true }
        : { played: false, points: 0, rank: null, total: st.total };
    }

    await ctx.store.setMatchday(league.id, {
      id: md.id,
      status: "scored",
      results,
      scoredAt: Date.now(),
      tournamentName: st.name,
    });

    const played = Object.values(results).filter((r) => r.played).length;
    close();
    toast(`Punti assegnati: ${played}/${owned.length} giocatori hanno giocato`, "ok");
  } catch (err) {
    close();
    toast(err.message || "Calcolo non riuscito", "err");
  }
}

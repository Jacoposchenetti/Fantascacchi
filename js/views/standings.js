/* Classifica di stagione: somma dei fantapunti di tutte le giornate calcolate. */

import { el, empty, ptsClass } from "../ui.js";
import { scoreLineup } from "../scoring.js";
import { members, rosterOf } from "../league.js";

export default function standingsView(ctx) {
  const { league, matchdays, catalog, uid } = ctx;
  if (!catalog) return el("div.card", "Carico il listone…");

  const scored = matchdays
    .filter((m) => m.status === "scored")
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  if (!scored.length) {
    return empty("🏆", "Classifica vuota",
      el("p.small.mute-2", "Comparirà appena verrà calcolata la prima giornata."));
  }

  const ms = members(league);
  const table = ms.map((m) => {
    const perMd = scored.map((md) => {
      const lu = md.lineups?.[m.uid];
      if (!lu) return 0;
      return scoreLineup(lu, new Map(Object.entries(md.results || {})), undefined, md.rounds || 11).total;
    });
    const total = perMd.reduce((s, v) => s + v, 0);
    return {
      uid: m.uid, name: m.name, perMd,
      total: Math.round(total * 10) / 10,
      best: perMd.length ? Math.max(...perMd) : 0,
      avg: perMd.length ? total / perMd.length : 0,
    };
  }).sort((a, b) => b.total - a.total);

  const leader = table[0];

  return el("div.stack", { style: "gap:1.4rem" },
    el("section",
      el("div.section-head",
        el("h2", "Classifica"),
        el("span.small.muted", `${scored.length} ${scored.length === 1 ? "giornata" : "giornate"}`)),

      el("div.tablewrap",
        el("table",
          el("thead", el("tr",
            el("th", "#"), el("th", "Partecipante"),
            el("th.num", "Punti"), el("th.num", "Media"), el("th.num", "Migliore"),
            el("th.num", "Distacco"),
          )),
          el("tbody", table.map((r, i) => el("tr", { class: r.uid === uid ? "is-me" : "" },
            el("td.rankcell", { class: i < 3 ? `rank-${i + 1}` : "" }, String(i + 1)),
            el("td", r.name, r.uid === uid && el("span.muted.small", " · tu")),
            el("td.num", { style: "color:var(--gold);font-weight:700" }, r.total.toFixed(1)),
            el("td.num.muted", r.avg.toFixed(1)),
            el("td.num.muted", r.best.toFixed(1)),
            el("td.num.mute-2", i === 0 ? "—" : `−${(leader.total - r.total).toFixed(1)}`),
          ))),
        ),
      ),
    ),

    el("section",
      el("div.section-head", el("h2", "Giornata per giornata")),
      el("div.tablewrap",
        el("table",
          el("thead", el("tr",
            el("th", "Partecipante"),
            scored.map((md) => el("th.num", { title: md.label }, shortLabel(md))),
          )),
          el("tbody", table.map((r) => el("tr", { class: r.uid === uid ? "is-me" : "" },
            el("td", r.name),
            r.perMd.map((v, i) => {
              const best = Math.max(...table.map((t) => t.perMd[i]));
              return el("td.num", {
                class: v === best && v > 0 ? "" : "muted",
                style: v === best && v > 0 ? "color:var(--gold);font-weight:700" : "",
              }, v.toFixed(1));
            }),
          ))),
        ),
      ),
      el("p.small.mute-2", { style: "margin-top:.5rem" },
        "In oro il migliore di giornata."),
    ),
  );
}

function shortLabel(md) {
  if (!md.date) return md.id.slice(0, 6);
  const [, m, d] = md.date.split("-");
  return `${Number(d)}/${Number(m)}`;
}

/* Classifica di stagione: somma delle giornate con risultati disponibili. */

import { el, ptsClass } from "../ui.js";
import { members } from "../league.js";
import { dataBreve, dataLunga } from "../season.js";
import { scoreSlot } from "./matchdays.js";

export default function standingsView(ctx) {
  const { league, plan, results, catalog, uid } = ctx;
  if (!catalog) return el("div.card", "Carico il listone…");
  if (!plan) return el("div.card", "Carico il calendario…");

  // Solo le giornate per cui i risultati sono arrivati davvero.
  const giocate = plan.slots.filter((s) => results.has(s.n));

  const table = members(league).map((m) => {
    const perMd = giocate.map((slot) => {
      const lu = effectiveLineup(ctx.matchdays, slot.n, m.uid);
      if (!lu) return 0;
      return scoreLineup(lu, resultsMap(ctx, slot, results.get(slot.n)),
        undefined, slot.rounds).total;
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
  const prima = giocate.length === 0;

  return el("div.stack", { style: "gap:1.4rem" },
    seasonHeader(ctx, plan),

    prima && el("div.notice",
      "La stagione non è ancora cominciata: si parte tutti da zero. ",
      "I punti compaiono da soli dopo il primo Titled Tuesday, il ",
      el("strong", dataLunga(plan.slots[0].date)), "."),

    el("section",
      el("div.section-head",
        el("h2", "Classifica"),
        el("span.small.muted",
          `${giocate.length} ${giocate.length === 1 ? "giornata" : "giornate"} su ${plan.total}`)),

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

    !prima && el("section",
      el("div.section-head", el("h2", "Giornata per giornata")),
      el("div.tablewrap",
        el("table",
          el("thead", el("tr",
            el("th", "Partecipante"),
            giocate.map((s) => el("th.num", { title: dataLunga(s.date) },
              `G${s.n}`)),
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
        "In oro il migliore di giornata. ",
        giocate.map((s) => `G${s.n} = ${dataBreve(s.date)}`).join(" · ")),
    ),
  );
}

function seasonHeader(ctx, plan) {
  const pct = Math.round((plan.done / plan.total) * 100);
  const finita = plan.done >= plan.total;
  return el("div.card.card-tight.stack-s",
    el("div.spread",
      el("strong", finita
        ? "Stagione conclusa"
        : `Giornata ${Math.min(plan.done + 1, plan.total)} di ${plan.total}`),
      el("span.small.muted", finita
        ? dataLunga(plan.slots[plan.total - 1].date)
        : `si chiude il ${dataLunga(plan.slots[plan.total - 1].date)}`)),
    el("div.bar", el("i", { style: `width:${pct}%` })),
  );
}

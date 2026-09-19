/* Classifica di stagione: somma delle giornate con risultati disponibili. */

import { el, ptsClass, scorrimento } from "../ui.js";
import { members } from "../league.js";
import { dataBreve, dataLunga, giaGiocata } from "../season.js";
import { scoreSlot } from "./matchdays.js";
import { parole } from "../fonte.js";

export default function standingsView(ctx) {
  const { league, plan, results, catalog, uid } = ctx;
  const p = parole(league);
  if (!catalog) return el("div.card", "Carico il listone…");

  // Prima della chiusura dell'asta `season.startsAt` vale 0, e il piano si
  // riempie dei Titled Tuesday gia' archiviati: la classifica annunciava
  // "stagione conclusa, 10 giornate su 10" a gente che non aveva ancora
  // fatto l'asta. Finche' la stagione non comincia non c'e' niente da
  // classificare.
  if (league.phase !== "season") {
    return el("div.card.stack",
      el("h2", "La stagione non è ancora iniziata"),
      el("p.muted", { style: "margin:0" },
        `La classifica si riempie da sola a partire ${
          p.giornata === "turno" ? "dal primo turno" : `dal primo ${p.evento}`
        } dopo la chiusura dell'asta.`),
      el("button.btn.btn-primary", { onclick: () => ctx.go(`#/l/${league.id}/asta`) },
        "Vai all'asta"),
    );
  }

  if (!plan) return el("div.card", "Carico il calendario…");

  // Un circuito il cui primo torneo non e' ancora stato trasmesso non ha
  // nemmeno una casella: senza questo controllo si leggeva `slots[0].date`
  // di un elenco vuoto.
  if (!plan.slots.length) {
    return el("div.card.stack",
      el("h2", "Calendario ancora vuoto"),
      el("p.muted", { style: "margin:0" },
        "Nessun torneo di questa lega è ancora in archivio. Compaiono da "
        + "soli quando vengono trasmessi."));
  }

  // Solo le giornate GIOCATE per cui i risultati sono arrivati davvero.
  // Il solo `results.has` non basta: e' una mappa per numero di giornata, e
  // alla chiusura dell'asta la numerazione si sposta, quindi puo' contenere
  // ancora il risultato di un torneo che adesso sta sotto un altro numero.
  const giocate = plan.slots.filter((s) => giaGiocata(s) && results.has(s.n));

  const table = members(league).map((m) => {
    // scoreSlot fa la passata sull'intera lega: serve perche' gli scontri
    // diretti dipendono da chi hanno schierato gli altri.
    const perMd = giocate.map(
      (slot) => scoreSlot(ctx, slot, results.get(slot.n)).get(m.uid)?.total || 0);
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
  const sigla = p.Giornata[0];

  return el("div.stack", { style: "gap:1.4rem" },
    seasonHeader(ctx, plan),

    prima && el("div.notice",
      "La stagione non è ancora cominciata: si parte tutti da zero. ",
      `I punti compaiono da soli dopo ${p.giornata === "turno" ? "il primo turno" : `il primo ${p.evento}`}, il `,
      el("strong", dataLunga(plan.slots[0].date)), "."),

    el("section",
      el("div.section-head",
        el("h2", "Classifica"),
        el("span.small.muted",
          `${giocate.length} ${giocate.length === 1 ? p.giornata : p.giornate} su ${plan.total}`)),

      scorrimento(el("div.tablewrap",
        el("table",
          el("thead", el("tr",
            el("th", "#"), el("th", "Partecipante"),
            el("th.num", "Punti"),
            el("th.num.col-extra", "Media"), el("th.num.col-extra", "Migliore"),
            el("th.num.col-extra", "Distacco"),
          )),
          el("tbody", table.map((r, i) => el("tr", { class: r.uid === uid ? "is-me" : "" },
            el("td.rankcell", { class: i < 3 ? `rank-${i + 1}` : "" }, String(i + 1)),
            el("td",
              r.name, r.uid === uid && el("span.muted.small", " · tu"),
              // Su schermo stretto le tre colonne di destra spariscono e
              // ricompaiono qui sotto, dove ci stanno per esteso.
              el("span.sottoriga",
                "media ", el("b", r.avg.toFixed(1)),
                " · meglio ", el("b", r.best.toFixed(1)),
                i === 0 ? null : [" · ", el("b", `−${(leader.total - r.total).toFixed(1)}`)])),
            el("td.num", { style: "color:var(--gold);font-weight:700" }, r.total.toFixed(1)),
            el("td.num.muted.col-extra", r.avg.toFixed(1)),
            el("td.num.muted.col-extra", r.best.toFixed(1)),
            el("td.num.mute-2.col-extra", i === 0 ? "—" : `−${(leader.total - r.total).toFixed(1)}`),
          ))),
        ),
      )),
    ),

    !prima && el("section",
      el("div.section-head", el("h2", `${p.Giornata} per ${p.giornata}`)),
      scorrimento(el("div.tablewrap",
        el("table",
          el("thead", el("tr",
            el("th", "Partecipante"),
            // "T" per i turni, "G" per le giornate: la colonna e' stretta
            // e la lettera e' tutto lo spazio che c'e' per dire cos'e'.
            giocate.map((s) => el("th.num", { title: dataLunga(s.date) },
              `${sigla}${s.n}`)),
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
      )),
      el("p.small.mute-2", { style: "margin-top:.5rem" },
        "In oro il migliore di giornata. ",
        giocate.map((s) => `${sigla}${s.n} = ${dataBreve(s.date)}`).join(" · ")),
    ),
  );
}

function seasonHeader(ctx, plan) {
  const p = parole(ctx.league);
  const pct = Math.round((plan.done / plan.total) * 100);
  const finita = plan.done >= plan.total;
  return el("div.card.card-tight.stack-s",
    el("div.spread",
      el("strong", finita
        ? "Stagione conclusa"
        : `${p.Giornata} ${Math.min(plan.done + 1, plan.total)} di ${plan.total}`),
      el("span.small.muted", finita
        ? dataLunga(plan.slots[plan.total - 1].date)
        : `si chiude il ${dataLunga(plan.slots[plan.total - 1].date)}`)),
    el("div.bar", el("i", { style: `width:${pct}%` })),
  );
}

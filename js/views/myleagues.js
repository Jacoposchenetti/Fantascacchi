/* ---------------------------------------------------------------
   Sezione "Le tue leghe": le leghe di cui faccio parte.

   Riusabile: compare nella home dopo il login e dentro la scheda profilo
   raggiungibile da una lega qualsiasi. Si popola in modo asincrono.

   Ogni riga porta alla parte giusta: chi e' ancora all'asta ci va, chi e'
   in stagione va dritto alla classifica.
   --------------------------------------------------------------- */

import { el, render, spinner } from "../ui.js";

const FASI = {
  lobby:  ["badge-blue",  "In attesa"],
  auction:["badge-gold",  "Asta in corso"],
  paused: ["badge-red",   "Asta in pausa"],
  season: ["badge-green", "Stagione"],
};

export default function myLeaguesSection(ctx, { titolo = "Le tue leghe", escludi = null } = {}) {
  const box = el("section");
  render(box,
    el("div.section-head", el("h2", titolo)),
    el("div.card.card-tight.center", spinner()),
  );

  (async () => {
    let leghe = [];
    try {
      leghe = (await ctx.store.listMyLeagues?.()) || [];
    } catch (err) {
      render(box,
        el("div.section-head", el("h2", titolo)),
        el("p.small.mute-2", { style: "margin:0" }, "Non riesco a caricarle: " + err.message));
      return;
    }
    if (escludi) leghe = leghe.filter((l) => l.id !== escludi);

    if (!leghe.length) {
      render(box);   // niente da mostrare: la sezione sparisce
      return;
    }

    render(box,
      el("div.section-head",
        el("h2", titolo),
        el("span.small.muted", `${leghe.length}`)),
      el("div.plist", leghe.map((l) => rigaLega(ctx, l))),
    );
  })();

  return box;
}

function rigaLega(ctx, l) {
  const [cls, label] = FASI[l.phase] || ["", l.phase];
  const tab = l.phase === "season" ? "classifica" : "asta";

  return el("div.pcard.pcard-split",
    el("button.pcard-main", { type: "button",
      onclick: () => ctx.go(`#/l/${l.id}/${tab}`) },
      el("div.pav", { style: "display:grid;place-items:center;font-size:1.2rem" }, "♜"),
      el("div.pmain",
        el("div.pname",
          el("span", l.name),
          l.isAdmin && el("span.badge.badge-gold", "Admin")),
        el("div.pmeta",
          el("span.badge." + cls, label),
          el("span", `${l.partecipanti} partecipanti`),
          l.phase !== "lobby" && el("span", `${l.miei}/${l.rosterSize} in rosa`))),
    ),
    el("div.pcard-side", el("div.pright.muted", { style: "font-size:1.3rem" }, "›")),
  );
}

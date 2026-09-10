/* ---------------------------------------------------------------
   Sezione "Leghe aperte": leghe con ingresso pubblico, ancora in sala
   d'attesa, a cui chiunque puo' unirsi senza bisogno del link.

   E' una sezione riusabile: compare nella home e nella schermata di
   ingresso quando la lega invitata e' gia' partita.

   Si popola da sola in modo asincrono: torna subito un contenitore, poi
   ci mette dentro l'elenco quando arriva.
   --------------------------------------------------------------- */

import { el, render, spinner, toast } from "../ui.js";

export default function openLeaguesSection(ctx, { titolo = "Leghe aperte" } = {}) {
  const box = el("section");
  render(box,
    el("div.section-head", el("h2", titolo)),
    el("div.card.card-tight.center.mute-2.small", spinner()),
  );

  (async () => {
    let leghe = [];
    try {
      leghe = (await ctx.store.listOpenLeagues?.()) || [];
    } catch (err) {
      render(box,
        el("div.section-head", el("h2", titolo)),
        el("p.small.mute-2", { style: "margin:0" },
          "Non riesco a caricare l'elenco: " + err.message),
      );
      return;
    }

    if (!leghe.length) {
      render(box,
        el("div.section-head", el("h2", titolo)),
        el("div.card.card-tight.center.mute-2.small",
          ctx.store.mode === "local"
            ? "In modalità locale non ci sono leghe pubbliche condivise."
            : "Nessuna lega aperta al momento. Creane una e lascia l'ingresso libero."),
      );
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
  const modo = l.auctionMode === "sealed" ? "buste chiuse" : "asta live";
  return el("div.pcard.pcard-split",
    el("button.pcard-main", {
      type: "button",
      onclick: () => ctx.go(`#/join/${l.id}`),
    },
      el("div.pav", { style: "display:grid;place-items:center;font-size:1.2rem" }, "♟"),
      el("div.pmain",
        el("div.pname", el("span", l.name)),
        el("div.pmeta",
          el("span", `${l.partecipanti} ${l.partecipanti === 1 ? "iscritto" : "iscritti"}`),
          el("span", modo),
          el("span", `rosa da ${l.rosterSize}`))),
    ),
    el("div.pcard-side",
      el("button.btn.btn-sm.btn-primary", {
        onclick: () => ctx.go(`#/join/${l.id}`),
      }, "Unisciti"),
    ),
  );
}

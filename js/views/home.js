import { el, toast, spinner } from "../ui.js";
import { DEFAULTS } from "../config.js";

export default function homeView(ctx) {
  const { store, go } = ctx;
  const locals = store.listLocalLeagues?.() || [];

  return el("div.stack", { style: "gap:2rem" },
    el("section.hero",
      el("h1", "Fantascacchi"),
      el("p.lede",
        "La fanta-lega sugli scacchisti veri. Fate l'asta, schierate la formazione, ",
        "e ogni martedì i punti arrivano da soli dai Titled Tuesday di chess.com."),
      el("div.row", { style: "justify-content:center" },
        el("button.btn.btn-primary.btn-lg", { onclick: () => openCreate(ctx) }, "Crea una lega"),
        el("button.btn.btn-lg", { onclick: () => openJoin(ctx) }, "Entra con un codice"),
      ),
    ),

    store.mode === "local" && el("div.notice",
      el("strong", "Modalità locale. "),
      "I dati restano in questo browser, quindi il link d'invito non funziona ancora. ",
      "Per giocare davvero con gli amici serve Firebase: le istruzioni sono nel ",
      el("code", "README.md"), " (circa 5 minuti, piano gratuito).",
    ),

    locals.length > 0 && el("section",
      el("div.section-head", el("h2", "Le tue leghe")),
      el("div.plist", locals.map((l) => el("button.pcard", {
        onclick: () => go(`#/l/${l.id}/asta`),
      },
        el("div", { style: "font-size:1.4rem" }, "♜"),
        el("div.pmain",
          el("div.pname", el("span", l.name)),
          el("div.pmeta", el("span.mono", l.id),
            el("span", new Date(l.createdAt).toLocaleDateString("it-IT"))),
        ),
        el("div.pright.muted", "›"),
      ))),
    ),

    el("section",
      el("div.section-head", el("h2", "Come funziona")),
      el("div.grid",
        step("1", "Asta", "Ognuno ha un budget in crediti. Si nomina un giocatore a turno e si rilancia: chi offre di più se lo porta a casa. Ogni scacchista può appartenere a un solo partecipante."),
        step("2", "Formazione", "Prima di ogni Titled Tuesday scegli chi schierare e chi nominare capitano. Il capitano raddoppia. Chi non gioca il torneo viene sostituito dalla panchina."),
        step("3", "Punti", "A torneo finito l'app scarica la classifica reale da chess.com e calcola i fantapunti: punteggio nel torneo, bonus piazzamento, en plein, malus per le giornate storte."),
      ),
    ),
  );
}

function step(n, title, text) {
  return el("div.card.stack-s",
    el("span.badge.badge-gold", "Passo " + n),
    el("h3", title),
    el("p.muted.small", { style: "margin:0" }, text),
  );
}

/* ------------------------------ crea lega ------------------------------ */

function openCreate(ctx) {
  import("../ui.js").then(({ modal, el: e }) => {
    modal((close) => {
      const form = e("form.stack", { onsubmit: onSubmit },
        e("h2", "Nuova lega"),
        field("Nome della lega", e("input", {
          type: "text", name: "name", required: true, maxlength: 40,
          placeholder: "Fantascacchi tra amici", value: "Fantascacchi tra amici",
        })),
        field("Il tuo nome", e("input", {
          type: "text", name: "user", required: true, maxlength: 20,
          placeholder: "Come ti chiamano", value: ctx.store.me.name || "",
        })),
        e("div.row", { style: "gap:.6rem" },
          e("div", { style: "flex:1" }, field("Crediti", e("input", {
            type: "number", name: "budget", min: 100, max: 2000, step: 10, value: DEFAULTS.budget,
          }))),
          e("div", { style: "flex:1" }, field("Rosa", e("input", {
            type: "number", name: "roster", min: 3, max: 20, value: DEFAULTS.rosterSize,
          }))),
          e("div", { style: "flex:1" }, field("Titolari", e("input", {
            type: "number", name: "lineup", min: 1, max: 15, value: DEFAULTS.lineupSize,
          }))),
        ),
        e("p.muted.small", { style: "margin:0" },
          "I titolari devono essere meno dei giocatori in rosa: la differenza è la panchina."),
        e("div.row", { style: "justify-content:flex-end" },
          e("button.btn.btn-ghost", { type: "button", onclick: close }, "Annulla"),
          e("button.btn.btn-primary", { type: "submit" }, "Crea"),
        ),
      );

      async function onSubmit(ev) {
        ev.preventDefault();
        const f = new FormData(form);
        const roster = Number(f.get("roster"));
        const lineup = Number(f.get("lineup"));
        if (lineup >= roster) {
          toast("I titolari devono essere meno dei giocatori in rosa", "err");
          return;
        }
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        btn.textContent = "Creo…";
        try {
          await ctx.store.setName(String(f.get("user")).trim());
          const id = await ctx.store.createLeague({
            name: String(f.get("name")).trim(),
            budget: Number(f.get("budget")),
            rosterSize: roster,
            lineupSize: lineup,
          });
          close();
          ctx.go(`#/l/${id}/asta`);
        } catch (err) {
          toast(err.message || "Creazione non riuscita", "err");
          btn.disabled = false;
          btn.textContent = "Crea";
        }
      }

      return form;
    });
  });
}

function openJoin(ctx) {
  import("../ui.js").then(({ modal, el: e }) => {
    modal((close) => {
      const form = e("form.stack", {
        onsubmit: (ev) => {
          ev.preventDefault();
          const code = String(new FormData(form).get("code")).trim().toLowerCase();
          if (!code) return;
          close();
          ctx.go(`#/join/${code}`);
        },
      },
        e("h2", "Entra in una lega"),
        e("p.muted.small", { style: "margin:0" },
          "Incolla il codice che ti ha dato chi ha creato la lega (o apri direttamente il suo link)."),
        field("Codice lega", e("input", {
          type: "text", name: "code", required: true, autocapitalize: "off",
          spellcheck: false, placeholder: "es. k7m2pq", class: "mono",
        })),
        e("div.row", { style: "justify-content:flex-end" },
          e("button.btn.btn-ghost", { type: "button", onclick: close }, "Annulla"),
          e("button.btn.btn-primary", { type: "submit" }, "Continua"),
        ),
      );
      return form;
    });
  });
}

function field(label, input) {
  return el("label.field", label, input);
}

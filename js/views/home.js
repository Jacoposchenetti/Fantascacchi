import { el, toast } from "../ui.js";
import { DEFAULTS } from "../config.js";
import { AUCTION_MODES } from "../config.js";
import { campiModo, applicaCampiModo } from "./modeparams.js";
import { FONTI, torneiDisponibili } from "../fonte.js";
import myLeaguesSection from "./myleagues.js";
import openLeaguesSection from "./openleagues.js";

export default function homeView(ctx) {
  const { store } = ctx;

  return el("div.stack", { style: "gap:2rem" },
    el("section.hero",
      el("h1", "Fantascacchi"),
      el("p.lede",
        "La fanta-lega sugli scacchisti veri. Fate l'asta, schierate la formazione, ",
        "e i punti arrivano da soli: dai Titled Tuesday di chess.com o dai ",
        "tornei classici, turno per turno."),
      el("div.row", { style: "justify-content:center" },
        el("button.btn.btn-primary.btn-lg", { onclick: () => openCreate(ctx) }, "Crea una lega"),
        el("button.btn.btn-lg", { onclick: () => openJoin(ctx) }, "Entra con un codice"),
      ),
      el("div.row", { style: "justify-content:center;margin-top:.2rem" },
        el("button.btn.btn-ghost.btn-sm", { onclick: () => ctx.go("#/demo") },
          "Non hai mai giocato? Provala in tre minuti →"),
      ),
    ),

    store.mode === "local" && el("div.notice",
      el("strong", "Modalità locale. "),
      "I dati restano in questo browser, quindi il link d'invito non funziona ancora. ",
      "Per giocare davvero con gli amici serve Firebase: le istruzioni sono nel ",
      el("code", "README.md"), " (circa 5 minuti, piano gratuito).",
    ),

    myLeaguesSection(ctx),
    openLeaguesSection(ctx),

    el("section",
      el("div.section-head", el("h2", "Come funziona"),
        el("button.btn.btn-sm", { onclick: () => ctx.go("#/demo") }, "Provala")),
      el("div.grid",
        step("1", "Asta", "Ognuno ha un budget in crediti. Si nomina un giocatore a turno e si rilancia: chi offre di più se lo porta a casa. Ogni scacchista può appartenere a un solo partecipante."),
        step("2", "Formazione", "Prima di ogni giornata scegli chi schierare e chi nominare capitano. Il capitano raddoppia, e se non gioca la fascia passa al vice. Chi non scende in campo viene sostituito dalla panchina."),
        step("3", "Punti", "A giornata finita l'app legge i risultati veri — chess.com per i Titled Tuesday, le dirette di Lichess per i tornei classici — e calcola i fantapunti: risultato, piazzamento, imprese contro i più forti, scontri diretti."),
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
  import("../ui.js").then(({ modal, el: e, render }) => {
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

        e("label.field", "Su cosa si gioca",
          e("select", { name: "fonte", onchange: aggiornaFonte },
            FONTI.map((f) => e("option", { value: f.id }, f.nome)))),
        e("p.muted.small", { id: "fonte-desc", style: "margin:0" }, FONTI[0].desc),
        e("div", { id: "fonte-params" }),

        e("label.field", "Come si compongono le rose",
          e("select", { name: "modo", onchange: aggiornaModo },
            AUCTION_MODES.map((m) => e("option", { value: m.id }, m.nome)))),
        e("p.muted.small", { id: "modo-desc", style: "margin:0" },
          AUCTION_MODES[0].desc),

        e("div", { id: "modo-params" }, campiModo("live")),

        e("label.row", { style: "gap:.5rem;font-size:.9rem" },
          e("input", { type: "checkbox", name: "open", style: "width:auto" }),
          "Ingresso pubblico — la lega compare fra le «leghe aperte» e "
          + "chiunque può unirsi senza il link"),
        e("div.row", { style: "justify-content:flex-end" },
          e("button.btn.btn-ghost", { type: "button", onclick: close }, "Annulla"),
          e("button.btn.btn-primary", { type: "submit" }, "Crea"),
        ),
      );

      // I tornei in archivio si chiedono una volta sola, alla prima fonte
      // che li vuole: chi crea una lega sui Titled Tuesday non deve
      // aspettare una richiesta che non gli serve.
      let elenco = null;
      async function tornei() {
        if (!elenco) elenco = await torneiDisponibili();
        return elenco;
      }

      async function aggiornaFonte(ev) {
        const id = ev.target.value;
        const f = FONTI.find((x) => x.id === id);
        const p = form.querySelector("#fonte-desc");
        if (f && p) p.textContent = f.desc;

        const dove = form.querySelector("#fonte-params");
        if (id === "tt") { render(dove); return; }

        render(dove, e("p.muted.small", { style: "margin:.4rem 0 0" },
          "Cerco i tornei in archivio…"));
        const lista = await tornei();
        if (form.querySelector('[name=fonte]').value !== id) return;  // cambiata nel frattempo

        if (!lista.length) {
          render(dove, e("div.notice",
            "Non c'è ancora nessun torneo classico in archivio. ",
            "Li pubblica l'aggiornamento automatico: riprova più tardi, "
            + "oppure gioca sui Titled Tuesday."));
          return;
        }

        render(dove, selettoreTornei(e, render, lista, id));
      }

      function aggiornaModo(ev) {
        const modo = ev.target.value;
        const m = AUCTION_MODES.find((x) => x.id === modo);
        const p = form.querySelector("#modo-desc");
        if (m && p) p.textContent = m.desc;
        render(form.querySelector("#modo-params"), campiModo(modo));
      }

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
          const extra = { auctionMode: String(f.get("modo") || "live") };
          applicaCampiModo(extra, f);

          const tipo = String(f.get("fonte") || "tt");
          if (tipo === "torneo") {
            const tour = String(f.get("tour") || "");
            if (!tour) throw new Error("Scegli il torneo su cui giocare");
            extra.fonte = { tipo, tour };
          } else if (tipo === "circuito") {
            const tours = f.getAll("tours").map(String);
            if (!tours.length) throw new Error("Scegli almeno un torneo");
            extra.fonte = { tipo, tours };
          }
          const id = await ctx.store.createLeague({
            name: String(f.get("name")).trim(),
            budget: Number(f.get("budget")),
            rosterSize: roster,
            lineupSize: lineup,
            open: f.get("open") === "on",
            ...extra,
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

/**
 * Scelta del torneo (o dei tornei, per un circuito).
 *
 * L'archivio e' passato da due tornei a qualche centinaio, e una tendina
 * con dentro tutto il calendario mondiale non si legge: i nomi si
 * somigliano tutti ("| Open", "| Masters", "| Round 3") e quello che
 * distingue davvero e' la data. Quindi una casella per cercare, l'elenco
 * dal piu' recente, e per il circuito solo i primi risultati — chi ne vuole
 * uno vecchio lo cerca per nome invece di scorrere trecento righe.
 */
function selettoreTornei(e, render, lista, tipo) {
  const QUANTI = 25;
  let filtro = "";

  const risultati = () => {
    const q = filtro.trim().toLowerCase();
    return q ? lista.filter((t) => t.name.toLowerCase().includes(q)) : lista;
  };

  const corpo = e("div.stack-s");

  const etichetta = (t) => {
    const anno = t.dates?.[0] ? new Date(t.dates[0]).getFullYear() : "";
    return `${t.name} · ${anno} · ${t.rounds} turni · ${t.players} giocatori`;
  };

  function disegna() {
    const trovati = risultati();

    if (!trovati.length) {
      render(corpo, e("p.small.mute-2", { style: "margin:0" },
        "Nessun torneo con questo nome."));
      return;
    }

    if (tipo === "torneo") {
      render(corpo,
        e("label.field", "Quale torneo",
          e("select", { name: "tour" },
            trovati.map((t) => e("option", { value: t.id }, etichetta(t))))));
      return;
    }

    const mostrati = trovati.slice(0, QUANTI);
    render(corpo,
      e("div.small.muted", "Quali tornei fanno stagione"),
      ...mostrati.map((t) => e("label.row", { style: "gap:.5rem;font-size:.9rem" },
        e("input", { type: "checkbox", name: "tours", value: t.id,
          style: "width:auto" }),
        etichetta(t))),
      trovati.length > mostrati.length
        ? e("p.small.mute-2", { style: "margin:0" },
            `Altri ${trovati.length - mostrati.length}: cercali per nome.`)
        : null);
  }

  disegna();

  return e("div.stack-s", { style: "margin-top:.4rem" },
    e("label.field", `Cerca fra ${lista.length} tornei`,
      e("input", {
        type: "search", placeholder: "Tata Steel, Candidates, Olympiad…",
        // Il campo non fa parte dei dati della lega: senza nome non
        // finisce nella FormData insieme a quelli veri.
        oninput: (ev) => { filtro = ev.target.value; disegna(); },
      })),
    corpo,
  );
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

/* ---------------------------------------------------------------
   "Le tue partite": le partite vere giocate dai tuoi giocatori.

   L'indice (data/tt/partite/<torneo>.json) dice chi ha giocato contro
   chi, com'e' finita e dove ritrovare la partita — undici KB compressi a
   torneo. Le mosse NON stanno li': si scaricano da chess.com quando si
   apre davvero una partita, e una chiamata copre tutto il turno.

   Archiviare i PGN sarebbe costato 11 MB per tredici tornei e 44 MB
   l'anno, per dati che chess.com serve gia' benissimo.
   --------------------------------------------------------------- */

import { el, render, spinner, flag } from "../ui.js";
import { rosterOf } from "../league.js";
import { giaGiocata, dataLunga } from "../season.js";
import { mostraPartita } from "./scacchiera.js";
import livePanel, { inDiretta } from "./live.js";
import telecronaca from "./telecronaca.js";

// Un indice per torneo, tenuto finche' dura la scheda.
const indici = new Map();

async function indiceDi(evento) {
  if (indici.has(evento)) return indici.get(evento);
  const attesa = fetch(`./data/tt/partite/${evento}.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  indici.set(evento, attesa);
  return attesa;
}

let giornataScelta = null;
let giocatoreScelto = null;

export default function partiteView(ctx) {
  const { league, catalog, plan, uid } = ctx;
  if (!catalog) return el("div.card", "Carico il listone…");

  if (league.phase !== "season") {
    return el("div.card.stack",
      el("h2", "Ancora nessuna partita"),
      el("p.muted", { style: "margin:0" },
        "Qui finiscono le partite giocate dai tuoi giocatori nei Titled "
        + "Tuesday. Si riempie da sola dopo il primo torneo della stagione."),
      el("button.btn.btn-primary", { onclick: () => ctx.go(`#/l/${league.id}/asta`) },
        "Vai all'asta"),
    );
  }
  if (!plan) return el("div.card", "Carico il calendario…");

  const mia = rosterOf(league, catalog, uid);
  if (!mia.length) {
    return el("div.card.stack",
      el("h2", "Non hai ancora una rosa"),
      el("p.muted", { style: "margin:0" },
        "Quando avrai dei giocatori, qui potrai rivedere le loro partite."));
  }

  // Questa e' la pagina per GUARDARE: se si sta giocando adesso, la diretta
  // viene prima di tutto. Sta qui e non in Giornate — che parla di
  // calendario e punteggi — perche' e' qui che uno viene per vedere.
  const inCorso = plan.slots.find((s) => inDiretta(s));
  const diretta = inCorso
    ? el("div.stack", { style: "gap:.8rem" },
        el("div.section-head",
          el("h2", "Si gioca adesso"),
          el("span.badge.badge-red", `Giornata ${inCorso.n}`)),
        telecronaca(),
        livePanel(ctx, inCorso))
    : null;

  // Solo le giornate gia' giocate hanno partite da mostrare, e solo quelle
  // con un id sono tornei veri per cui esiste l'indice.
  const giocate = plan.slots.filter((s) => giaGiocata(s) && s.id);
  if (!giocate.length) {
    return el("div.stack", { style: "gap:1.2rem" },
      diretta,
      el("div.card.stack",
        el("h2", "Ancora nessun archivio"),
        el("p.muted", { style: "margin:0" },
          inCorso
            ? "Le partite di oggi si potranno rivedere sulla scacchiera dal "
              + "mercoledì mattina, quando arriva l'archivio."
            : "Il primo Titled Tuesday della stagione non si è ancora giocato. "
              + "Appena finisce, le partite dei tuoi compaiono qui.")));
  }

  const slot = giocate.find((s) => s.n === giornataScelta) || giocate[giocate.length - 1];
  giornataScelta = slot.n;

  const miei = new Map(mia.map((r) => [r.playerId, r.player]));
  const elenco = el("div.stack-s", spinner());

  (async () => {
    const dati = await indiceDi(slot.id);
    render(elenco, corpo(ctx, dati, miei, slot));
  })();

  return el("div.stack", { style: "gap:1.2rem" },

    diretta,

    el("div.card.card-hi.stack-s",
      el("h2", { style: "margin:0" }, "Le tue partite"),
      el("p.small.mute-2", { style: "margin:0" },
        "Le partite vere giocate dai tuoi giocatori. Si aprono sulla "
        + "scacchiera, mossa per mossa."),

      el("div.row", { style: "gap:.4rem" },
        el("label.field", { style: "flex:1;min-width:11rem" }, "Giornata",
          el("select", {
            onchange: (e) => { giornataScelta = Number(e.target.value); ctx.refresh(); },
          }, giocate.map((s) => el("option", {
            value: String(s.n), selected: s.n === slot.n,
          }, `Giornata ${s.n} · ${dataLunga(s.date)}`)))),

        el("label.field", { style: "flex:1;min-width:11rem" }, "Giocatore",
          el("select", {
            onchange: (e) => { giocatoreScelto = e.target.value || null; ctx.refresh(); },
          },
            el("option", { value: "", selected: !giocatoreScelto }, "Tutta la rosa"),
            mia.map((r) => el("option", {
              value: r.playerId, selected: r.playerId === giocatoreScelto,
            }, r.player.name)))),
      ),
    ),

    elenco,
  );
}

/* -------------------------------- l'elenco ------------------------------ */

function corpo(ctx, dati, miei, slot) {
  if (!dati) {
    return el("div.card", el("p.muted", { style: "margin:0" },
      "L'indice delle partite di questa giornata non è ancora stato "
      + "pubblicato. Arriva col prossimo aggiornamento settimanale."));
  }

  const soloLui = giocatoreScelto;
  const righe = (dati.games || [])
    .map((g) => {
      // Una partita puo' riguardare due miei giocatori: si mostra una riga
      // per ciascuno, perche' e' il punto di vista che cambia.
      const lati = [];
      if (miei.has(g.w) && (!soloLui || soloLui === g.w)) lati.push({ g, mio: g.w });
      if (miei.has(g.b) && (!soloLui || soloLui === g.b)) lati.push({ g, mio: g.b });
      return lati;
    })
    .flat()
    .sort((a, b) => a.g.t - b.g.t);

  if (!righe.length) {
    return el("div.card", el("p.muted", { style: "margin:0" },
      soloLui
        ? `${miei.get(soloLui)?.name || "Questo giocatore"} non ha giocato questo torneo.`
        : "Nessuno dei tuoi ha giocato questo Titled Tuesday."));
  }

  // Raggruppate per giocatore: si legge come un tabellino, non come un
  // elenco piatto in cui i turni di tre persone si mescolano.
  const perGiocatore = new Map();
  for (const r of righe) {
    if (!perGiocatore.has(r.mio)) perGiocatore.set(r.mio, []);
    perGiocatore.get(r.mio).push(r);
  }

  return el("div.stack", [...perGiocatore.entries()].map(([pid, sue]) => {
    const p = miei.get(pid);
    const v = sue.filter((r) => vinta(r)).length;
    const pa = sue.filter((r) => r.g.e === "d").length;
    return el("section",
      el("div.section-head",
        el("h3", p?.name || pid),
        el("span.small.muted", `${v}V ${pa}P ${sue.length - v - pa}S`)),
      el("div.stack-s", sue.map((r) => riga(r, slot, p))),
    );
  }));
}

const vinta = (r) => (r.g.e === "w" && r.mio === r.g.w) || (r.g.e === "b" && r.mio === r.g.b);

function riga(r, slot, p) {
  const { g, mio } = r;
  const conIlBianco = mio === g.w;
  const avversario = conIlBianco ? g.b : g.w;
  const eloAvv = conIlBianco ? g.br : g.wr;
  const mioElo = conIlBianco ? g.wr : g.br;
  const esito = g.e === "d" ? "patta" : vinta(r) ? "vinta" : "persa";
  const cls = { vinta: "badge-green", patta: "", persa: "badge-red" }[esito];
  const scarto = (eloAvv || 0) - (mioElo || 0);

  return el("button.pcard.pcard-split", {
    type: "button", style: "width:100%;text-align:left",
    onclick: () => mostraPartita(g, slot.id, mio),
  },
    el("div.pmain",
      el("div.pname",
        el("span.small.mute-2", `T${g.t}`),
        el("span", { style: "margin-left:.4rem" },
          conIlBianco ? "con il bianco" : "con il nero"),
        el("span", { style: "margin-left:.4rem" }, "contro "),
        el("strong", avversario),
        eloAvv ? el("span.muted.small", ` ${eloAvv}`) : null,
        // Battere uno molto piu' forte e' la cosa che si va a rivedere:
        // vale la pena farla saltare all'occhio nell'elenco.
        esito === "vinta" && scarto >= 100
          ? el("span.badge.badge-gold", { style: "margin-left:.4rem" }, `+${scarto}`)
          : null),
      g.eco ? el("div.pmeta", el("span", g.eco)) : null),
    el("span.badge", { class: cls }, esito),
  );
}

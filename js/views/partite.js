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
import { caricaPartite, parole, daBroadcast } from "../fonte.js";

let giornataScelta = null;
let giocatoreScelto = null;

/* Chi si sta venendo a cercare, arrivando da un'altra pagina. Si consuma
   al primo elenco disegnato: e' un "portami li'", non uno stato. */
let daScorrere = null;

/**
 * Entrata dall'esterno: apre le partite di una giornata gia' scorse fino
 * alla sezione di un giocatore.
 *
 * Il filtro per giocatore si azzera di proposito. Chi arriva dal dettaglio
 * di una giornata vuole vedere le partite di quel suo giocatore, ma con
 * gli altri a portata di pollice: nasconderli sarebbe un vicolo cieco.
 */
export function apriPartiteSu(ctx, slot, playerId) {
  giornataScelta = slot.n;
  giocatoreScelto = null;
  daScorrere = playerId;
  ctx.go(`#/l/${ctx.league.id}/partite`);
}

function scorriAlGiocatore(dentro) {
  if (!daScorrere) return;
  const pid = daScorrere;
  daScorrere = null;                       // un colpo solo, anche se fallisce
  const sez = dentro.querySelector(`[data-gioc="${CSS.escape(pid)}"]`);
  if (!sez) return;
  // Dopo il frame: l'elenco e' appena entrato nel documento e senza
  // impaginazione fatta scrollIntoView mira alla posizione sbagliata.
  requestAnimationFrame(() => {
    sez.scrollIntoView({ behavior: "smooth", block: "start" });
    sez.classList.add("appena-arrivati");
    setTimeout(() => sez.classList.remove("appena-arrivati"), 1600);
  });
}

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
  const testa = inCorso && el("div.section-head",
    el("h2", "Si gioca adesso"),
    el("span.badge.badge-red", `${parole(league).Giornata} ${inCorso.n}`));

  // Il pannello in diretta e la telecronaca su Twitch sono roba di
  // chess.com: sui tornei classici non c'e' niente da interrogare ogni
  // trenta secondi e non c'e' un canale ufficiale da incorporare. C'e'
  // pero' la diretta di Lichess, con le scacchiere che si muovono.
  const diretta = !inCorso ? null
    : daBroadcast(league)
      ? el("div.stack", { style: "gap:.8rem" }, testa,
          el("div.card.card-hi.stack-s",
            el("p", { style: "margin:0" },
              "Le scacchiere si muovono adesso sulla diretta di Lichess. "
              + "Le partite finite compaiono qui sotto quando il turno si chiude."),
            el("div.row",
              el("a.btn.btn-primary", {
                href: inCorso.url || "https://lichess.org/broadcast",
                target: "_blank", rel: "noopener noreferrer",
              }, "Segui la diretta ↗"))))
      : el("div.stack", { style: "gap:.8rem" }, testa,
          telecronaca(),
          livePanel(ctx, inCorso));

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

  const p = parole(league);
  const miei = new Map(mia.map((r) => [r.playerId, r.player]));
  const elenco = el("div.stack-s", spinner());

  (async () => {
    const dati = await caricaPartite(slot, league);
    render(elenco, corpo(ctx, dati, miei, slot));
    scorriAlGiocatore(elenco);
  })();

  return el("div.stack", { style: "gap:1.2rem" },

    diretta,

    el("div.card.card-hi.stack-s",
      el("h2", { style: "margin:0" }, "Le tue partite"),
      el("p.small.mute-2", { style: "margin:0" },
        "Le partite vere giocate dai tuoi giocatori. Si aprono sulla "
        + "scacchiera, mossa per mossa."),

      el("div.row", { style: "gap:.4rem" },
        el("label.field", { style: "flex:1;min-width:11rem" }, p.Giornata,
          el("select", {
            onchange: (e) => { giornataScelta = Number(e.target.value); ctx.refresh(); },
          }, giocate.map((s) => el("option", {
            value: String(s.n), selected: s.n === slot.n,
            // Il nome del torneo dice qualcosa ("Tata Steel Masters"); il
            // nome di un turno e' "Round 7", che accanto a "Turno 7" e'
            // solo rumore.
          }, `${p.Giornata} ${s.n} · ${p.giornata === "turno" ? dataLunga(s.date) : (s.nome || dataLunga(s.date))}`)))),

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
    return el("section.gioc-sez", { "data-gioc": pid },
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
  // Nei tornei classici le chiavi sono FIDE id: senza il nome accanto uno
  // leggerebbe "ha battuto fide:2020009".
  const avversario = conIlBianco ? (g.bn || g.b) : (g.wn || g.w);
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

/* ---------------------------------------------------------------
   Sala d'attesa.

   Esiste per un motivo preciso: prima non c'era, e una lega nasceva
   con l'asta gia' aperta. Bastava che qualcuno aprisse il link mentre
   gli altri dormivano per portarsi via il miglior giocatore a 1 credito.
   Ora l'asta parte solo quando l'admin la fa partire.
   --------------------------------------------------------------- */

import { el, copy, confirmDialog, toast } from "../ui.js";
import { members, isOnline, inviteLink, avviaAstaLive } from "../league.js";
import { primeAudio } from "../alerts.js";
import { regoleBusteChiuse } from "../sealed.js";
import { ordineBase, prossimaScadenza as prossimaScadenzaDraft } from "../draft.js";
import { prossimaScadenzaSalary } from "../salary.js";
import { showInvite } from "./invite.js";

export default function lobbyView(ctx) {
  const { league, presence, uid } = ctx;
  const ms = members(league);
  const online = ms.filter((m) => isOnline(presence, m.uid)).length;
  const allHere = online === ms.length && ms.length > 1;

  return el("div.stack", { style: "gap:1.5rem" },

    el("div.card.card-hi.stack", { style: "text-align:center" },
      el("span.badge.badge-gold", { style: "margin:0 auto" }, "Sala d'attesa"),
      el("h1", league.name),
      el("p.muted", { style: "margin:0" },
        `${league.budget} crediti · rosa da ${league.rosterSize} · `,
        `${league.lineupSize} titolari · `,
        rigaModo(league)),

      ctx.isAdmin
        ? el("div.stack-s",
            el("button.btn.btn-primary.btn-lg", {
              disabled: ms.length < 2,
              onclick: () => startAuction(ctx),
            }, ms.length < 2 ? "Serve almeno un altro partecipante" : etichettaAvvio(league)),
            el("p.small.mute-2", { style: "margin:0" },
              notaAvvio(league, online, ms.length, allHere)),
          )
        : el("p.muted", { style: "margin:0" },
            "L'asta comincia quando ", el("strong", league.members[league.adminUid]?.name || "chi gestisce la lega"),
            " dà il via. Resta su questa pagina."),
    ),

    programmazione(ctx),

    el("section",
      el("div.section-head",
        el("h2", "Chi c'è"),
        el("span.small.muted", `${online}/${ms.length} online`)),
      el("div.plist", ms.map((m) => {
        const up = isOnline(presence, m.uid);
        return el("div.pcard",
          el("div.pav", { style: "display:grid;place-items:center" },
            m.name[0]?.toUpperCase() || "?"),
          el("div.pmain",
            el("div.pname",
              el("span", m.name),
              m.uid === uid && el("span.badge", "Tu"),
              m.uid === league.adminUid && el("span.badge.badge-gold", "Admin")),
            el("div.pmeta", el("span", up ? "Collegato" : "Non collegato"))),
          el("span.dot", { class: up ? "dot-on" : "dot-off", title: up ? "Online" : "Offline" }),
        );
      })),
    ),

    el("section",
      el("div.section-head", el("h2", "Invita")),
      el("div.card.stack-s",
        el("p.muted.small", { style: "margin:0" },
          "Manda questo link a chi manca. Entra scrivendo solo il nome."),
        el("div.copyfield",
          el("input", { type: "text", readonly: true, value: inviteLink(league.id),
            onclick: (e) => e.target.select() }),
          el("button.btn.btn-sm", { onclick: () => copy(inviteLink(league.id)) }, "Copia")),
        el("button.btn.btn-sm.btn-ghost", { onclick: () => showInvite(league) }, "Altre opzioni"),
      ),
    ),

    league.auctionMode === "sealed"
      ? el("div.notice",
          el("strong", "Asta a buste chiuse — come funziona"),
          el("ul", { style: "margin:.4rem 0 0;padding-left:1.1rem" },
            regoleBusteChiuse(league).map((r) => el("li", { style: "margin:.2rem 0" }, r))))
      : el("div.notice",
      el("strong", "Come funziona l'asta. "),
      `A turno si chiama un giocatore: hai ${league.turnSeconds || 60} secondi per scegliere, `,
      `poi il turno passa al successivo. Chi chiama parte da 1 credito ed è il primo offerente; `,
      `da lì ognuno può rilanciare e ogni rilancio rimette il cronometro a ${league.bidSeconds} secondi. `,
      "Chi resta solo all'ultimo secondo se lo porta a casa.",
    ),
  );
}

function rigaModo(lg) {
  if (lg.auctionMode === "sealed") return `buste chiuse · giri da ${lg.sealedHours || 12} ore`;
  if (lg.auctionMode === "draft") return `draft a serpentina · ${lg.draftSeconds || 60}s a scelta`;
  if (lg.auctionMode === "salary") return `salary cap · finestra di ${lg.salaryDays || 3} giorni`;
  return `asta live · ${lg.bidSeconds}s per rilancio`;
}

function etichettaAvvio(lg) {
  if (lg.auctionMode === "sealed") return "Apri il primo giro";
  if (lg.auctionMode === "draft") return "Avvia il draft";
  if (lg.auctionMode === "salary") return "Apri il salary cap";
  return "Avvia l'asta";
}

function notaAvvio(lg, online, tot, allHere) {
  if (lg.auctionMode === "sealed" || lg.auctionMode === "salary") {
    return "Nessuno deve essere collegato: ognuno partecipa quando può, entro la scadenza.";
  }
  if (lg.auctionMode === "draft") {
    return allHere ? "Ci siete tutti."
      : `${online} di ${tot} collegati. Puoi partire lo stesso: a chi manca sceglie l'app allo scadere del tempo.`;
  }
  return allHere
    ? "Ci siete tutti."
    : `${online} di ${tot} collegati. Puoi partire lo stesso, ma chi manca si vedrà saltare il turno.`;
}

async function startAuction(ctx) {
  const modo = ctx.league.auctionMode || "live";
  if (modo === "draft") return startDraft(ctx);
  if (modo === "salary") return startSalary(ctx);

  const ms = members(ctx.league).length;
  const sealed = ctx.league.auctionMode === "sealed";
  const ok = await confirmDialog(
    sealed ? "Aprire il primo giro?" : "Avviare l'asta?",
    sealed
      ? `Partite in ${ms}. Tutti avranno ${ctx.league.sealedHours || 12} ore per `
        + "mandare le offerte di questo giro."
      : `Partite in ${ms}. Da questo momento i turni di chiamata scorrono a tempo, `
        + "quindi conviene che siate tutti davanti allo schermo.",
    sealed ? "Apri" : "Avvia",
  );
  if (!ok) return;
  primeAudio();
  await ctx.mutate((lg) => {
    if (lg.phase !== "lobby") return null;
    lg.phase = "auction";
    if (lg.auctionMode === "sealed") {
      lg.sealed = { ...(lg.sealed || {}), giro: lg.sealed?.giro || 1,
        scadenza: Date.now() + (lg.sealedHours || 12) * 3600 * 1000 };
      return lg;
    }
    return avviaAstaLive(lg);
  });
}

/* --------------------------- asta programmata -------------------------- */

let battito = null;

/** Riquadro dell'appuntamento: solo per l'asta live, dove serve esserci. */
function programmazione(ctx) {
  const { league } = ctx;
  if ((league.auctionMode || "live") !== "live") return null;

  const quando = league.scheduledStart || 0;
  const manca = quando - Date.now();

  // Un battito al secondo per il conto alla rovescia. Quando l'orario
  // arriva fa partire l'asta chi sta guardando: la Cloud Function e' la
  // rete di sicurezza per quando non c'e' nessuno, ma se qualcuno c'e'
  // deve partire al secondo giusto, non al minuto dopo.
  if (battito) { clearInterval(battito); battito = null; }
  if (quando > 0) {
    battito = setInterval(() => {
      if (Date.now() >= quando) { clearInterval(battito); battito = null; }
      ctx.refresh();
    }, 1000);
  }

  if (quando > 0 && manca <= 0) partiOra(ctx);

  if (!quando) {
    if (!ctx.isAdmin) return null;
    return el("div.card.stack-s",
      el("strong", "Oppure dai un appuntamento"),
      el("p.small.mute-2", { style: "margin:0" },
        "L'asta parte da sola all'ora che scegli, anche se in quel momento "
        + "non ha aperto l'app nessuno. Chi ha le notifiche attive viene "
        + "avvisato dieci minuti prima."),
      el("form.row", { style: "gap:.5rem", onsubmit: (e) => programma(ctx, e) },
        el("input", {
          type: "datetime-local", name: "quando", required: true,
          min: perInput(Date.now() + 5 * 60 * 1000),
          style: "flex:1;min-width:12rem",
        }),
        el("button.btn.btn-sm", { type: "submit" }, "Programma"),
      ),
    );
  }

  return el("div.card.card-hi.stack-s",
    el("div.spread",
      el("div",
        el("strong", "L'asta parte da sola"),
        el("div.small.muted", dataOra(quando))),
      el("span.badge.badge-gold", manca > 0 ? mancaA(manca) : "adesso")),
    ctx.isAdmin && el("div.row",
      el("button.btn.btn-sm.btn-ghost", { onclick: () => annulla(ctx) },
        "Annulla l'appuntamento"),
    ),
  );
}

async function programma(ctx, ev) {
  ev.preventDefault();
  const v = String(new FormData(ev.target).get("quando") || "");
  const quando = new Date(v).getTime();
  if (!quando || Number.isNaN(quando)) { toast("Data non valida", "err"); return; }
  if (quando <= Date.now()) { toast("Scegli un orario futuro", "err"); return; }
  await ctx.mutate((lg) => {
    if (lg.phase !== "lobby") return null;
    lg.scheduledStart = quando;
    return lg;
  });
  toast(`L'asta partirà ${dataOra(quando)}`, "ok");
}

async function annulla(ctx) {
  await ctx.mutate((lg) => {
    if (!lg.scheduledStart) return null;
    lg.scheduledStart = 0;
    return lg;
  });
  toast("Appuntamento annullato");
}

// Chi guarda fa partire l'asta appena scatta l'ora. La transazione decide
// chi arriva primo: gli altri trovano la fase gia' cambiata e si fermano.
let partenzaInCorso = false;
async function partiOra(ctx) {
  if (partenzaInCorso) return;
  partenzaInCorso = true;
  try {
    await ctx.store.updateLeague(ctx.league.id, (lg) => {
      if (!lg.scheduledStart || Date.now() < lg.scheduledStart) return null;
      return avviaAstaLive(lg);
    });
  } catch { /* ci pensa la Cloud Function */ } finally {
    partenzaInCorso = false;
  }
}

const due = (n) => String(n).padStart(2, "0");

/** Formato accettato da <input type="datetime-local">, in ora locale. */
function perInput(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`
    + `T${due(d.getHours())}:${due(d.getMinutes())}`;
}

function dataOra(ms) {
  return new Date(ms).toLocaleString("it-IT",
    { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

function mancaA(ms) {
  // Sotto il minuto va detto a parole: "fra 1 minuto" quando ne mancano
  // venti secondi e' una bugia piccola ma si nota, perche' il numero resta
  // fermo mentre il tempo scorre.
  if (ms < 60000) return "a momenti";
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `fra ${min} ${min === 1 ? "minuto" : "minuti"}`;
  const ore = Math.floor(min / 60);
  if (ore < 24) return `fra ${ore}h ${due(min % 60)}m`;
  const giorni = Math.round(ore / 24);
  return `fra ${giorni} ${giorni === 1 ? "giorno" : "giorni"}`;
}

async function startDraft(ctx) {
  const ms = members(ctx.league).length;
  const ok = await confirmDialog("Avviare il draft?",
    `Partite in ${ms}. A turno ognuno sceglie un giocatore, `
    + `${ctx.league.draftSeconds || 60} secondi a testa; scaduto il tempo sceglie `
    + "l'app. L'ordine si inverte a ogni giro.", "Avvia il draft");
  if (!ok) return;
  primeAudio();
  await ctx.mutate((lg) => {
    if (lg.phase !== "lobby") return null;
    lg.phase = "auction";
    lg.draft = {
      round: 1, pickIdx: 0, order: ordineBase(lg),
      turnEndsAt: prossimaScadenzaDraft(lg),
    };
    return lg;
  });
}

async function startSalary(ctx) {
  const g = ctx.league.salaryDays || 3;
  const ok = await confirmDialog("Aprire il salary cap?",
    `Tutti avranno ${g} ${g === 1 ? "giorno" : "giorni"} per comporre la rosa `
    + "entro il budget. Alla scadenza chi non ha finito viene completato "
    + "d'ufficio, e parte la stagione.", "Apri");
  if (!ok) return;
  await ctx.mutate((lg) => {
    if (lg.phase !== "lobby") return null;
    lg.phase = "auction";
    lg.salary = { ...(lg.salary || {}), deadline: prossimaScadenzaSalary(lg) };
    return lg;
  });
}

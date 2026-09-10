/* ---------------------------------------------------------------
   Sala d'attesa.

   Esiste per un motivo preciso: prima non c'era, e una lega nasceva
   con l'asta gia' aperta. Bastava che qualcuno aprisse il link mentre
   gli altri dormivano per portarsi via il miglior giocatore a 1 credito.
   Ora l'asta parte solo quando l'admin la fa partire.
   --------------------------------------------------------------- */

import { el, copy, confirmDialog } from "../ui.js";
import { members, isOnline, inviteLink, nextTurnDeadline } from "../league.js";
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
    } else {
      lg.auction = { ...lg.auction, status: "idle", turnIdx: 0, turnEndsAt: nextTurnDeadline(lg) };
    }
    return lg;
  });
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

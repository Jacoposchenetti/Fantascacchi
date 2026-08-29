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
        `${league.lineupSize} titolari · ${league.bidSeconds}s per rilancio`),

      ctx.isAdmin
        ? el("div.stack-s",
            el("button.btn.btn-primary.btn-lg", {
              disabled: ms.length < 2,
              onclick: () => startAuction(ctx),
            }, ms.length < 2 ? "Serve almeno un altro partecipante" : "Avvia l'asta"),
            el("p.small.mute-2", { style: "margin:0" },
              allHere
                ? "Ci siete tutti."
                : `${online} di ${ms.length} collegati. Puoi partire lo stesso, ma chi manca si vedrà saltare il turno.`),
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

    el("div.notice",
      el("strong", "Come funziona l'asta. "),
      `A turno si chiama un giocatore: hai ${league.turnSeconds || 60} secondi per scegliere, `,
      `poi il turno passa al successivo. Chi chiama parte da 1 credito ed è il primo offerente; `,
      `da lì ognuno può rilanciare e ogni rilancio rimette il cronometro a ${league.bidSeconds} secondi. `,
      "Chi resta solo all'ultimo secondo se lo porta a casa.",
    ),
  );
}

async function startAuction(ctx) {
  const ms = members(ctx.league).length;
  const ok = await confirmDialog(
    "Avviare l'asta?",
    `Partite in ${ms}. Da questo momento i turni di chiamata scorrono a tempo, `
    + "quindi conviene che siate tutti davanti allo schermo.",
    "Avvia",
  );
  if (!ok) return;
  // Il clic sblocca l'audio: dopo, gli avvisi sonori possono partire da soli.
  primeAudio();
  await ctx.mutate((lg) => {
    if (lg.phase !== "lobby") return null;
    lg.phase = "auction";
    lg.auction = {
      ...lg.auction,
      status: "idle",
      turnIdx: 0,
      turnEndsAt: nextTurnDeadline(lg),
    };
    return lg;
  });
}

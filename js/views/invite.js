import { el, modal, copy } from "../ui.js";
import { inviteLink } from "../league.js";
import { getStore } from "../store.js";

/** Pannello "Invita": link, codice e condivisione nativa su mobile. */
export function showInvite(league) {
  const link = inviteLink(league.id);

  modal((close) => {
    const box = el("div.stack",
      el("h2", "Invita gli amici"),
      el("p.muted.small", { style: "margin:0" },
        "Chi apre questo link entra nella lega scrivendo solo il proprio nome. Nessuna registrazione."),

      el("label.field", "Link d'invito",
        el("div.copyfield",
          el("input", { type: "text", value: link, readonly: true, onclick: (e) => e.target.select() }),
          el("button.btn.btn-sm", { type: "button", onclick: () => copy(link) }, "Copia"),
        )),

      el("label.field", "Oppure solo il codice",
        el("div.copyfield",
          el("input", { type: "text", value: league.id, readonly: true, class: "mono",
            onclick: (e) => e.target.select() }),
          el("button.btn.btn-sm", { type: "button", onclick: () => copy(league.id) }, "Copia"),
        )),

      navigator.share && el("button.btn.btn-primary.btn-block", {
        type: "button",
        onclick: () => navigator.share({
          title: league.name,
          text: `Entra nella mia lega di Fantascacchi: ${league.name}`,
          url: link,
        }).catch(() => { /* condivisione annullata */ }),
      }, "Condividi…"),

      warning(),

      el("div.row", { style: "justify-content:flex-end" },
        el("button.btn.btn-ghost", { type: "button", onclick: close }, "Chiudi"),
      ),
    );
    return box;
  });
}

function warning() {
  const note = el("div.notice.warn", { hidden: true });
  getStore().then((s) => {
    if (s.mode === "local") {
      note.hidden = false;
      note.append(
        el("strong", "Attenzione: modalità locale. "),
        "Questo link funziona solo dentro questo browser. ",
        "Configura Firebase in ", el("code", "js/config.js"), " perché gli amici possano entrare davvero.",
      );
    }
  });
  return note;
}

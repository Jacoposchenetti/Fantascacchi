import { el, render, toast, spinner } from "../ui.js";

/**
 * Ingresso in una lega tramite link o codice.
 * La vista si popola da sola: prima cerca la lega, poi chiede il nome.
 */
export default function joinView(ctx, leagueId) {
  const root = el("div.stack");
  render(root, el("div.card", spinner(), el("p.center.muted.small", { style: "margin:0" },
    "Cerco la lega ", el("code", leagueId), "…")));

  (async () => {
    let league;
    try {
      league = await ctx.store.getLeague(leagueId);
    } catch (err) {
      render(root, errorCard("Non riesco a leggere la lega", err.message));
      return;
    }

    if (!league) {
      render(root, errorCard(
        "Lega non trovata",
        ctx.store.mode === "local"
          ? "Sei in modalità locale: le leghe create su un altro dispositivo non sono visibili qui. "
            + "Per giocare a distanza serve Firebase (vedi README.md)."
          : `Nessuna lega con codice "${leagueId}". Controlla il link.`,
      ));
      return;
    }

    // Gia' dentro: si tira dritto.
    if (league.members?.[ctx.me.uid]) {
      ctx.go(`#/l/${leagueId}/asta`);
      return;
    }

    const full = league.phase !== "auction";
    const nMembers = Object.keys(league.members || {}).length;

    const form = el("form.stack", { onsubmit: submit },
      el("h1", league.name),
      el("p.muted", { style: "margin:0" },
        `${nMembers} ${nMembers === 1 ? "partecipante" : "partecipanti"} · `,
        `${league.budget} crediti · rosa da ${league.rosterSize} · ${league.lineupSize} titolari`),

      full && el("div.notice.warn",
        "L'asta di questa lega è già chiusa: entrando partiresti senza rosa. ",
        "Meglio chiedere a chi l'ha creata di riaprirla."),

      el("label.field", "Il tuo nome",
        el("input", {
          type: "text", name: "user", required: true, maxlength: 20,
          placeholder: "Come ti chiamano", value: ctx.me.name || "", autofocus: true,
        })),

      el("div.row",
        el("button.btn.btn-primary.btn-lg", { type: "submit" }, "Entra nella lega"),
        el("a.btn.btn-ghost", { href: "#/" }, "Annulla"),
      ),
    );

    render(root, el("div.card.stack", form));

    async function submit(ev) {
      ev.preventDefault();
      const name = String(new FormData(form).get("user")).trim();
      if (!name) return;
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      btn.textContent = "Entro…";
      try {
        await ctx.store.setName(name);
        await ctx.store.updateLeague(leagueId, (lg) => {
          if (lg.members?.[ctx.me.uid]) return null;         // gia' entrato altrove
          const taken = Object.values(lg.members || {})
            .some((m) => m.name.toLowerCase() === name.toLowerCase());
          if (taken) throw new Error(`Nella lega c'è già un "${name}". Scegline un altro.`);
          lg.members = {
            ...lg.members,
            [ctx.me.uid]: { uid: ctx.me.uid, name, joinedAt: Date.now(), isAdmin: false },
          };
          return lg;
        });
        toast("Benvenuto in " + league.name, "ok");
        ctx.go(`#/l/${leagueId}/asta`);
      } catch (err) {
        toast(err.message || "Ingresso non riuscito", "err");
        btn.disabled = false;
        btn.textContent = "Entra nella lega";
      }
    }
  })();

  return root;
}

function errorCard(title, text) {
  return el("div.card.stack",
    el("h2", title),
    el("p.muted", { style: "margin:0" }, text),
    el("a.btn.btn-primary", { href: "#/" }, "Torna alla home"),
  );
}

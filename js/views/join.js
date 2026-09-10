import { el, render, toast, spinner } from "../ui.js";
import openLeaguesSection from "./openleagues.js";
import { regoleBusteChiuse } from "../sealed.js";
import { AUCTION_MODES } from "../config.js";

/**
 * Ingresso in una lega tramite link o codice.
 * La vista si popola da sola: prima cerca la lega, poi chiede il nome.
 *
 * Se l'asta e' gia' partita non si entra: si spiega il perche' e si
 * propone di cercarne un'altra o crearne una.
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
      render(root, errorCard(ctx, "Non riesco a leggere la lega", err.message));
      return;
    }

    if (!league) {
      render(root, errorCard(ctx,
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

    // Si entra solo finche' e' in sala d'attesa. Dopo, entrare significa
    // ritrovarsi senza rosa: meglio dirlo e proporre alternative.
    if (league.phase !== "lobby") {
      render(root, giaIniziata(ctx, league));
      return;
    }

    const nMembers = Object.keys(league.members || {}).length;
    const modo = (AUCTION_MODES.find((m) => m.id === (league.auctionMode || "live")) || {}).nome || "asta";

    const form = el("form.stack", { onsubmit: submit },
      el("h1", league.name),
      el("p.muted", { style: "margin:0" },
        `${nMembers} ${nMembers === 1 ? "partecipante" : "partecipanti"} · `,
        `${modo} · ${league.budget} crediti · rosa da ${league.rosterSize}`),

      league.auctionMode === "sealed" && el("div.notice",
        el("strong", "Asta a buste chiuse — cosa ti aspetta"),
        el("ul", { style: "margin:.4rem 0 0;padding-left:1.1rem" },
          regoleBusteChiuse(league).map((r) => el("li", { style: "margin:.2rem 0" }, r)))),

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
          if (lg.phase !== "lobby") throw new Error("L'asta è già partita: non si entra più.");
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

/* ------------------------- l'asta e' gia' partita --------------------- */

function giaIniziata(ctx, league) {
  const admin = league.members?.[league.adminUid]?.name || "chi l'ha creata";
  const fase = league.phase === "season" ? "La stagione è già cominciata"
    : "L'asta è già partita";

  return el("div.stack", { style: "gap:1.6rem" },
    el("div.card.stack",
      el("span.badge.badge-red", { style: "margin:0 auto 0 0" }, "Troppo tardi"),
      el("h1", { style: "margin:.4rem 0 0" }, league.name),
      el("p.muted", { style: "margin:0" },
        `${fase}, quindi entrando ora ti ritroveresti senza rosa. `,
        `Se pensi sia un errore, scrivi a ${admin}: può riportare la lega in sala d'attesa `,
        "da Impostazioni."),
      el("div.row",
        el("a.btn.btn-primary", { href: "#/" }, "Torna alla home"),
      ),
    ),
    openLeaguesSection(ctx, { titolo: "Nel frattempo, leghe aperte a cui unirti" }),
  );
}

function errorCard(ctx, title, text) {
  return el("div.stack", { style: "gap:1.6rem" },
    el("div.card.stack",
      el("h2", title),
      el("p.muted", { style: "margin:0" }, text),
      el("a.btn.btn-primary", { href: "#/" }, "Torna alla home"),
    ),
    openLeaguesSection(ctx, { titolo: "Leghe aperte" }),
  );
}

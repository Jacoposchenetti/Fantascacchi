import { el, toast, confirmDialog, modal, copy, fmtPts } from "../ui.js";
import { SCORING } from "../config.js";
import { members, memberName, ownedCount, inviteLink } from "../league.js";
import { fetchProfile } from "../chesscom.js";
import { showInvite } from "./invite.js";

export default function settingsView(ctx) {
  const { league, store, uid } = ctx;
  const auctionStarted = Object.keys(league.roster || {}).length > 0;

  return el("div.stack", { style: "gap:1.5rem" },

    /* ------------------------------ invito ----------------------------- */
    el("section",
      el("div.section-head", el("h2", "Invito")),
      el("div.card.stack-s",
        el("div.copyfield",
          el("input", { type: "text", readonly: true, value: inviteLink(league.id),
            onclick: (e) => e.target.select() }),
          el("button.btn.btn-sm", { onclick: () => copy(inviteLink(league.id)) }, "Copia")),
        el("button.btn.btn-sm.btn-ghost", { onclick: () => showInvite(league) }, "Altre opzioni"),
      ),
    ),

    /* --------------------------- partecipanti -------------------------- */
    el("section",
      el("div.section-head", el("h2", "Partecipanti"),
        el("span.small.muted", `${members(league).length}`)),
      el("div.plist", members(league).map((m) => el("div.pcard",
        el("div.pav", { style: "display:grid;place-items:center" }, m.name[0]?.toUpperCase() || "?"),
        el("div.pmain",
          el("div.pname", el("span", m.name),
            m.uid === league.adminUid && el("span.badge.badge-gold", "Admin"),
            m.uid === uid && el("span.badge", "Tu")),
          el("div.pmeta", el("span", `${ownedCount(league, m.uid)}/${league.rosterSize} in rosa`))),
        ctx.isAdmin && m.uid !== league.adminUid && el("button.btn.btn-sm.btn-danger", {
          onclick: () => removeMember(ctx, m),
        }, "Rimuovi"),
      ))),
    ),

    /* --------------------------- regolamento --------------------------- */
    el("section",
      el("div.section-head", el("h2", "Come si fanno i punti")),
      el("div.card",
        el("dl.kv",
          kv("Ogni punto nel torneo", `×${SCORING.perPoint}`),
          ...SCORING.placement.map((t, i) => kv(
            t.max === 1 ? "Vittoria del torneo"
              : t.max <= 3 ? `${t.max}° posto`
              : `Top ${t.max}`,
            fmtPts(t.bonus))),
          kv("En plein (11/11)", fmtPts(SCORING.perfectScore)),
          kv(`Almeno ${SCORING.strongScoreMin} punti`, fmtPts(SCORING.strongScore)),
          kv(`Sotto ${SCORING.weakScoreMax} punti`, fmtPts(SCORING.weakScore)),
          kv("Capitano", `×${SCORING.captainMultiplier}`),
          kv("Non ha giocato", "entra la panchina"),
        ),
        el("p.small.mute-2", { style: "margin:.8rem 0 0" },
          "I bonus piazzamento non si sommano: vale solo il più alto. ",
          "Il capitano raddoppia solo se gioca davvero."),
      ),
    ),

    /* ------------------------- impostazioni lega ----------------------- */
    ctx.isAdmin && el("section",
      el("div.section-head", el("h2", "Impostazioni")),
      el("div.card", leagueForm(ctx, auctionStarted)),
    ),

    /* ----------------------- giocatori fuori listone ------------------- */
    ctx.isAdmin && el("section",
      el("div.section-head", el("h2", "Aggiungi un giocatore")),
      el("div.card.stack-s",
        el("p.muted.small", { style: "margin:0" },
          "Serve qualcuno che non è nel listone? Aggiungilo col suo username chess.com."),
        el("button.btn.btn-sm", { onclick: () => addPlayer(ctx) }, "Cerca su chess.com"),
        Object.keys(league.customPlayers || {}).length > 0 && el("div.small.muted",
          "Aggiunti: ",
          Object.values(league.customPlayers).map((p) => p.name).join(", ")),
      ),
    ),

    /* ----------------------------- account ----------------------------- */
    store.needsAuth && el("section",
      el("div.section-head", el("h2", "Account")),
      el("div.card.stack-s",
        el("div.spread",
          el("div",
            el("strong", store.me.name),
            store.me.email && el("div.small.mute-2", store.me.email),
            store.me.anonymous && el("div.small", { style: "color:var(--red)" },
              "Accesso anonimo: se svuoti il browser perdi la rosa.")),
          store.me.photo && el("img.pav", { src: store.me.photo, alt: "" })),
        el("button.btn.btn-sm.btn-ghost", {
          onclick: async () => {
            if (await confirmDialog("Uscire dall'account?",
              "Potrai rientrare con lo stesso account e ritrovare le tue leghe.", "Esci")) {
              await store.signOut();
              ctx.go("#/");
            }
          },
        }, "Esci"),
      ),
    ),

    /* -------------------------- zona pericolosa ------------------------ */
    ctx.isAdmin && el("section",
      el("div.section-head", el("h2", "Zona pericolosa")),
      el("div.card.stack-s", { style: "border-color:var(--red)" },
        el("p.muted.small", { style: "margin:0" },
          "Riporta tutti in sala d'attesa e svuota le rose, come se l'asta "
          + "non fosse mai iniziata. I crediti tornano pieni. "
          + "Giornate e punteggi già calcolati non vengono toccati."),
        el("button.btn.btn-sm.btn-danger", { onclick: () => restartAuction(ctx) },
          "Ricomincia l'asta da capo"),
      ),
    ),

    /* ------------------------------ dati ------------------------------- */
    el("section",
      el("div.section-head", el("h2", "Dati")),
      el("div.card.stack-s",
        el("p.muted.small", { style: "margin:0" },
          `Modalità: ${store.mode === "firebase" ? "online (Firebase)" : "locale (solo questo browser)"}.`),
        el("div.row",
          el("button.btn.btn-sm", { onclick: () => exportLeague(ctx) }, "Esporta backup"),
          ctx.isAdmin && el("button.btn.btn-sm.btn-ghost", { onclick: () => importLeague(ctx) }, "Importa backup"),
        ),
      ),
    ),
  );
}

const kv = (k, v) => [el("dt", k), el("dd", v)];

/* ------------------------------- form lega ----------------------------- */

function leagueForm(ctx, auctionStarted) {
  const { league } = ctx;
  const form = el("form.stack", {
    onsubmit: async (ev) => {
      ev.preventDefault();
      const f = new FormData(form);
      const roster = Number(f.get("roster"));
      const lineup = Number(f.get("lineup"));
      if (lineup >= roster) { toast("I titolari devono essere meno dei giocatori in rosa", "err"); return; }
      await ctx.mutate((lg) => {
        lg.name = String(f.get("name")).trim() || lg.name;
        lg.budget = Number(f.get("budget"));
        lg.rosterSize = roster;
        lg.lineupSize = lineup;
        lg.bidSeconds = Number(f.get("secs"));
        lg.turnSeconds = Number(f.get("turnsecs"));
        lg.season = { ...(lg.season || {}), matchdays: Number(f.get("giornate")) };
        return lg;
      });
      toast("Impostazioni salvate", "ok");
    },
  },
    el("label.field", "Nome della lega",
      el("input", { type: "text", name: "name", value: league.name, maxlength: 40 })),

    el("div.row",
      el("div", { style: "flex:1;min-width:110px" }, el("label.field", "Crediti",
        el("input", { type: "number", name: "budget", value: league.budget, min: 100, max: 2000, step: 10 }))),
      el("div", { style: "flex:1;min-width:90px" }, el("label.field", "Rosa",
        el("input", { type: "number", name: "roster", value: league.rosterSize, min: 3, max: 20 }))),
      el("div", { style: "flex:1;min-width:90px" }, el("label.field", "Titolari",
        el("input", { type: "number", name: "lineup", value: league.lineupSize, min: 1, max: 15 }))),
      el("div", { style: "flex:1;min-width:110px" }, el("label.field", "Secondi rilancio",
        el("input", { type: "number", name: "secs", value: league.bidSeconds, min: 5, max: 120 }))),
      el("div", { style: "flex:1;min-width:110px" }, el("label.field", "Secondi chiamata",
        el("input", { type: "number", name: "turnsecs", value: league.turnSeconds || 60, min: 10, max: 300 }))),
    ),

    el("label.field", "Durata della stagione, in giornate",
      el("input", { type: "number", name: "giornate",
        value: league.season?.matchdays || 10, min: 1, max: 52 })),

    el("p.small.mute-2", { style: "margin:0" },
      "La stagione sono i primi N Titled Tuesday dopo la chiusura dell'asta. "
      + "Dieci sono circa due mesi e mezzo. "
      + "«Secondi rilancio» è quanto dura un lotto, e riparte da capo a ogni offerta. "
      + "«Secondi chiamata» è quanto tempo hai per scegliere quando tocca a te: "
      + "scaduto quello, il turno passa al successivo."),

    auctionStarted && el("div.notice.warn",
      "L'asta è già iniziata: abbassare i crediti o la rosa può mandare qualcuno in negativo. "
      + "Le rose già assegnate non vengono toccate."),

    el("button.btn.btn-primary", { type: "submit" }, "Salva"),
  );
  return form;
}

/* ------------------------------- azioni -------------------------------- */

async function removeMember(ctx, m) {
  const owned = ownedCount(ctx.league, m.uid);
  const ok = await confirmDialog(
    `Rimuovere ${m.name}?`,
    owned ? `I suoi ${owned} giocatori tornano liberi.` : "Non ha giocatori in rosa.",
    "Rimuovi",
  );
  if (!ok) return;
  await ctx.mutate((lg) => {
    delete lg.members[m.uid];
    for (const [pid, r] of Object.entries(lg.roster || {})) {
      if (r.ownerUid === m.uid) delete lg.roster[pid];
    }
    if (lg.auction?.bidderUid === m.uid) {
      lg.auction = { ...lg.auction, status: "idle", playerId: null, bid: 0, bidderUid: null, endsAt: 0 };
    }
    return lg;
  });
  toast(`${m.name} rimosso`);
}

function addPlayer(ctx) {
  modal((close) => {
    const form = el("form.stack", { onsubmit: submit },
      el("h2", "Aggiungi un giocatore"),
      el("label.field", "Username chess.com",
        el("input", { type: "text", name: "u", required: true, autofocus: true,
          placeholder: "es. magnuscarlsen", autocapitalize: "off", spellcheck: false })),
      el("div.row", { style: "justify-content:flex-end" },
        el("button.btn.btn-ghost", { type: "button", onclick: close }, "Annulla"),
        el("button.btn.btn-primary", { type: "submit" }, "Cerca")),
    );

    async function submit(ev) {
      ev.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true; btn.textContent = "Cerco…";
      try {
        const p = await fetchProfile(String(new FormData(form).get("u")));
        // Prezzo indicativo dal rating, in linea con la scala del listone.
        p.price = Math.max(6, Math.min(150, Math.round((p.rating - 2400) / 6)));
        await ctx.mutate((lg) => {
          lg.customPlayers = { ...(lg.customPlayers || {}), [p.id]: p };
          return lg;
        });
        close();
        toast(`${p.name} aggiunto al listone (${p.price} cr)`, "ok");
      } catch (err) {
        toast(err.message, "err");
        btn.disabled = false; btn.textContent = "Cerca";
      }
    }
    return form;
  });
}

async function restartAuction(ctx) {
  const n = Object.keys(ctx.league.roster || {}).length;
  const ok = await confirmDialog(
    "Ricominciare l'asta da capo?",
    n ? `I ${n} giocatori già assegnati tornano liberi e tutte le rose si svuotano. `
        + "Non si può annullare."
      : "Si torna in sala d'attesa.",
    "Ricomincia",
  );
  if (!ok) return;
  await ctx.mutate((lg) => {
    lg.phase = "lobby";
    lg.roster = {};
    lg.auction = {
      status: "idle", playerId: null, bid: 0, bidderUid: null,
      endsAt: 0, turnIdx: 0, turnEndsAt: 0,
      pausedBy: null, pausedAt: 0, releasedPlayer: null,
    };
    return lg;
  });
  toast("Asta azzerata: siete tornati in sala d'attesa", "ok");
}

async function exportLeague(ctx) {
  const dump = await ctx.store.exportLeague(ctx.league.id);
  const blob = new Blob([JSON.stringify(dump, null, 1)], { type: "application/json" });
  const a = el("a", {
    href: URL.createObjectURL(blob),
    download: `fantascacchi-${ctx.league.id}-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("Backup scaricato", "ok");
}

function importLeague(ctx) {
  const input = el("input", { type: "file", accept: "application/json,.json" });
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const dump = JSON.parse(await file.text());
      const ok = await confirmDialog("Sovrascrivere la lega?",
        `Il backup di "${dump.league?.name}" sostituirà i dati attuali.`, "Importa");
      if (!ok) return;
      const id = await ctx.store.importLeague(dump);
      toast("Backup importato", "ok");
      ctx.go(`#/l/${id}/asta`);
    } catch (err) {
      toast("File non valido: " + err.message, "err");
    }
  };
  input.click();
}

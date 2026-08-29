import { el, toast } from "../ui.js";

/**
 * Schermata di accesso, mostrata solo in modalita' Firebase quando
 * non c'e' una sessione attiva. Il redirect dopo il login e' implicito:
 * l'app si ridisegna da sola appena cambia lo stato di autenticazione,
 * quindi chi arriva da un link d'invito ci torna sopra senza perderlo.
 */
export default function loginView(ctx, pendingLeagueId) {
  const btnGoogle = el("button.btn.btn-primary.btn-lg.btn-block", {
    onclick: () => run(btnGoogle, () => ctx.store.signInWithGoogle()),
  }, googleMark(), "Continua con Google");

  const btnAnon = ctx.store.canAnonymous && el("button.btn.btn-ghost.btn-block", {
    onclick: () => run(btnAnon, () => ctx.store.signInAnon()),
  }, "Entra senza account");

  async function run(btn, fn) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Accesso in corso…";
    try {
      await fn();
      // Nessun redirect qui: ci pensa onAuthChange in app.js.
    } catch (err) {
      toast(err.message || "Accesso non riuscito", "err");
      btn.disabled = false;
      btn.replaceChildren(label);
    }
  }

  return el("div.stack", { style: "gap:2rem" },
    el("section.hero",
      el("h1", "Fantascacchi"),
      el("p.lede",
        "La fanta-lega sugli scacchisti veri. Asta, formazioni e classifica ",
        "sui Titled Tuesday di chess.com."),
    ),

    el("div.card.stack", { style: "max-width:380px;margin:0 auto" },
      pendingLeagueId
        ? el("div.notice", "Ti hanno invitato a una lega. Accedi e ti ci porto subito.")
        : null,
      btnGoogle,
      btnAnon,
      el("p.small.mute-2", { style: "margin:0" },
        "L'accesso serve solo a riconoscerti fra una partita e l'altra. ",
        "Usando Google la tua rosa ti segue anche se cambi telefono o svuoti il browser."),
    ),
  );
}

/** Logo Google, inline: nessuna richiesta esterna da fare. */
function googleMark() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2.5 24 .5 14.6.5 6.5 5.9 2.6 13.7l7.8 6.1C12.3 13.9 17.6 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 6.9-10 6.9-17.3z"/>
    <path fill="#FBBC05" d="M10.4 28.2c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C1 15.9 0 19.8 0 23.5s1 7.6 2.6 10.8l7.8-6.1z"/>
    <path fill="#34A853" d="M24 47c6.2 0 11.5-2 15.4-5.6l-7.5-5.8c-2.1 1.4-4.8 2.2-7.9 2.2-6.4 0-11.7-4.3-13.6-10.1l-7.8 6.1C6.5 41.6 14.6 47 24 47z"/>`;
  return svg;
}

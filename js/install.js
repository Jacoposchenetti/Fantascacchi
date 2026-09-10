/* ---------------------------------------------------------------
   Installazione sulla schermata home.

   Su Android e desktop il browser emette `beforeinstallprompt`: lo si
   blocca, ci si tiene l'evento e si mostra un invito nostro, in italiano
   e nel momento giusto. Il dialogo vero parte solo al clic.

   Su iPhone quell'evento non esiste e non esistera': l'unica strada e'
   spiegare a parole il giro dal tasto Condividi. Vale la pena farlo
   perche' su iOS senza installazione non ci sono nemmeno le notifiche.

   Sul *quando*: mai al primo colpo d'occhio. L'invito compare quando
   qualcuno ha gia' fatto qualcosa nell'app, si chiude, e se lo si chiude
   non torna per due settimane. Al secondo rifiuto sparisce e basta.
   --------------------------------------------------------------- */

const LS_RIFIUTI = "fsc:install:rifiuti";
const LS_QUANDO = "fsc:install:quando";
const LS_VISITE = "fsc:visite";

const ATTESA = 14 * 24 * 60 * 60 * 1000;   // due settimane
const MAX_RIFIUTI = 2;

let promptSalvato = null;
const ascoltatori = new Set();

/* ------------------------------ intercetta ------------------------------ */

/**
 * Va chiamata all'avvio, prima possibile: l'evento arriva una volta sola
 * e se non c'e' nessuno ad ascoltarlo il browser mostra la sua barretta
 * e noi restiamo senza invito.
 */
export function initInstall() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    promptSalvato = e;
    avvisa();
  });
  window.addEventListener("appinstalled", () => {
    promptSalvato = null;
    try { localStorage.removeItem(LS_RIFIUTI); } catch { /* ignora */ }
    avvisa();
  });
  contaVisita();
}

/** Chi disegna un invito si iscrive qui per ridisegnarsi quando cambia. */
export function onInstallChange(cb) {
  ascoltatori.add(cb);
  return () => ascoltatori.delete(cb);
}

function avvisa() { ascoltatori.forEach((cb) => { try { cb(); } catch { /* ignora */ } }); }

/* -------------------------------- stato --------------------------------- */

export function installata() {
  try {
    return window.matchMedia?.("(display-mode: standalone)").matches === true
      || window.navigator.standalone === true;
  } catch { return false; }
}

export function isIOS() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Safari su iPhone/iPad? Solo li' servono le istruzioni a mano. */
function isSafariIOS() {
  return isIOS() && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent || "");
}

/**
 *  "installata"  gia' sulla home, non c'e' niente da proporre
 *  "pronta"      abbiamo il prompt del browser: basta un clic
 *  "istruzioni"  iOS: si spiega il giro dal tasto Condividi
 *  "no"          niente da fare qui (o gia' rifiutata troppe volte)
 */
export function statoInstallazione() {
  if (installata()) return "installata";
  if (promptSalvato) return "pronta";
  if (isSafariIOS()) return "istruzioni";
  return "no";
}

/** Apre il dialogo del browser. true se l'app e' stata installata. */
export async function installa() {
  if (!promptSalvato) return false;
  const e = promptSalvato;
  promptSalvato = null;              // e' usa e getta
  try {
    e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome !== "accepted") rifiuta();
    avvisa();
    return outcome === "accepted";
  } catch {
    avvisa();
    return false;
  }
}

/* ----------------------------- quando mostrarlo -------------------------- */

/**
 * Ha senso far vedere l'invito adesso? Vuole che ci sia qualcosa da
 * proporre, che non sia la primissima visita e che non sia stato appena
 * mandato via.
 */
export function vaProposto() {
  const stato = statoInstallazione();
  if (stato === "installata" || stato === "no") return false;
  if (visite() < 2) return false;
  if (rifiuti() >= MAX_RIFIUTI) return false;
  return Date.now() - ultimoRifiuto() > ATTESA;
}

/** L'utente ha chiuso l'invito: si segna e si tace per un po'. */
export function rifiuta() {
  try {
    localStorage.setItem(LS_RIFIUTI, String(rifiuti() + 1));
    localStorage.setItem(LS_QUANDO, String(Date.now()));
  } catch { /* ignora */ }
  avvisa();
}

function rifiuti() {
  try { return Number(localStorage.getItem(LS_RIFIUTI)) || 0; } catch { return 0; }
}

function ultimoRifiuto() {
  try { return Number(localStorage.getItem(LS_QUANDO)) || 0; } catch { return 0; }
}

function visite() {
  try { return Number(localStorage.getItem(LS_VISITE)) || 0; } catch { return 0; }
}

function contaVisita() {
  try { localStorage.setItem(LS_VISITE, String(visite() + 1)); } catch { /* ignora */ }
}

/* ------------------------------ istruzioni iOS --------------------------- */

/** I passi da mostrare su iPhone, dove il browser non aiuta. */
export const PASSI_IOS = [
  "Tocca il tasto Condividi in fondo allo schermo (il quadrato con la freccia)",
  "Scorri e scegli «Aggiungi a Home»",
  "Conferma: Fantascacchi compare fra le tue app",
];

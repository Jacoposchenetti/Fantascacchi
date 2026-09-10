/* ---------------------------------------------------------------
   Notifiche push.

   Web Push standard con chiavi VAPID: il browser si iscrive a un suo
   servizio di push (Google, Mozilla, Apple...) e ci restituisce un
   endpoint. Quell'endpoint finisce su Firestore, e una Cloud Function
   ci spedisce sopra i messaggi quando succede qualcosa nella lega.

   Niente SDK di messaggistica lato client: l'API `pushManager` e' nativa
   e identica ovunque, Safari compreso. Cambiare fornitore di push un
   domani non toccherebbe una riga di questo file.

   Il caso iOS merita una nota: su iPhone `window.PushManager` esiste
   SOLO se l'app e' stata aggiunta alla schermata home. In Safari normale
   non c'e' proprio, quindi non e' un permesso da chiedere: e'
   un'installazione da fare prima. Vedi `install.js`.
   --------------------------------------------------------------- */

import { VAPID_PUBLIC } from "./config.js";

const LS_CHIESTO = "fsc:push:chiesto";

/* ------------------------------ rilevamento ----------------------------- */

export function isIOS() {
  const ua = navigator.userAgent || "";
  // Gli iPad recenti si spacciano per Mac: il tocco li smaschera.
  return /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** L'app gira dalla schermata home invece che in una scheda del browser? */
export function installata() {
  try {
    return window.matchMedia?.("(display-mode: standalone)").matches === true
      || window.navigator.standalone === true;
  } catch { return false; }
}

/**
 * Stato in cui si trovano le notifiche per questo dispositivo.
 *
 *  "non-supportate"      il browser non le fa (e non c'e' rimedio)
 *  "serve-installazione" iPhone in Safari: prima va aggiunta alla home
 *  "da-chiedere"         si puo' chiedere il permesso
 *  "negate"              l'utente ha detto no: si riabilita dalle
 *                        impostazioni del browser, non da qui
 *  "attive"              permesso dato e iscrizione presente
 */
export async function statoNotifiche() {
  if (!("serviceWorker" in navigator)) return "non-supportate";
  if (!("Notification" in window) || !("PushManager" in window)) {
    return isIOS() && !installata() ? "serve-installazione" : "non-supportate";
  }
  if (Notification.permission === "denied") return "negate";
  if (Notification.permission !== "granted") return "da-chiedere";
  return (await sottoscrizione()) ? "attive" : "da-chiedere";
}

/** L'iscrizione push di questo browser, se c'e'. */
export async function sottoscrizione() {
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch { return null; }
}

/* ------------------------------ attivazione ----------------------------- */

/**
 * Chiede il permesso e iscrive il dispositivo. Va chiamata da un gesto
 * dell'utente: Safari rifiuta la richiesta se arriva da sola, e Chrome
 * penalizza chi la spara al caricamento.
 *
 * Restituisce lo stato finale, cosi' chi chiama sa cosa mostrare.
 */
export async function attivaNotifiche(store) {
  segnaChiesto();

  const stato = await statoNotifiche();
  if (stato === "non-supportate" || stato === "serve-installazione") return stato;

  if (Notification.permission !== "granted") {
    const esito = await Notification.requestPermission();
    if (esito !== "granted") return esito === "denied" ? "negate" : "da-chiedere";
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();

  // Se la chiave del server e' cambiata la vecchia iscrizione non vale piu':
  // meglio buttarla e rifarla che ritrovarsi push che non arrivano mai.
  if (sub && !stessaChiave(sub)) {
    try { await sub.unsubscribe(); } catch { /* gia' sparita */ }
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64urlToBytes(VAPID_PUBLIC),
    });
  }

  await store.savePushSub?.(serializza(sub));
  return "attive";
}

/** Disiscrive questo dispositivo. Gli altri dell'utente restano attivi. */
export async function disattivaNotifiche(store) {
  const sub = await sottoscrizione();
  if (!sub) return "da-chiedere";
  const dati = serializza(sub);
  try { await sub.unsubscribe(); } catch { /* gia' sparita */ }
  await store.removePushSub?.(dati);
  return "da-chiedere";
}

/**
 * Ripassa l'iscrizione al server. I servizi di push ruotano gli endpoint
 * ogni tanto e senza avvisare: senza questo giro di controllo all'avvio
 * le notifiche smetterebbero di arrivare in silenzio.
 */
export async function risincronizza(store) {
  if (Notification?.permission !== "granted") return;
  const sub = await sottoscrizione();
  if (!sub || !stessaChiave(sub)) return;
  try { await store.savePushSub?.(serializza(sub)); } catch { /* riproveremo */ }
}

/* -------------------------------- memoria ------------------------------- */

/** Il permesso e' gia' stato chiesto una volta su questo dispositivo? */
export function giaChiesto() {
  try { return localStorage.getItem(LS_CHIESTO) === "1"; } catch { return false; }
}

/**
 * L'invito e' stato messo via senza rispondere. Si segna come chiesto: chi
 * ha detto di no una volta non va inseguito, il comando resta nel profilo
 * per quando cambia idea.
 */
export function segnaChiesto() {
  try { localStorage.setItem(LS_CHIESTO, "1"); } catch { /* ignora */ }
}

/* -------------------------------- utilita' ------------------------------ */

function serializza(sub) {
  const j = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    p256dh: j.keys?.p256dh || "",
    auth: j.keys?.auth || "",
  };
}

/** L'iscrizione e' stata fatta con la chiave VAPID che usiamo adesso? */
function stessaChiave(sub) {
  const attuale = sub.options?.applicationServerKey;
  if (!attuale) return true;              // il browser non la espone: fidiamoci
  const a = new Uint8Array(attuale);
  const b = base64urlToBytes(VAPID_PUBLIC);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function base64urlToBytes(s) {
  const b64 = (s + "=".repeat((4 - (s.length % 4)) % 4))
    .replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/* ---------------------------------------------------------------
   Avvisi per l'asta: un lotto dura pochi secondi, quindi chi ha il
   telefono in tasca o e' su un'altra scheda deve accorgersene.

   Suono generato con WebAudio invece che con un file: nessun asset da
   scaricare e nessuna richiesta in piu' proprio nel momento in cui
   servirebbe reattivita'.
   --------------------------------------------------------------- */

const LS_MUTE = "fsc:mute";

export function isMuted() {
  try { return localStorage.getItem(LS_MUTE) === "1"; } catch { return false; }
}

export function setMuted(v) {
  try { localStorage.setItem(LS_MUTE, v ? "1" : "0"); } catch { /* ignora */ }
}

/* --------------------------------- suono -------------------------------- */

let ctx = null;

/**
 * I browser creano l'AudioContext sospeso finche' non c'e' stata
 * un'interazione dell'utente: si prova a riattivarlo a ogni suono.
 */
function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** Due note brevi in salita: si sente ma non fa saltare dalla sedia. */
export function beep(pattern = [660, 880]) {
  if (isMuted()) return;
  const ac = audio();
  if (!ac) return;
  try {
    pattern.forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const t0 = ac.currentTime + i * 0.13;
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t0);
      // Attacco e rilascio smussati: un'onda tagliata di netto fa "click".
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + 0.14);
    });
  } catch { /* audio non disponibile: pazienza */ }
}

/** Chiamalo su un gesto dell'utente per sbloccare l'audio in anticipo. */
export function primeAudio() {
  const ac = audio();
  if (ac?.state === "suspended") ac.resume().catch(() => {});
}

/* ------------------------------ vibrazione ------------------------------ */

export function buzz(pattern = [90, 60, 90]) {
  if (isMuted()) return;
  try { navigator.vibrate?.(pattern); } catch { /* non supportata */ }
}

/* ---------------------------- titolo lampeggiante ----------------------- */

let flashTimer = null;
let realTitle = null;

/** Alterna il titolo della scheda finche' non si torna sulla pagina. */
export function flashTitle(message) {
  if (!document.hidden) return;
  stopFlash();
  realTitle = document.title;
  let on = false;
  flashTimer = setInterval(() => {
    on = !on;
    document.title = on ? message : realTitle;
  }, 900);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
}

function onVisible() {
  if (!document.hidden) stopFlash();
}

export function stopFlash() {
  if (!flashTimer) return;
  clearInterval(flashTimer);
  flashTimer = null;
  if (realTitle) document.title = realTitle;
  realTitle = null;
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("focus", onVisible);
}

/* ------------------------------- scorciatoie ---------------------------- */

/** Un lotto si e' aperto. */
export function alertNewLot(playerName) {
  beep([660, 880]);
  buzz([90, 60, 90]);
  flashTitle(`⚡ ${playerName} all'asta!`);
}

/** Tocca a te chiamare. */
export function alertYourTurn() {
  beep([520, 660, 830]);
  buzz([60, 40, 60, 40, 120]);
  flashTitle("♞ Tocca a te chiamare");
}

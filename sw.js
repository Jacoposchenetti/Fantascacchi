/* ---------------------------------------------------------------
   Service worker.

   Strategia: RETE PER PRIMA, e la rete davvero — non la cache del
   browser. La cache resta solo come scorta per l'offline.

   Il perche' e' costato una lezione: la prima versione faceva
   `fetch(req)` liscio. GitHub Pages serve i file con max-age 600, quindi
   quel fetch veniva soddisfatto dalla cache HTTP del browser e restituiva
   codice vecchio di dieci minuti — o piu', se un modulo restava indietro
   rispetto agli altri. L'app si vedeva a meta' aggiornata.

   Ora ogni richiesta al nostro sito parte con `cache: "reload"`: bypassa
   la cache HTTP e chiede sempre al server. Se il file non e' cambiato il
   server risponde 304 e il corpo non viaggia comunque.
   --------------------------------------------------------------- */

const VERSIONE = "fantascacchi-v4";

// Il minimo per far comparire qualcosa anche offline.
const GUSCIO = [
  "./",
  "./index.html",
  "./css/style.css",
  "./manifest.webmanifest",
  "./data/listone.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSIONE)
      .then((c) => Promise.allSettled(
        GUSCIO.map((u) => c.add(new Request(u, { cache: "reload" }))),
      ))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const chiavi = await caches.keys();
    await Promise.all(chiavi.filter((k) => k !== VERSIONE).map((k) => caches.delete(k)));
    await self.clients.claim();
    // Dice alle schede aperte di ricaricarsi: cosi' chi aveva l'app
    // aperta con il codice vecchio passa al nuovo senza doverci pensare.
    const tabs = await self.clients.matchAll({ type: "window" });
    for (const t of tabs) t.postMessage({ tipo: "sw-aggiornato" });
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Solo il nostro sito: chess.com, Firebase e i font li gestisce il browser.
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req, { cache: "reload" })
      .then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copia = res.clone();
          caches.open(VERSIONE).then((c) => c.put(req, copia));
        }
        return res;
      })
      .catch(async () => {
        const salvato = await caches.match(req);
        if (salvato) return salvato;
        if (req.mode === "navigate") {
          const home = await caches.match("./index.html");
          if (home) return home;
        }
        return new Response("Offline", { status: 503, statusText: "Offline" });
      }),
  );
});

/* ------------------------------- notifiche ------------------------------ */
/*
   La push arriva anche ad app chiusa: e' il service worker a svegliarsi,
   non la pagina. Il corpo lo prepara la Cloud Function, qui si traduce
   solo in una notifica di sistema.

   `userVisibleOnly` ci obbliga a mostrare SEMPRE qualcosa: se il payload
   fosse illeggibile va mostrato comunque un messaggio generico, altrimenti
   il browser ci toglie il permesso dopo qualche volta.
*/

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {}; }

  const titolo = d.titolo || "Fantascacchi";
  const opzioni = {
    body: d.corpo || "Novita' nella tua lega.",
    icon: "./data/icons/icona-192.png",
    badge: "./data/icons/icona-192.png",
    lang: "it",
    // Stesso tag = la nuova sostituisce la vecchia invece di impilarsi.
    // Un promemoria d'asta che si ripete non deve riempire il centro notifiche.
    tag: d.tag || "fantascacchi",
    renotify: true,
    timestamp: Date.now(),
    vibrate: [90, 60, 90],
    data: { url: d.url || "./" },
  };

  e.waitUntil(self.registration.showNotification(titolo, opzioni));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  // Base = lo scope del worker, non l'origine: su GitHub Pages l'app vive
  // in una sottocartella, e risolvere sull'origine porterebbe alla radice
  // del dominio, cioe' da tutt'altra parte.
  const base = self.registration.scope;
  const url = new URL(e.notification.data?.url || "./", base).href;

  // Se l'app e' gia' aperta da qualche parte si riusa quella finestra:
  // aprirne una seconda lascerebbe due copie della stessa lega.
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const t of tabs) {
      if (!t.url.startsWith(base)) continue;
      await t.focus();
      if (t.url !== url && "navigate" in t) {
        try { await t.navigate(url); } catch { /* alcuni browser non lo permettono */ }
      }
      return;
    }
    await self.clients.openWindow(url);
  })());
});

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

const VERSIONE = "fantascacchi-v3";

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

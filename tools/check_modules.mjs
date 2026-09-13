/**
 * Carica ogni modulo dell'app in Node e segnala quelli che non si collegano.
 *
 * Perche' esiste
 * --------------
 * `node --check` verifica solo la sintassi. Un file che importa un nome che
 * l'altro modulo non esporta lo supera senza fiatare, e poi il browser
 * rifiuta di far partire TUTTA l'app: gli import si risolvono al momento del
 * collegamento, prima che una sola riga venga eseguita.
 *
 * E' successo davvero. Una sostituzione automatica non ha trovato il blocco
 * da cambiare, ha aggiornato gli import e lasciato il corpo vecchio:
 * standings.js importava scoreSlot, che matchdays.js non esportava piu'.
 * Il sito rispondeva 200 e mostrava una pagina bianca.
 *
 * Questo controllo importa ogni modulo per davvero, quindi vede la stessa
 * cosa che vedrebbe il browser.
 *
 * Uso:  node tools/check_modules.mjs
 *
 * Nota: app.js e' escluso perche' al caricamento avvia l'applicazione e
 * tocca il DOM, che in Node non esiste. Tutti i moduli che importa vengono
 * comunque controllati singolarmente.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("../js/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const ESCLUSI = new Set(["app.js"]);

function tutti(dir) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...tutti(p));
    else if (nome.endsWith(".js")) out.push(p);
  }
  return out;
}

// Minimo indispensabile perche' i moduli che sfiorano il DOM al caricamento
// non esplodano per il motivo sbagliato.
globalThis.window ??= globalThis;
globalThis.document ??= { createElement: () => ({ style: {}, classList: { toggle() {} } }) };
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };

let rotti = 0;
for (const file of tutti(ROOT).sort()) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (ESCLUSI.has(rel)) {
    console.log(`  salto     ${rel}  (avvia l'app al caricamento)`);
    continue;
  }
  try {
    await import(pathToFileURL(file).href);
    console.log(`  ok        ${rel}`);
  } catch (err) {
    rotti += 1;
    console.log(`  ROTTO     ${rel}`);
    console.log(`            ${String(err.message).split("\n")[0]}`);
  }
}

/*
 * I moduli esclusi non si possono importare, ma i loro import vanno
 * controllati lo stesso: basta un nome sbagliato li' dentro per impedire
 * l'avvio esattamente come altrove.
 */
const { readFileSync } = await import("node:fs");

for (const rel of ESCLUSI) {
  const src = readFileSync(join(ROOT, rel), "utf8");
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
    const nomi = m[1].split(",").map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    const dest = m[2];
    if (!dest.startsWith(".")) continue;
    let mod;
    try {
      mod = await import(pathToFileURL(join(ROOT, dest.replace(/^\.\//, ""))).href);
    } catch {
      continue;                       // gia' segnalato sopra se rotto
    }
    for (const nome of nomi) {
      if (!(nome in mod)) {
        rotti += 1;
        console.log(`  ROTTO     ${rel}`);
        console.log(`            importa "${nome}" da ${dest}, che non lo esporta`);
      }
    }
  }
}

if (rotti) {
  console.log(`\n${rotti} problemi: in questo stato l'app non parte.`);
  process.exit(1);
}
console.log("\nTutti i moduli si collegano, app.js compreso.");

// Le Cloud Functions girano su una COPIA di alcuni moduli, perche' il deploy
// vede solo la cartella functions/. Se la copia resta indietro, server e
// client calcolano l'asta in modo diverso: e' il guaio che non da' errori,
// assegna soltanto giocatori sbagliati. Meglio accorgersene qui.
console.log("\nModuli condivisi con le Cloud Functions:");
const sync = spawnSync(process.execPath, ["tools/sync_condiviso.mjs", "--check"],
  { encoding: "utf8" });
process.stdout.write(sync.stdout || "");
if (sync.status !== 0) {
  process.stderr.write(sync.stderr || "");
  process.exit(1);
}

/**
 * Copia in functions/condiviso/ i moduli che server e client devono
 * interpretare ALLO STESSO MODO.
 *
 *     node tools/sync_condiviso.mjs [--check]
 *
 * Perche' una copia e non un import: `firebase deploy` carica solo la
 * cartella functions/, quindi da li' non si vede il resto del repo. Ma
 * ricopiare la logica a mano sarebbe molto peggio di una copia
 * automatica: due implementazioni dell'asta che divergono assegnano
 * giocatori diversi a prezzi diversi, e il giorno che succede nessuno
 * capisce chi ha ragione. Meglio un file generato che due sorgenti.
 *
 * Gira come predeploy (vedi firebase.json), quindi la copia e' sempre
 * fresca al momento del deploy. Con --check non copia: dice solo se le
 * copie sono allineate, cosi' si puo' controllare nei test.
 *
 * I moduli copiati devono restare utilizzabili in Node: niente DOM al
 * livello del modulo. Oggi `fetch` e `location` compaiono solo dentro
 * funzioni che il server non chiama (loadCatalog, inviteLink) e in
 * config.js `location` e' gia' protetto da un typeof.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const DA = join(RADICE, "js");
const A = join(RADICE, "functions", "condiviso");

// L'ordine non conta, ma la chiusura si': se uno di questi importa un
// modulo nuovo va aggiunto qui, altrimenti il deploy fallisce all'avvio.
const MODULI = ["config.js", "league.js", "sealed.js"];

const INTESTAZIONE = (nome) =>
  `/* GENERATO DA tools/sync_condiviso.mjs — NON MODIFICARE QUI.\n`
  + `   La sorgente e' js/${nome}: modifica quella e rilancia lo script\n`
  + `   (parte da sola a ogni "firebase deploy"). */\n`;

const soloCheck = process.argv.includes("--check");

if (!soloCheck) mkdirSync(A, { recursive: true });

let disallineati = 0;
for (const nome of MODULI) {
  const atteso = INTESTAZIONE(nome) + readFileSync(join(DA, nome), "utf8");
  const dest = join(A, nome);
  const attuale = existsSync(dest) ? readFileSync(dest, "utf8") : null;

  if (attuale === atteso) {
    console.log(`  = ${nome}`);
    continue;
  }
  if (soloCheck) {
    console.log(`  ! ${nome} disallineato`);
    disallineati++;
    continue;
  }
  writeFileSync(dest, atteso, "utf8");
  console.log(`  > ${nome} aggiornato`);
}

if (soloCheck && disallineati) {
  console.error(`\n${disallineati} moduli condivisi da risincronizzare: `
    + `node tools/sync_condiviso.mjs`);
  process.exit(1);
}
console.log(soloCheck ? "\nCopie allineate." : `\nSincronizzati in functions/condiviso/.`);

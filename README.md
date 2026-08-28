# ♞ Fantascacchi

Fanta-lega sugli scacchisti veri. Asta a crediti, formazione settimanale, e i punti
arrivano da soli dalla classifica reale dei **Titled Tuesday** di chess.com.

Sito completamente statico: nessun server da mantenere, gira su GitHub Pages.

---

## Come si gioca

1. **Asta** — ognuno parte con 500 crediti. A turno si chiama un giocatore (base 1 credito)
   e si rilancia a tempo; chi offre di più se lo prende. Ogni scacchista appartiene a una
   sola persona. Il sistema non ti lascia mai spendere tutto: tiene da parte 1 credito per
   ogni casella di rosa ancora vuota.
2. **Formazione** — prima di ogni Titled Tuesday scegli i titolari, ordini la panchina e
   nomini il **capitano** (punti ×2). Se un titolare non gioca il torneo, entra il primo
   panchinaro che invece l'ha giocato.
3. **Punti** — a torneo finito si scarica la classifica vera e si calcolano i fantapunti.

### Punteggi

| Voce | Punti |
|---|---|
| Ogni punto fatto nel torneo | ×3 |
| Vittoria del torneo | +25 |
| 2° posto | +18 |
| 3° posto | +14 |
| Top 10 | +8 |
| Top 25 | +4 |
| Top 50 | +2 |
| En plein (11/11) | +15 |
| Almeno 9 punti | +5 |
| Sotto 4 punti | −3 |
| Capitano | ×2 |
| Non ha giocato | entra la panchina |

I bonus piazzamento **non si sommano**: vale solo il più alto. Il capitano raddoppia solo
se scende davvero in campo (se viene sostituito, il bonus si perde).

Le regole stanno in `js/config.js` (`SCORING`) e si possono cambiare a piacere.

---

## Provarlo subito in locale

I moduli ES non funzionano da `file://`, serve un server:

```bash
python -m http.server 8099
```

Poi apri <http://localhost:8099>. Funziona tutto — asta compresa — ma i dati restano
in questo browser: il link d'invito non raggiunge nessun altro. Per giocare davvero
serve il passo qui sotto.

> Curiosità utile per provare: apri due schede dello stesso browser e vedrai l'asta
> sincronizzarsi fra le due (usa `BroadcastChannel`).

---

## Firebase — stato della configurazione

Il progetto **`fantascacchi-cdcca`** è già collegato. Fatto via CLI:

- [x] App web registrata, config incollata in [`js/config.js`](js/config.js)
- [x] API Cloud Firestore abilitata
- [x] Database Firestore creato (`(default)`, regione `eur3` — Europa)
- [x] Regole di [`firestore.rules`](firestore.rules) compilate e pubblicate
- [ ] **Accesso anonimo** — va attivato a mano dalla console

L'ultimo punto è l'unico che la CLI non sa fare: i provider di accesso si
configurano solo dalla console (o via API Identity Platform con un service
account). Sono tre clic:

<https://console.firebase.google.com/project/fantascacchi-cdcca/authentication/providers>

→ **Inizia** → **Anonimo** → **Attiva** → **Salva**.

Serve perché gli amici entrino scrivendo solo il nome, senza registrarsi.
Finché è spento l'app se ne accorge da sola, lo scrive in console e ripiega
sulla modalità locale invece di rompersi.

### Rideployare le regole

```bash
firebase deploy --only firestore:rules
```

### Sulla chiave API

Quella di Firebase è pubblica per progetto, sta in chiaro in ogni app web e non è
un segreto: a proteggere i dati sono le regole Firestore, non lei.

**Sulle regole incluse**: chiunque sia autenticato e conosca il codice di una lega può
scriverci. Per una lega tra amici va bene — i codici sono casuali a 6 caratteri
(circa 900 milioni di combinazioni), quindi non si indovinano. Non metterci dati personali.

---

## Pubblicare su GitHub Pages

```bash
gh repo create fantascacchi --public --source=. --push
```

Poi sul repo: **Settings → Pages → Source: Deploy from a branch → `main` / `root` → Save**.

Dopo un minuto il sito è su `https://<tuo-utente>.github.io/fantascacchi/`.

Il routing usa gli hash (`#/l/abc123/asta`) proprio perché GitHub Pages non sa
riscrivere gli URL: così ogni link funziona anche ricaricando la pagina.

---

## Aggiornare il listone

I prezzi vengono da dati reali: rating blitz + rendimento negli ultimi Titled Tuesday.
Per rigenerarli:

```bash
python tools/build_listone.py --events 6 --top 90
```

Riscrive `data/listone.json`. Vale la pena rifarlo ogni tanto (a inizio stagione, o se
i prezzi cominciano a sembrare fuori scala).

Serve qualcuno che non è in lista? **Impostazioni → Aggiungi un giocatore**, basta il suo
username chess.com.

---

## Com'è fatto

Niente build, niente dipendenze da installare: HTML + moduli ES + un foglio di stile.

```
index.html
css/style.css
js/
  config.js          Firebase + regole di punteggio
  app.js             router a hash, sottoscrizioni, rendering
  store.js           livello dati + adapter locale (localStorage)
  store-firebase.js  adapter Firestore, stessa interfaccia
  chesscom.js        client API chess.com
  scoring.js         calcolo fantapunti
  league.js          stato derivato (rose, budget, turni)
  views/             una vista per schermata
data/listone.json    pool giocatori con prezzi
tools/build_listone.py
```

Tre scelte che vale la pena conoscere se ci metti mano:

- **Una sola primitiva di scrittura.** Tutto ciò che modifica una lega passa da
  `updateLeague(id, mutator)`, che su Firestore è una transazione vera. È il motivo per
  cui due rilanci simultanei non si sovrascrivono.
- **L'asta si chiude da sola, senza server.** Il lotto ha una scadenza assoluta
  (`endsAt`); il primo client che si accorge che è passata prova ad assegnare il
  giocatore. Chi arriva dopo trova lo stato già cambiato e non fa nulla.
- **Il download pesante lo fa una persona sola.** La classifica completa di un Titled
  Tuesday pesa circa mezzo mega. Chi calcola la giornata la scarica una volta e salva uno
  snapshot minuscolo; tutti gli altri leggono quello.

### Note sui dati di chess.com

- Gli ID dei tornei finiscono con un numero opaco
  (`titled-tuesday-blitz-august-25-2026-31064127`), quindi **non** si possono costruire da
  una data: vanno scoperti dalla lista tornei di giocatori che partecipano quasi sempre.
- La classifica finale sta nel gruppo dell'**ultimo turno**: i punti lì dentro sono già
  cumulativi di fine torneo.
- Chi si ritira a metà non compare in quella classifica. Per quei pochi si guarda il suo
  storico personale, che riporta comunque piazzamento e vittorie/patte/sconfitte.
- L'API pubblica non richiede chiavi e manda `Access-Control-Allow-Origin: *`, quindi un
  sito statico può interrogarla direttamente.

#!/usr/bin/env python3
"""
I piu' forti del mondo secondo la FIDE, tradotti in account chess.com.

    python tools/fide.py [--top 15]

Perche' esiste: il listone si ordina per valore ATTESO (media punti x
quanto spesso ti si presenta), ed e' giusto cosi' — uno che gioca due
Titled Tuesday in sei mesi ti rende meno di un onesto mestierante che
c'e' sempre. Ma il risultato e' che Carlsen non compare proprio, e un
listone di fantascacchi senza il numero uno al mondo sembra rotto anche
quando ha ragione.

Quindi i top N FIDE entrano sempre, fuori classifica, col loro prezzo
normale: cari (il prezzo pesa il rating) e quasi sempre assenti. Cioe'
una scommessa vera, che e' esattamente il genere di dilemma che rende
viva un'asta.

L'elenco NON e' scritto a mano: arriva dall'export mensile della FIDE, e
cambia da solo quando cambia la classifica mondiale.

Nota tecnica: le pagine delle classifiche su ratings.fide.com si
disegnano in JavaScript e da uno script non danno niente. L'export in
formato testo invece e' un file a colonne fisse, stabile da anni.
"""

import argparse
import io
import json
import pathlib
import re
import unicodedata
import urllib.request
import zipfile

ZIP = "https://ratings.fide.com/download/standard_rating_list.zip"
UA = "fantascacchi/0.1 (listone builder; https://github.com/Jacoposchenetti/Fantascacchi)"
INDICE = pathlib.Path("data/gm-index.json")


def scarica_lista():
    req = urllib.request.Request(ZIP, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as r:
        dati = r.read()
    z = zipfile.ZipFile(io.BytesIO(dati))
    return z.read(z.namelist()[0]).decode("utf-8", "replace").splitlines()


def top_fide(n=15, soglia=2650):
    """I primi n per Elo standard, esclusi gli inattivi."""
    righe = scarica_lista()
    testa = righe[0]

    # File a colonne fisse: le posizioni si ricavano dall'intestazione, cosi'
    # se la FIDE sposta una colonna non si legge silenziosamente il campo
    # sbagliato. La colonna del rating e' quella del periodo, tipo "SEP26".
    pos = {c: testa.index(c) for c in ("Name", "Fed", "Flag") if c in testa}
    periodo = re.search(r"\b([A-Z]{3}\d{2})\b", testa)
    if not periodo or "Name" not in pos:
        raise SystemExit("Intestazione FIDE inattesa: " + testa[:120])
    pos["rating"] = testa.index(periodo.group(1))

    fuori = []
    for s in righe[1:]:
        try:
            elo = int(s[pos["rating"]:pos["rating"] + 5].strip() or 0)
        except ValueError:
            continue
        if elo < soglia:
            continue
        bandiere = s[pos["Flag"]:].strip() if "Flag" in pos else ""
        # "i" = inattivo, "w" = lista femminile: qui serve la lista assoluta.
        if "i" in bandiere or "w" in bandiere:
            continue
        fuori.append({
            "nome": s[pos["Name"]:pos["Fed"]].strip(),
            "fed": s[pos["Fed"]:pos["Fed"] + 3].strip(),
            "fide": elo,
        })

    fuori.sort(key=lambda p: -p["fide"])
    for i, p in enumerate(fuori[:n], 1):
        p["rank"] = i
    return fuori[:n], periodo.group(1)



def _token(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return [t for t in re.sub(r"[^A-Za-z ]", " ", s).lower().split() if len(t) > 1]


def abbina(nome_fide, indice, attivita=None):
    """
    Da "Carlsen, Magnus" a "magnuscarlsen".

    I due mondi scrivono i nomi in modi diversi ("Praggnanandhaa R" contro
    "Rameshbabu Praggnanandhaa"), quindi si confrontano gli insiemi di
    parole invece delle stringhe. Il pezzo che restringe il campo e' la
    parola piu' lunga, quasi sempre il cognome.

    Il caso difficile non e' l'omonimia, e' il contrario: i fuoriclasse
    hanno piu' account intestati allo stesso nome. Hikaru Nakamura ne ha
    cinque, fra secondi account e quello per lo streaming. Serve quindi
    scegliere il PRINCIPALE, e il criterio migliore ce l'abbiamo gia':
    quello che i Titled Tuesday li jgioca davvero. Un account alternativo
    che non scende mai in campo non farebbe punti a nessuno.

    `attivita` e' {username: tornei giocati}. Senza, si ripiega
    sull'username che somiglia di piu' al nome.
    """
    attivita = attivita or {}
    voluti = set(_token(nome_fide))
    if not voluti:
        return None
    lunga = max(voluti, key=len)
    compatto = "".join(sorted(voluti))

    candidati = []
    for user, nome in indice.items():
        if not nome:
            continue
        altri = set(_token(nome))
        if lunga not in altri:
            continue
        u = user.lower()
        candidati.append((
            len(voluti & altri),                       # quante parole in comune
            attivita.get(user, 0),                     # chi gioca davvero
            sum(1 for t in voluti if t in u),          # username fatto col nome
            -len(u),                                   # a parita', il piu' corto
            user,
        ))

    if not candidati:
        return None
    candidati.sort(reverse=True)
    prima, seconda = candidati[0], (candidati[1] if len(candidati) > 1 else None)
    # Solo un pareggio totale resta ambiguo: li' meglio un buco che l'account
    # sbagliato. Ma con due persone diverse dallo stesso cognome, il numero di
    # parole in comune le separa gia'.
    if seconda and prima[:4] == seconda[:4]:
        return None
    return prima[4]


def risolvi(n=15, attivita=None):
    """[(dati FIDE, username chess.com o None)], piu' il periodo."""
    if not INDICE.exists():
        raise SystemExit(
            f"Manca {INDICE}. Crealo con: python tools/build_gm_index.py")
    indice = json.loads(INDICE.read_text(encoding="utf-8"))["players"]
    elenco, periodo = top_fide(n)
    for p in elenco:
        p["user"] = abbina(p["nome"], indice, attivita)
    return elenco, periodo


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=15)
    args = ap.parse_args()

    # Lanciato a mano: chi gioca davvero si legge dal listone gia' costruito.
    # Senza, fra i cinque account di Hikaru si sceglierebbe quello sbagliato.
    attivita = {}
    listone = pathlib.Path("data/listone.json")
    if listone.exists():
        for g in json.loads(listone.read_text(encoding="utf-8"))["players"]:
            attivita[g["id"]] = g.get("events", 0)

    elenco, periodo = risolvi(args.top, attivita)
    print(f"Top {args.top} FIDE standard ({periodo}):\n")
    persi = 0
    for p in elenco:
        stato = p["user"] or "?? nessun account trovato"
        if not p["user"]:
            persi += 1
        print(f'{p["rank"]:2}. {p["fide"]}  {p["nome"]:30} {p["fed"]}  {stato}')
    print(f'\nAbbinati {args.top - persi}/{args.top}')

#!/usr/bin/env python3
"""
Indice nome vero -> username chess.com per tutti i GM.

    python tools/build_gm_index.py [--titles GM,IM] [--max-new 2000]

Serve per una cosa sola: la FIDE pubblica i suoi elenchi per NOME
("Carlsen, Magnus"), chess.com lavora per USERNAME ("magnuscarlsen"), e
non esiste un endpoint che traduca fra i due. L'unico modo e' scaricare i
profili e leggerci il campo `name`.

E' costoso una volta sola (circa 1700 GM, sei minuti) e gratis dopo:
l'indice si salva in data/gm-index.json e ai giri successivi si scaricano
soltanto gli username che non c'erano. Chi diventa GM domani entra al
primo aggiornamento.

Nota: non tutti compilano il nome vero sul profilo. Chi non ce l'ha resta
segnato con nome vuoto, cosi' non lo si ripesca a ogni esecuzione.
"""

import argparse
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

API = "https://api.chess.com/pub"
UA = "fantascacchi/0.1 (gm index; https://github.com/Jacoposchenetti/Fantascacchi)"
SLEEP = 0.12
OUT = pathlib.Path("data/gm-index.json")


def get(url, tentativi=3):
    for i in range(tentativi):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 429:                      # troppo in fretta: si respira
                time.sleep(2 + i * 3)
                continue
            if i == tentativi - 1:
                raise
        except Exception:
            if i == tentativi - 1:
                raise
            time.sleep(1 + i)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--titles", default="GM",
                    help="titoli da indicizzare, separati da virgola (default: GM)")
    ap.add_argument("--max-new", type=int, default=2500,
                    help="tetto ai profili nuovi per esecuzione, per non sforare i tempi")
    args = ap.parse_args()

    indice = {}
    if OUT.exists():
        indice = json.loads(OUT.read_text(encoding="utf-8")).get("players", {})
    print(f"[1/3] Indice esistente: {len(indice)} username")

    voluti = []
    for t in args.titles.split(","):
        t = t.strip().upper()
        if not t:
            continue
        dati = get(f"{API}/titled/{t}")
        elenco = (dati or {}).get("players", [])
        print(f"      {t}: {len(elenco)} account")
        voluti.extend(elenco)

    nuovi = [u for u in dict.fromkeys(voluti) if u not in indice][: args.max_new]
    print(f"[2/3] Da scaricare: {len(nuovi)} profili nuovi")

    for i, u in enumerate(nuovi, 1):
        try:
            p = get(f"{API}/player/{u}") or {}
            # Stringa vuota = "profilo visto, nome non dichiarato": evita di
            # riprovarci per sempre a ogni esecuzione.
            indice[u] = (p.get("name") or "").strip()
        except Exception as e:
            print(f"      ! {u}: {e}", file=sys.stderr)
        if i % 100 == 0:
            print(f"      {i}/{len(nuovi)}...", flush=True)
        time.sleep(SLEEP)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "count": len(indice),
        "players": indice,
    }, ensure_ascii=False, indent=0), encoding="utf-8")

    con_nome = sum(1 for v in indice.values() if v)
    print(f"[3/3] Salvato {OUT}: {len(indice)} username, {con_nome} con nome vero")


if __name__ == "__main__":
    main()

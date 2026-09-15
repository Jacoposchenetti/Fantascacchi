#!/usr/bin/env python3
"""
Genera data/tt/partite/<torneo>.json: l'indice delle partite giocate dai
giocatori del listone in ogni Titled Tuesday.

    python tools/build_games.py [--events 13] [--force]

Nell'indice ci sono solo i DATI, non le mosse: chi ha giocato, con che
colore, com'e' finita, e le coordinate (turno + gruppo) per ritrovare la
partita. Undici KB compressi a torneo invece di trecento.

Le mosse si scaricano da chess.com quando uno apre davvero una partita.
Costa una chiamata da 130 KB compressi, ma quella chiamata porta TUTTE le
partite di quel turno: chi ne guarda tre di fila ne paga una sola.

L'alternativa — mettere i PGN nel repo — sarebbe stata 11 MB per tredici
tornei e 44 MB l'anno, per dati che chess.com serve gia' benissimo.
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.chess.com/pub"
UA = "fantascacchi/0.1 (games index; https://github.com/Jacoposchenetti/Fantascacchi)"
SLEEP = 0.12

RADICE = Path(__file__).resolve().parent.parent
DEST = RADICE / "data" / "tt" / "partite"


def get(url, tentativi=3):
    for i in range(tentativi):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 429:
                time.sleep(2 + i * 3)
                continue
            if i == tentativi - 1:
                return None
        except Exception:
            if i == tentativi - 1:
                return None
            time.sleep(1 + i)
    return None


# Gli esiti di chess.com sono una dozzina di stringhe; qui servono tre casi.
VINTO = "win"
PATTA = {"agreed", "repetition", "stalemate", "insufficient", "50move",
         "timevsinsufficient"}


def esito(gioco):
    """'w' se vince il bianco, 'b' se vince il nero, 'd' se patta."""
    r = (gioco.get("white") or {}).get("result")
    if r == VINTO:
        return "w"
    if r in PATTA:
        return "d"
    return "b"


def partite_del_torneo(tid, listone):
    """Tutte le partite del torneo che riguardano almeno un giocatore nostro."""
    fuori = []
    for rnd in range(1, 12):
        gruppo = 1
        while True:
            g = get(f"{API}/tournament/{tid}/{rnd}/{gruppo}")
            time.sleep(SLEEP)
            if not g or not g.get("games"):
                break
            for p in g["games"]:
                w = ((p.get("white") or {}).get("username") or "").lower()
                b = ((p.get("black") or {}).get("username") or "").lower()
                if w not in listone and b not in listone:
                    continue
                fuori.append({
                    "w": w,
                    "b": b,
                    # Rating del momento: e' l'unico posto dove chess.com lo
                    # pubblica, e serve a far vedere quanto valeva l'impresa.
                    "wr": (p.get("white") or {}).get("rating"),
                    "br": (p.get("black") or {}).get("rating"),
                    "e": esito(p),
                    "t": rnd,
                    "g": gruppo,
                    # L'id della partita: basta per il link a chess.com.
                    "id": (p.get("url") or "").rsplit("/", 1)[-1],
                    "eco": nome_apertura(p.get("eco")),
                })
            gruppo += 1
    return fuori


def nome_apertura(url):
    """Dall'URL dell'ECO al nome leggibile: .../French-Defense-Exchange... """
    if not url:
        return ""
    coda = url.rsplit("/", 1)[-1]
    # Le varianti dopo le mosse ("...4.Nf3-Bd6") non servono in un elenco.
    coda = re.split(r"-?\d+\.", coda)[0]
    return coda.replace("-", " ").strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--events", type=int, default=13,
                    help="quanti tornei recenti indicizzare")
    ap.add_argument("--force", action="store_true",
                    help="rifa' anche i tornei gia' presenti")
    args = ap.parse_args()

    listone_file = RADICE / "data" / "listone.json"
    indice_file = RADICE / "data" / "tt" / "index.json"
    if not listone_file.exists() or not indice_file.exists():
        print("ERRORE: servono data/listone.json e data/tt/index.json",
              file=sys.stderr)
        return 1

    listone = {p["id"] for p in
               json.loads(listone_file.read_text(encoding="utf-8"))["players"]}
    eventi = json.loads(indice_file.read_text(encoding="utf-8")).get("events", [])
    eventi = sorted(eventi, key=lambda e: -(e.get("start") or 0))[: args.events]

    DEST.mkdir(parents=True, exist_ok=True)
    print(f"[1/2] {len(eventi)} tornei, {len(listone)} giocatori nel listone")

    fatti = 0
    for i, ev in enumerate(eventi, 1):
        dest = DEST / f"{ev['id']}.json"
        if dest.exists() and not args.force:
            print(f"      {i}/{len(eventi)} {ev['date']}  gia' fatto")
            continue
        print(f"      {i}/{len(eventi)} {ev['date']}  scarico...", flush=True)
        partite = partite_del_torneo(ev["id"], listone)
        if not partite:
            print(f"      ! nessuna partita per {ev['id']}", file=sys.stderr)
            continue
        dest.write_text(json.dumps({
            "event": ev["id"],
            "date": ev.get("date"),
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "games": partite,
        }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        fatti += 1
        print(f"        {len(partite)} partite, {dest.stat().st_size / 1024:.0f} KB")

    # Via gli indici dei tornei usciti dalla finestra: la cartella non deve
    # gonfiarsi all'infinito con roba che l'app non mostra piu'.
    tenere = {e["id"] for e in eventi}
    for vecchio in DEST.glob("*.json"):
        if vecchio.stem not in tenere:
            vecchio.unlink()
            print(f"      - tolto {vecchio.stem} (fuori finestra)")

    print(f"[2/2] {fatti} tornei nuovi indicizzati in {DEST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Scarica le classifiche finali dei Mondiali Rapid/Blitz da chess-results.

    python tools/mondiali/scarica.py --lista tornei.json --out mondiali.csv

chess-results pubblica per ogni torneo una tabella "Final Ranking" con
rango, titolo, nome, federazione, rating di PARTENZA, punti e performance.
E' tutto quello che serve: il rating di partenza e' l'informazione che si
ha prima che il torneo cominci, quindi e' l'unica che un modello puo'
legittimamente usare per prevedere.

Le pagine sono cache-ate su disco: chess-results non va martellato, e
rifare l'analisi non deve significare riscaricare tutto.
"""

import argparse
import csv
import gzip
import json
import pathlib
import re
import sys
import time
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")
CACHE = pathlib.Path("tools/mondiali/cache")


def scarica(tnr, art=1):
    """L'HTML di una pagina, dalla cache se c'e' gia'."""
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"tnr{tnr}_art{art}.html"
    if f.exists():
        return f.read_text(encoding="utf-8")
    url = (f"https://chess-results.com/tnr{tnr}.aspx"
           f"?lan=1&art={art}&flag=30&zeilen=99999")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    raw = urllib.request.urlopen(req, timeout=90).read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    html = raw.decode("utf-8", "replace")
    f.write_text(html, encoding="utf-8")
    time.sleep(1.5)                      # cortesia
    return html


def celle(riga_html):
    fuori = []
    for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", riga_html, re.S):
        testo = re.sub(r"<[^>]+>", " ", c)
        testo = testo.replace("&nbsp;", " ").replace("&amp;", "&")
        fuori.append(" ".join(testo.split()))
    return fuori


def tabella(html):
    """(intestazioni, righe) della tabella di classifica."""
    # Le pagine piu' recenti usano CRng1/CRng2 dove le vecchie usano CRg1/CRg2.
    righe = re.findall(r'<tr class="CRn?g\d[b]?[^"]*"[^>]*>(.*?)</tr>', html, re.S)
    if not righe:
        return [], []
    intest = celle(righe[0])
    dati = [celle(r) for r in righe[1:]]
    larg = len(intest)
    return intest, [d for d in dati if len(d) == larg]


def num(s):
    if s is None:
        return None
    s = s.replace(",", ".").strip()
    try:
        return float(s)
    except ValueError:
        return None


def estrai(tnr, meta):
    # art=1 e' la classifica finale nella maggior parte dei tornei, ma non
    # in tutti: qualche pagina piu' vecchia la espone sotto art=4.
    for art in (1, 4):
        html = scarica(tnr, art)
        intest, righe = tabella(html)
        if righe:
            break
    titolo = re.search(r"<h2>(.*?)</h2>", html, re.S)
    if not righe:
        print(f"  ! {tnr}: nessuna riga", file=sys.stderr)
        return []

    idx = {h.strip().lower(): i for i, h in enumerate(intest)}
    def col(*nomi):
        for n in nomi:
            if n in idx:
                return idx[n]
        return None

    i_rk, i_name = col("rk."), col("name")
    i_rtg, i_pts = col("rtg", "rtgi"), col("pts.")
    i_fed, i_rp = col("fed"), col("rp")
    if None in (i_rk, i_name, i_rtg, i_pts):
        print(f"  ! {tnr}: colonne inattese {intest}", file=sys.stderr)
        return []

    fuori = []
    for r in righe:
        rk, rtg = num(r[i_rk]), num(r[i_rtg])
        if rk is None or not r[i_name]:
            continue
        fuori.append({
            "torneo": tnr,
            "anno": meta["anno"],
            "tipo": meta["tipo"],
            "sezione": meta.get("sezione", "open"),
            "turni": meta.get("turni"),
            "rango": int(rk),
            "nome": r[i_name],
            "fed": r[i_fed] if i_fed is not None else "",
            "rating": int(rtg) if rtg else None,
            "punti": num(r[i_pts]),
            "performance": num(r[i_rp]) if i_rp is not None else None,
        })
    nome_t = (titolo.group(1).strip() if titolo else "?")
    print(f"  {tnr}  {meta['anno']} {meta['tipo']:5}  {len(fuori):>4} giocatori   {nome_t}")
    return fuori


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lista", default="tools/mondiali/tornei.json")
    ap.add_argument("--out", default="tools/mondiali/mondiali.csv")
    a = ap.parse_args()

    tornei = json.loads(pathlib.Path(a.lista).read_text(encoding="utf-8"))
    tutte = []
    for t in tornei:
        try:
            tutte.extend(estrai(t["tnr"], t))
        except Exception as e:
            print(f"  ! {t['tnr']}: {type(e).__name__} {e}", file=sys.stderr)

    if not tutte:
        raise SystemExit("nessun dato raccolto")

    campi = list(tutte[0].keys())
    with open(a.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=campi)
        w.writeheader()
        w.writerows(tutte)
    print(f"\nScritte {len(tutte)} righe in {a.out}")


if __name__ == "__main__":
    main()

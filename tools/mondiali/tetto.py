#!/usr/bin/env python3
"""
Quanto si puo' prevedere, al massimo? E cosa aiuta davvero?

    python tools/mondiali/tetto.py

Prima di cercare modelli piu' complessi conviene misurare il tetto. Se il
sovrarendimento rispetto all'Elo fosse una qualita' stabile del giocatore
— "questo rende sempre sopra il suo rating" — allora si potrebbe imparare.
Se invece e' rumore, nessuna quantita' di variabili in piu' lo prevedera',
perche' non c'e' niente da prevedere.

Due misure del tetto, entrambe senza modelli:

1. Stesso giocatore, STESSO WEEKEND. Rapid e blitz dei Mondiali si giocano
   a tre giorni di distanza, stessa citta', stessa forma, stessa
   preparazione. Se il sovrarendimento e' una qualita', qui deve vedersi.

2. Stessa disciplina, edizioni consecutive. Confronto piu' pulito
   (rapid con rapid) al prezzo di un anno di distanza.

Come metro di paragone si misura anche la stabilita' del RATING, per
avere sotto gli occhi che aspetto ha un segnale vero.

Poi si prova la cosa che invece funziona: l'ETA'. Non perche' preveda la
fortuna, ma perche' corregge un difetto del rating — quello di un
ragazzino che migliora piu' in fretta di quanto la lista si aggiorni.
"""

import pathlib
import sys
import numpy as np
import pandas as pd
from scipy.stats import pearsonr, spearmanr

CSV = pathlib.Path(sys.argv[1] if len(sys.argv) > 1
                   else "tools/mondiali/mondiali_eta.csv")
df = pd.read_csv(CSV).dropna(subset=["rating", "rango"]).copy()
df["evento"] = df.anno.astype(str) + "-" + df.tipo
df["rango_elo"] = df.groupby("evento")["rating"].rank(ascending=False, method="min")
df["perc_reale"] = df.groupby("evento")["rango"].transform(lambda s: s / s.max())
df["perc_elo"] = df.groupby("evento")["rango_elo"].transform(lambda s: s / s.max())
df["scarto"] = df.perc_elo - df.perc_reale

sep = "=" * 76

# ----------------------------- 1. il tetto -----------------------------------

print(sep)
print("1. IL TETTO — quanto del sovrarendimento e' una qualita' e quanto e' caso")
print(sep)

def stabilita(x, y):
    r = pearsonr(x, y).statistic
    return r, r ** 2 * 100

print("\n  Stesso giocatore, stesso weekend (rapid contro blitz):")
ax, ay, bx, by = [], [], [], []
for anno, g in df.groupby("anno"):
    r = g[g.tipo == "rapid"].drop_duplicates("gio").set_index("gio")
    b = g[g.tipo == "blitz"].drop_duplicates("gio").set_index("gio")
    com = r.index.intersection(b.index)
    if len(com) < 30:
        continue
    ax += list(r.loc[com, "scarto"]); ay += list(b.loc[com, "scarto"])
    forti = [f for f in r.loc[com].nsmallest(50, "rango_elo").index if f in b.index]
    bx += list(r.loc[forti, "scarto"]); by += list(b.loc[forti, "scarto"])
r1, v1 = stabilita(ax, ay)
r2, v2 = stabilita(bx, by)
print(f"    tutto il campo   r={r1:+.3f}   stabile {v1:4.1f}%   (n={len(ax):,})")
print(f"    primi 50         r={r2:+.3f}   stabile {v2:4.1f}%   (n={len(bx):,})")

print("\n  Stessa disciplina, edizioni consecutive:")
for tipo in ("rapid", "blitz"):
    d = df[df.tipo == tipo]
    ax, ay, bx, by, rx, ry = [], [], [], [], [], []
    anni = sorted(d.anno.unique())
    for a1, a2 in zip(anni, anni[1:]):
        g1 = d[d.anno == a1].drop_duplicates("gio").set_index("gio")
        g2 = d[d.anno == a2].drop_duplicates("gio").set_index("gio")
        com = g1.index.intersection(g2.index)
        if len(com) < 25:
            continue
        ax += list(g1.loc[com, "scarto"]); ay += list(g2.loc[com, "scarto"])
        rx += list(g1.loc[com, "rating"]); ry += list(g2.loc[com, "rating"])
        forti = g1.loc[com].nsmallest(50, "rango_elo").index
        bx += list(g1.loc[forti, "scarto"]); by += list(g2.loc[forti, "scarto"])
    r1, v1 = stabilita(ax, ay)
    r2, v2 = stabilita(bx, by)
    rr, vr = stabilita(rx, ry)
    print(f"    {tipo:6}  sovrarendimento: tutti r={r1:+.3f} ({v1:4.1f}%)   "
          f"primi 50 r={r2:+.3f} ({v2:4.1f}%)")
    print(f"    {'':6}  il RATING invece:            r={rr:+.3f} ({vr:4.1f}%)  "
          f"<- ecco un segnale vero")

# --------------------------- 2. cosa correla ---------------------------------

print("\n" + sep)
print("2. QUALI VARIABILI TOCCANO IL SOVRARENDIMENTO")
print(sep)

d = df.dropna(subset=["eta"]).copy()
d["div_veloce"] = d.rating - d["std"]
for nome, col, nota in [
        ("eta'", "eta", ""),
        ("rating rapido meno classico", "div_veloce",
         "  (il rating classico e' quello di oggi: per i tornei vecchi\n"
         "   contiene informazione dal futuro, quindi e' un tetto ottimistico)")]:
    sub = d.dropna(subset=[col])
    sub = sub[sub["std"] > 0] if col == "div_veloce" else sub
    a = pearsonr(sub[col], sub.scarto)
    t = sub[sub.rango_elo <= 50]
    b = pearsonr(t[col], t.scarto)
    print(f"\n  {nome}")
    print(f"    tutto il campo   r={a.statistic:+.3f}  p={a.pvalue:.1e}  (n={len(sub):,})")
    print(f"    primi 50         r={b.statistic:+.3f}  p={b.pvalue:.1e}  (n={len(t):,})")
    if nota:
        print(nota)

print("\n  Sovrarendimento medio per fascia d'eta' (tutto il campo):")
d["fascia"] = pd.cut(d.eta, [0, 18, 23, 28, 35, 45, 90],
                     labels=["<=18", "19-23", "24-28", "29-35", "36-45", "46+"])
for f, g in d.groupby("fascia", observed=True):
    if len(g) < 20:
        continue
    barra = "#" * int(abs(g.scarto.mean()) * 120)
    print(f"    {str(f):>6}  {g.scarto.mean():+.4f}  (n={len(g):>4})  {barra}")

# ------------------------ 3. l'eta' migliora davvero? ------------------------

print("\n" + sep)
print("3. AGGIUNGERE L'ETA' — previsione in avanti, addestrata solo sul passato")
print(sep)

d = df.copy()
d["eta"] = d["eta"].fillna(d["eta"].median())
d = d.sort_values(["anno", "tipo"]).reset_index(drop=True)
st, ps = {}, []
for r in d.itertuples():
    p = st.get(r.gio, [])
    ps.append(np.mean(p) if p else 0.0)
    st.setdefault(r.gio, []).append(r.scarto)
d["scarto_passato"] = ps

rho = lambda a, b: spearmanr(a, b).statistic
righe = []
for anno in sorted(d.anno.unique())[3:]:
    tr, te = d[d.anno < anno], d[d.anno == anno]
    if len(tr) < 300 or te.empty:
        continue
    eta_media = tr.eta.mean()
    X = np.c_[tr.scarto_passato, tr.eta - eta_media, np.ones(len(tr))]
    (b_st, b_eta, cost), *_ = np.linalg.lstsq(X, tr.scarto.values, rcond=None)

    for ev, g in te.groupby("evento"):
        def prevedi(h, con_eta):
            s = h.perc_elo.values - b_st * h.scarto_passato.values - cost
            return s - b_eta * (h.eta.values - eta_media) if con_eta else s
        t = g.nsmallest(50, "rango_elo")
        righe.append(dict(
            ev=ev, elo=rho(g.rango, g.rango_elo),
            sen=rho(g.rango, prevedi(g, False)), con=rho(g.rango, prevedi(g, True)),
            elo50=rho(t.rango, t.rango_elo),
            sen50=rho(t.rango, prevedi(t, False)), con50=rho(t.rango, prevedi(t, True)),
            b_eta=b_eta))
R = pd.DataFrame(righe)

print(f"\n{'evento':<13} {'------ tutti ------':>26}   {'----- primi 50 -----':>28}")
print(f"{'':13} {'Elo':>8} {'storico':>8} {'+eta':>8}   {'Elo':>9} {'storico':>8} {'+eta':>8}")
print("-" * 74)
for r in R.itertuples():
    print(f"{r.ev:<13} {r.elo:>8.3f} {r.sen:>8.3f} {r.con:>8.3f}   "
          f"{r.elo50:>9.3f} {r.sen50:>8.3f} {r.con50:>8.3f}")
print("-" * 74)
print(f"{'MEDIA':<13} {R.elo.mean():>8.3f} {R.sen.mean():>8.3f} {R.con.mean():>8.3f}   "
      f"{R.elo50.mean():>9.3f} {R.sen50.mean():>8.3f} {R.con50.mean():>8.3f}")

print(f"\n  Guadagno sull'Elo")
print(f"    tutto il campo   solo storico {(R.sen - R.elo).mean():+.3f}   "
      f"con l'eta' {(R.con - R.elo).mean():+.3f}")
print(f"    primi 50         solo storico {(R.sen50 - R.elo50).mean():+.3f}   "
      f"con l'eta' {(R.con50 - R.elo50).mean():+.3f}")
v = (R.con50 > R.elo50).sum()
print(f"    sui primi 50 batte l'Elo in {v}/{len(R)} eventi ({v / len(R) * 100:.0f}%)")
print(f"\n  Peso dell'eta': {R.b_eta.mean():+.5f} per anno — dieci anni in meno "
      f"valgono {abs(R.b_eta.mean()) * 1000:.1f} percentili di classifica")

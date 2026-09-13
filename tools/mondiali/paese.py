#!/usr/bin/env python3
"""
Il paese conta? Due ipotesi diverse, e vanno separate.

    python tools/mondiali/paese.py

1. GIOCARE IN CASA. Niente viaggio, niente fuso, pubblico amico. Effetto
   piccolo ma plausibile, e qui e' misurabile perche' la sede cambia ogni
   anno. Attenzione al trabocchetto: il paese ospitante infila sempre un
   po' di giocatori locali per invito, che sono di livello piu' basso e
   spesso con un Elo tarato su un giro chiuso. Se non si controlla il
   livello, il "vantaggio di casa" esce del segno sbagliato.

2. TARATURA DEL RATING PER FEDERAZIONE. Questa e' la piu' promettente,
   ed e' la stessa idea che fa funzionare l'eta': non prevede la fortuna,
   corregge un DIFETTO del rating. Un Elo costruito quasi solo contro
   avversari della stessa federazione puo' essere gonfio o sgonfio
   rispetto alla scala internazionale, e allora quei giocatori rendono
   sistematicamente sotto o sopra il loro numero.

   La differenza con il singolo giocatore e' che qui si fa una MEDIA su
   molti: il rumore individuale, che avevamo visto essere quasi tutto, si
   cancella, e resta l'eventuale distorsione comune.

Come per tutto il resto, l'effetto di una federazione si stima solo sugli
anni PRECEDENTI, e si contrae verso zero quando i casi sono pochi:
altrimenti una federazione con tre giocatori fortunati sembra un fenomeno.
"""

import pathlib
import sys
import numpy as np
import pandas as pd
from scipy.stats import pearsonr, spearmanr

# Sede di ogni edizione. La federazione del paese ospitante, come la scrive
# chess-results.
CASA = {2014: "UAE", 2015: "GER", 2016: "QAT", 2017: "KSA", 2018: "RUS",
        2019: "RUS", 2021: "POL", 2022: "KAZ", 2023: "UZB", 2024: "USA",
        2025: "QAT"}

CSV = pathlib.Path(sys.argv[1] if len(sys.argv) > 1
                   else "tools/mondiali/mondiali_eta.csv")
df = pd.read_csv(CSV).dropna(subset=["rating", "rango", "fed"]).copy()
df["evento"] = df.anno.astype(str) + "-" + df.tipo
df["rango_elo"] = df.groupby("evento")["rating"].rank(ascending=False, method="min")
df["perc_reale"] = df.groupby("evento")["rango"].transform(lambda s: s / s.max())
df["perc_elo"] = df.groupby("evento")["rango_elo"].transform(lambda s: s / s.max())
df["scarto"] = df.perc_elo - df.perc_reale
df["in_casa"] = [f == CASA.get(a) for f, a in zip(df.fed, df.anno)]
df["eta"] = df["eta"].fillna(df["eta"].median())

sep = "=" * 76
print(sep)
print("1. GIOCARE IN CASA")
print(sep)

casa, fuori = df[df.in_casa], df[~df.in_casa]
print(f"\n  {'':22} {'in casa':>10} {'ospiti':>10} {'scarto':>10}")
print(f"  {'sovrarendimento':22} {casa.scarto.mean():>10.4f} "
      f"{fuori.scarto.mean():>10.4f} {casa.scarto.mean()-fuori.scarto.mean():>+10.4f}")
print(f"  {'rating medio':22} {casa.rating.mean():>10.0f} {fuori.rating.mean():>10.0f} "
      f"{casa.rating.mean()-fuori.rating.mean():>+10.0f}")
print(f"  {'quanti':22} {len(casa):>10} {len(fuori):>10}")
print("\n  Il rating medio dei padroni di casa e' molto piu' basso: sono gli")
print("  inviti locali. Quindi il confronto grezzo non dice niente, va fatto")
print("  a parita' di livello.")

print(f"\n  A parita' di fascia di rating:")
df["fascia"] = pd.cut(df.rating, [0, 2300, 2500, 2600, 2700, 3000],
                      labels=["<2300", "2300-2500", "2500-2600", "2600-2700", "2700+"])
print(f"  {'fascia':>12} {'in casa':>10} {'n':>5} {'ospiti':>10} {'n':>6} {'scarto':>10}")
for f, g in df.groupby("fascia", observed=True):
    c, o = g[g.in_casa], g[~g.in_casa]
    if len(c) < 10:
        continue
    print(f"  {str(f):>12} {c.scarto.mean():>10.4f} {len(c):>5} "
          f"{o.scarto.mean():>10.4f} {len(o):>6} {c.scarto.mean()-o.scarto.mean():>+10.4f}")

# ------------------------ 2. taratura per federazione ------------------------

print("\n" + sep)
print("2. TARATURA DEL RATING PER FEDERAZIONE")
print(sep)

conteggi = df.fed.value_counts()
grandi = conteggi[conteggi >= 40].index
med = df[df.fed.isin(grandi)].groupby("fed").agg(
    scarto=("scarto", "mean"), n=("scarto", "size"), rating=("rating", "mean"))
med = med.sort_values("scarto")

print(f"\n  Federazioni con almeno 40 presenze — chi rende sotto e sopra il proprio Elo:")
print(f"  {'fed':>6} {'sovrarend.':>12} {'n':>5} {'rating medio':>13}")
for f, r in list(med.head(6).iterrows()) + [("...", None)] + list(med.tail(6).iterrows()):
    if r is None:
        print(f"  {'...':>6}")
        continue
    print(f"  {f:>6} {r.scarto:>12.4f} {int(r.n):>5} {r.rating:>13.0f}")

# La domanda vera: e' stabile? Il passato di una federazione predice il futuro?
print("\n  E' un effetto stabile? (media della federazione negli anni passati")
print("  contro il suo rendimento nell'anno dopo)")
df = df.sort_values(["anno", "tipo"]).reset_index(drop=True)
K = 40          # contrazione: con meno di ~40 casi l'effetto si smorza
storia, atteso = {}, []
for r in df.itertuples():
    passate = storia.get(r.fed, [])
    n = len(passate)
    atteso.append((n * np.mean(passate)) / (n + K) if n else 0.0)
    storia.setdefault(r.fed, []).append(r.scarto)
df["fed_passata"] = atteso

con_storia = df[df.fed_passata != 0]
a = pearsonr(con_storia.fed_passata, con_storia.scarto)
t = con_storia[con_storia.rango_elo <= 50]
b = pearsonr(t.fed_passata, t.scarto)
print(f"    tutto il campo   r={a.statistic:+.3f}  p={a.pvalue:.1e}  (n={len(con_storia):,})")
print(f"    primi 50         r={b.statistic:+.3f}  p={b.pvalue:.1e}  (n={len(t):,})")
print("\n  Da confrontare con la persistenza del SINGOLO giocatore, che sui")
print("  primi 50 era zero: mediare su molti cancella il rumore individuale.")

# --------------------- 3. serve, in previsione? ------------------------------

print("\n" + sep)
print("3. MIGLIORA LA PREVISIONE? — addestrato solo sugli anni precedenti")
print(sep)

st, ps = {}, []
for r in df.itertuples():
    p = st.get(r.gio, [])
    ps.append(np.mean(p) if p else 0.0)
    st.setdefault(r.gio, []).append(r.scarto)
df["scarto_passato"] = ps

rho = lambda a, b: spearmanr(a, b).statistic
MODELLI = {
    "storico": ["scarto_passato"],
    "+ eta'": ["scarto_passato", "eta_c"],
    "+ eta' + paese": ["scarto_passato", "eta_c", "fed_passata", "casa"],
}
righe = []
for anno in sorted(df.anno.unique())[3:]:
    tr, te = df[df.anno < anno].copy(), df[df.anno == anno].copy()
    if len(tr) < 300 or te.empty:
        continue
    m_eta = tr.eta.mean()
    for d in (tr, te):
        d["eta_c"] = d.eta - m_eta
        d["casa"] = d.in_casa.astype(float)

    coef = {}
    for nome, cols in MODELLI.items():
        X = np.c_[tr[cols].values, np.ones(len(tr))]
        coef[nome], *_ = np.linalg.lstsq(X, tr.scarto.values, rcond=None)

    for ev, g in te.groupby("evento"):
        t50 = g.nsmallest(50, "rango_elo")
        riga = dict(ev=ev, elo=rho(g.rango, g.rango_elo),
                    elo50=rho(t50.rango, t50.rango_elo))
        for nome, cols in MODELLI.items():
            c = coef[nome]
            def prev(h):
                return h.perc_elo.values - (np.c_[h[cols].values, np.ones(len(h))] @ c)
            riga[nome] = rho(g.rango, prev(g))
            riga[nome + "50"] = rho(t50.rango, prev(t50))
        righe.append(riga)

R = pd.DataFrame(righe)
print(f"\n  {'modello':<18} {'Spearman':>10} {'guadagno':>10}   "
      f"{'primi 50':>10} {'guadagno':>10}  {'vince'}")
print("  " + "-" * 70)
print(f"  {'Elo (riferimento)':<18} {R.elo.mean():>10.3f} {'—':>10}   "
      f"{R.elo50.mean():>10.3f} {'—':>10}")
for nome in MODELLI:
    v = (R[nome + "50"] > R.elo50).sum()
    print(f"  {nome:<18} {R[nome].mean():>10.3f} {(R[nome]-R.elo).mean():>+10.3f}   "
          f"{R[nome+'50'].mean():>10.3f} {(R[nome+'50']-R.elo50).mean():>+10.3f}  "
          f"{v}/{len(R)} sui primi 50")

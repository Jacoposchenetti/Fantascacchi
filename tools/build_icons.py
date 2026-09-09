#!/usr/bin/env python3
"""
Genera le icone della PWA in data/icons/.

iOS non accetta SVG per l'icona della schermata home: servono PNG veri, in
piu' misure. Qui si disegnano dal codice cosi' restano riproducibili e
coerenti con la palette dell'app, invece di essere file opachi nel repo.

Uso:  python tools/build_icons.py
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "data" / "icons"

FONDO = (18, 16, 14)        # --bg dell'app
ORO = (224, 168, 58)        # --gold
GLIFO = "\u265E"            # cavallo nero
FONT = r"C:\Windows\Fonts\seguisym.ttf"

# "any": icona normale, con margine.
# "maskable": Android la ritaglia in cerchio, quindi il glifo deve stare
# nel 40% centrale del quadrato o rischia di essere tagliato.
MISURE = [192, 256, 384, 512]


def disegna(px, maskable=False, trasparente=False):
    img = Image.new("RGBA", (px, px),
                    (0, 0, 0, 0) if trasparente else FONDO + (255,))
    d = ImageDraw.Draw(img)

    if not trasparente and not maskable:
        # Angoli smussati: su iOS la maschera ci pensa da sola, ma altrove
        # un quadrato netto stona con le altre icone.
        raggio = int(px * 0.22)
        sfondo = Image.new("RGBA", (px, px), (0, 0, 0, 0))
        ImageDraw.Draw(sfondo).rounded_rectangle(
            [0, 0, px - 1, px - 1], radius=raggio, fill=FONDO + (255,))
        img = sfondo
        d = ImageDraw.Draw(img)

    quota = 0.46 if maskable else 0.62
    dim = int(px * quota)
    try:
        font = ImageFont.truetype(FONT, dim)
    except OSError:
        font = ImageFont.load_default()

    box = d.textbbox((0, 0), GLIFO, font=font)
    x = (px - (box[2] - box[0])) / 2 - box[0]
    y = (px - (box[3] - box[1])) / 2 - box[1]
    d.text((x, y), GLIFO, font=font, fill=ORO + (255,))
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    fatti = []

    for px in MISURE:
        f = OUT / f"icona-{px}.png"
        disegna(px).save(f, "PNG", optimize=True)
        fatti.append(f)

    for px in (192, 512):
        f = OUT / f"icona-maskable-{px}.png"
        disegna(px, maskable=True).save(f, "PNG", optimize=True)
        fatti.append(f)

    # iOS usa questa per la schermata home: niente trasparenza, angoli suoi.
    f = OUT / "apple-touch-icon.png"
    apple = Image.new("RGB", (180, 180), FONDO)
    apple.paste(disegna(180).convert("RGB"), (0, 0))
    apple.save(f, "PNG", optimize=True)
    fatti.append(f)

    for f in fatti:
        print(f"  {f.name:<28} {f.stat().st_size // 1024} KB")
    print(f"\n{len(fatti)} icone in {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

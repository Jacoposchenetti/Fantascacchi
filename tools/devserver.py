#!/usr/bin/env python3
"""
Server statico per lo sviluppo.

Uguale a `python -m http.server`, ma manda Cache-Control: no-store.
Senza quello il browser tiene in cache i moduli ES e continua a eseguire
la versione vecchia del codice dopo ogni modifica.

Uso:  python tools/devserver.py [porta]
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "200" not in (args[1] if len(args) > 1 else ""):
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
    handler = partial(NoCacheHandler, directory=str(ROOT))
    print(f"Fantascacchi su http://localhost:{port}  (no-cache, root={ROOT})", flush=True)
    # Deve essere threaded: con un server monothread le connessioni
    # keep-alive del browser bloccano tutte le altre richieste.
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()


if __name__ == "__main__":
    main()

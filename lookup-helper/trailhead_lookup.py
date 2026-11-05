"""
Trailhead lookup helper.

The web app can't search for somebody. A page may only read a reply from a
site that allows it, and search engines don't — which is why the desktop
build ran this search through Python instead.

This is that same search, as a small program on your own computer. The web
app calls it at 127.0.0.1, it runs the search, and it hands the results
back. The search goes out from your own connection, exactly as the desktop
app's did, which is what makes it work: search engines are far harsher on a
datacentre address than on somebody's home or office one.

Nothing is stored, nothing is logged, and it only accepts connections from
this computer. What it receives is the search text — a student's name, and
any extra words typed into the box — and only when somebody presses
"Look up".

    pip install ddgs
    python trailhead_lookup.py

Then put http://127.0.0.1:8765 into the app under Settings. With nothing
there, the app simply offers to open the search in a tab instead.
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

try:
    from ddgs import DDGS
except ImportError:  # pragma: no cover - the one thing to install
    sys.exit('The ddgs package is missing. Run:  pip install ddgs')

DEFAULT_PORT = 8765
MAX_RESULTS = 5

# The app paces itself too, but a stuck page mustn't be able to hammer a
# search engine from here.
MIN_SECONDS_BETWEEN_SEARCHES = 4.0

# Which pages may call this. The deployed app and the dev server; anything
# else gets no CORS header and so can't read the reply.
ALLOWED_ORIGINS = {
    'https://taulab-tech.github.io',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
}

_lock = threading.Lock()
_last_search_at = 0.0


def search(query: str) -> list[dict[str, str]]:
    """One search, spaced out from the last one."""
    global _last_search_at
    with _lock:
        wait = _last_search_at + MIN_SECONDS_BETWEEN_SEARCHES - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        try:
            results = DDGS().text(query, max_results=MAX_RESULTS) or []
        finally:
            _last_search_at = time.monotonic()

    return [
        {
            'title': r.get('title', '') or '',
            'body': r.get('body', '') or '',
            'href': r.get('href', '') or '',
        }
        for r in results
    ]


class Handler(BaseHTTPRequestHandler):
    # Quiet: this runs in a window somebody is working next to, and every
    # line it prints would carry a student's name.
    def log_message(self, fmt: str, *args: object) -> None:
        return

    def _send(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Vary', 'Origin')
        origin = self.headers.get('Origin')
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
            self.send_header('Access-Control-Max-Age', '86400')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802 - name fixed by the base class
        self._send(204, {})

    def do_GET(self) -> None:  # noqa: N802 - name fixed by the base class
        url = urlparse(self.path)

        # So the app can tell whether the helper is running before it
        # offers to search.
        if url.path.rstrip('/') in ('', '/health'):
            self._send(200, {'ok': True, 'service': 'trailhead-lookup'})
            return

        if url.path.rstrip('/') != '/search':
            self._send(404, {'error': 'Not found.'})
            return

        query = (parse_qs(url.query).get('q') or [''])[0].strip()
        if not query:
            self._send(400, {'error': 'Nothing to search for.'})
            return
        if len(query) > 200:
            self._send(400, {'error': 'That search is too long.'})
            return

        try:
            self._send(200, {'results': search(query)})
        except Exception as err:  # noqa: BLE001 - whatever went wrong, say so plainly
            message = str(err)
            if 'no results' in message.lower():
                # ddgs raises rather than returning an empty list, and the
                # search engine does this intermittently under load.
                self._send(200, {'results': []})
            else:
                self._send(502, {'error': f'The search didn’t work ({message[:200]}).'})


def main() -> None:
    parser = argparse.ArgumentParser(description='Local search helper for the Trailhead web app.')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT)
    args = parser.parse_args()

    # 127.0.0.1, not 0.0.0.0: nothing outside this computer can reach it.
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Trailhead lookup helper listening on http://127.0.0.1:{args.port}')
    print('Put that address into the app under Settings. Press Ctrl+C to stop.')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
    finally:
        server.server_close()


if __name__ == '__main__':
    main()

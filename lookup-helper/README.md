# Trailhead lookup helper

Lets the web app look a student up on LinkedIn.

A web page can't search for somebody. A page may only read a reply from a site that allows it,
and search engines don't — which is why the desktop build ran this through Python instead.
This is that same search, as a small program on your own computer: the app asks it, it runs
the search, it hands back the results.

That it runs on your machine is the point, not a workaround. The search goes out from your own
connection, exactly as the desktop app's did. Search engines are far harsher on a datacentre
address than on a home or office one, so a hosted version of this gets a CAPTCHA within a few
searches and then keeps getting one.

**What it sees:** the search text — a student's name, and any extra words typed into the box —
and only when somebody presses *Look up*. Never the database, an email, or a grade. Nothing is
stored, nothing is logged, and it only accepts connections from this computer.

## Running it

```bash
pip install ddgs
python trailhead_lookup.py
```

Then open the app → **Settings → Looking people up** → put in `http://127.0.0.1:8765` and press
**Check it's running**.

Leave that setting empty and the app offers to open the search in a new tab for you to read
yourself. Everything else works either way.

## Notes

- It listens on `127.0.0.1` only. Nothing outside this computer can reach it.
- Searches are spaced four seconds apart, as the desktop app's were.
- The search engine refuses a request now and then; the app retries and reports it. That is
  the same behaviour the desktop version always had.
- `--port 9000` if 8765 is taken. Put the matching address in Settings.

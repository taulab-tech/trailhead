# trailhead-lookup

The search half of the LinkedIn lookup for the web app, as a Cloudflare Worker.

A browser tab can't call a search engine — the engine would have to send it an
`Access-Control-Allow-Origin` header, and none do. The desktop build gets around that by
running a bundled Python; a page can't start a process. This is the smallest thing that
closes the gap.

**What it sees:** a search query — a student's name and any extra words typed into the box —
and only when somebody presses *Look up*. Never the database, an email, or a grade. It keeps
no record: no logging, no storage.

## Running it

```bash
cd worker
npm install
npm run dev     # http://localhost:8787
```

Try it:

```bash
curl -H "Origin: http://localhost:5174" "http://localhost:8787/?q=%22Ada+Lovelace%22+site:linkedin.com/in"
```

## Deploying

```bash
npx wrangler login     # opens a browser, once
npm run deploy
```

Then paste the URL it prints into the app under **Settings → Looking people up**. Until a URL
is set there, the web app has no lookup at all and nothing is sent anywhere.

Edit `ALLOWED_ORIGINS` in `wrangler.toml` if the app moves to another domain.

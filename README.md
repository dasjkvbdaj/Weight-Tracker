# My Weight Tracker

A tiny personal weight tracker. Type your weight, tap **Save Weight**, and the app records today's date, the day of the week and the exact time automatically. Pure HTML, CSS and vanilla JavaScript: no build step, no backend, no dependencies.

## Files

- `index.html` – page structure and entry point
- `style.css` – responsive, mobile-first styles (light theme by default, optional dark mode)
- `script.js` – all application logic
- `favicon.svg` – site icon

## Run locally

Open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000
```

then visit http://localhost:8000.

## Deploy to Vercel

No build command, no environment variables.

1. Push this folder to a Git repository (or use the Vercel CLI).
2. In Vercel choose **Add New → Project**, import the repo.
3. Framework preset: **Other**. Leave Build Command and Output Directory empty. Deploy.

With the CLI: run `vercel` inside this folder and accept the defaults.

## How storage works

Records are saved in your browser's `localStorage` under the key `weightTracker.v1`. Each record has a unique ID, the weight in kg, the original ISO timestamp, the local date (`YYYY-MM-DD`) and the weekday. Saved dates are never recalculated. On every page load the app reads the saved records and rebuilds all summaries; it never writes an empty list over existing data. If saved data is unreadable, a safety copy is kept and a message is shown.

## Backups

- **Export Backup** downloads `my-weight-tracker-backup.json` with every record.
- **Import Backup** validates the file, then lets you **Merge** (adds only records whose IDs are not already present) or **Replace all**. Nothing changes until you choose. Everything happens locally in your browser.

Export a backup regularly, and before clearing browser data.

## Limitations

- Data is tied to one browser, one device and one site address. It does not sync between devices, and a different URL (for example a new Vercel domain) starts empty. Use Export/Import to move data.
- Clearing site data, using private browsing or uninstalling the browser can delete records.
- This is a client-side app with no login. Anyone who can open the site URL can open the interface; your records stay in your own browser's storage and are not uploaded anywhere.

## Offline support

A service worker (`sw.js`) caches the app files on first visit, so the site loads and works with no connection. Updates download in the background and appear on the next load. **When you change any app file, bump `VERSION` in `sw.js`.** The site can also be installed to the home screen (`manifest.webmanifest`). `vercel.json` stops the CDN from caching `sw.js` so updates are detected.

# Training Dashboard

A free, static page that turns your [intervals.icu](https://intervals.icu) data into a plain-language training picture for **running** and **paddling**, and exports it as a report to paste into Claude for coaching.

- One sport at a time, a summary paragraph, and four weekly charts: load, distance/time, time in zones, and fitness/fatigue/form.
- **Copy report** puts Markdown with a coaching prompt on your clipboard. **Download report** saves the same Markdown as a `.md` file, and **Download data** saves the weekly rollups and activity list as `.json`.
- No accounts and no server. Your intervals.icu API key stays in your browser and is sent only to intervals.icu.

Try it without an account: open the page with `?demo` on the end of the address.

## Setup (for users)

1. In intervals.icu, open **Settings → Developer Settings**. Copy your **Athlete ID** (like `i12345`) and **API Key** (generate one if there isn't one).
2. Open the dashboard and paste both in.
3. Make sure intervals.icu has your **heart-rate zones** for each sport, and a **threshold pace** for running. Without them the zone chart stays empty, and the page says why.

Activities that reach intervals.icu only through Strava can't be read through its API. Connect your watch (Garmin, Coros, Suunto, Polar…) to intervals.icu directly.

## Run your own copy

Fork the repo, then turn on **Settings → Pages → Deploy from branch → `main` / root**. There is no build step.

To run it locally, serve the folder with any static server (ES modules don't load from `file://`):

```bash
npx serve .
```

## How it works

| File | Role |
| --- | --- |
| `index.html`, `css/styles.css` | The page. Mobile stacks everything, with the summary first. Desktop puts the charts in a 2×2 grid. |
| `js/config.js` | What a fork would change: activity types per sport, presets, the coaching prompt, the API base URL. |
| `js/api.js` | Calls to intervals.icu (Basic auth, username `API_KEY`). |
| `js/store.js` | localStorage for credentials, preferences and a stripped-down cache, with a daily refresh. |
| `js/data.js` | Weekly rollups, the previous-period comparison, per-sport fitness/fatigue/form, and zone settings. |
| `js/text.js` | The plain-language sentences shared by the page and the report. |
| `js/charts.js` | The four Chart.js charts. |
| `js/report.js` | Markdown and JSON export, plus Blob downloads and copying to the clipboard. |
| `js/demo.js` | Synthetic data for `?demo`. |
| `spike.html` | Day-one diagnostic. It calls the API from the browser and shows the raw JSON and which fields are present. |

**Data used.** Each activity's `icu_training_load`, `icu_hr_zone_times`, `pace_zone_times`, `distance` and `moving_time`. Zones come from the athlete's `sportSettings`, planned workouts from calendar events (`category=WORKOUT`), and all-sports fitness from wellness `ctl`/`atl`.

**Fitness, fatigue and form per sport.** intervals.icu stores fitness and fatigue for all sports combined. To keep the sports separate, this page calculates them for the selected sport from intervals.icu's own load on each session, with the standard 42-day and 7-day weighted averages. It fetches 150 days of extra history so the lines have settled. The report also gives the all-sports values as intervals.icu reports them.

**Weeks and days.** Bars are 7-day blocks counted back from the last day of the range, so "last 4 weeks" always ends today. Ranges of 14 days or less (including the 1-week tab) switch to daily bars, compared with the same day in the period before. The previous period is always the same length, immediately before.

**Sports.** Running is `Run`, `TrailRun` and `VirtualRun`. Paddling is `Canoeing`, `Kayaking`, `StandUpPaddling` and `Rowing`. Change these in `js/config.js`. Other activity types are listed as "not shown" rather than mixed in.

## If the browser can't reach the API (CORS)

Open `spike.html` first. If requests fail before any response arrives, the browser is blocking cross-origin calls. In that case, deploy a Cloudflare Worker (free tier) that forwards `/api/v1/*` to `https://intervals.icu/api/v1/*`, passing through the `Authorization` header and adding `Access-Control-Allow-Origin` for your Pages domain. Then point `API_BASE` in `js/config.js` at the Worker.

# Training Dashboard

A free, static page that turns your [intervals.icu](https://intervals.icu) data into a plain-language training picture for **running**, **paddling**, **biking** and **strength**, and exports it as a report to paste into Claude for coaching.

- **All sports** together, or one sport at a time: a summary paragraph and four weekly charts (load, distance/time, time in zones, and fitness/fatigue/form).
- A **Plan** view for the workouts you intend to do across every sport: what they do to your fitness, a build/maintain/recover call for each week, a race countdown, and a monthly calendar to print.
- **Copy report** puts Markdown with a coaching prompt on your clipboard. **Download report** saves the same Markdown as a `.md` file, and **Download data** saves the weekly rollups and activity list as `.json`.
- No accounts and no server. Your intervals.icu API key stays in your browser and is sent only to intervals.icu.

Try it without an account: open the page with `?demo` on the end of the address.

## Setup (for users)

1. In intervals.icu, open **Settings → Developer Settings**. Copy your **Athlete ID** (like `i12345`) and **API Key** (generate one if there isn't one).
2. Open the dashboard and paste both in.
3. Make sure intervals.icu has your **heart-rate zones** for each sport, and a **threshold pace** for running. Without them the zone chart stays empty, and the page says why.

**Just planning?** Tap **Plan without intervals.icu** on the first screen instead. You get the Plan view and the printed calendar with no key: workouts, rest days, races, phases, export and share links all work, and workouts show their time. Load estimates, fitness, the weekly build/recover call and the report need intervals.icu, because they come from your heart-rate settings and history. To add them later, enter your Athlete ID and API key in **Settings**; the plan stays as it is.

Activities that reach intervals.icu only through Strava can't be read through its API. Connect your watch (Garmin, Coros, Suunto, Polar…) to intervals.icu directly.

**Indoor bikes such as Peloton** usually send rides to Strava, so they can't be read. Record the ride on your watch as well (an indoor cycling activity); it reaches intervals.icu with heart rate, and the page treats it like any other ride. The watch doesn't record the bike's power, so biking load and targets use heart rate.

## Sports, All sports and form

The page opens on **All sports**. The other tabs are the sports you've done or planned; someone who only rides sees All and Biking.

- **All sports** answers "how much am I training, and how tired am I?": time and load stacked by sport, time in zones across sports (each session in its own sport's zones), and intervals.icu's own all-sports fitness, fatigue and form.
- **A sport's tab** answers "how is this sport going?": its own distance, zones, and fitness, fatigue and form from its sessions alone.
- **Form is shared.** A hard paddle tires you for tomorrow's run, so the "form today" gauge, the forecast's form and the high-fatigue warning use all sports on every tab. Fitness, planned load and the weekly build/recover call stay per sport, since paddling does little for running legs.
- **Strength** has no tab. Its sessions count in All sports, in the plan and calendar, and in form.

## Planning

Switch to **Plan** under the sport tabs. It lists your races, then this week and next (later weeks fold to one line until you open them), with every sport's workouts; a sport's tab lists its own first and adds its build/recover call to each week. Add a workout with **Add workout** or a day's **+**: pick the sport, then continuous or intervals (reps × work, with easy recoveries, warm-up and cool-down), with one target: a heart-rate zone, a heart rate or (running only) a pace. Strength is planned by duration alone. The title is optional. Tap **Rest** on an empty day to make it a rest day. Mark key sessions to highlight them on the calendar. **Copy last week** adds the previous week's workouts and rest days to the next one. Deleting, copying and importing can be undone from the message that follows.

Each week can have a phase (base, build, peak, taper, recovery). In a sport's tab the phase is checked against the load: one word when they agree, a sentence when they don't ("Planned as recovery, but load is up 12% on your 4-week average").

- **Where plans live.** In this browser only (localStorage), and nowhere else. intervals.icu stays read-only: the page never writes to it, and its own calendar isn't read. "Forget key and data" in Settings leaves the plan alone; **More → Delete plan** removes it.
- **Keeping a copy.** Clearing the browser's site data deletes the plan, so use **More → Export plan** now and then. It saves a `.json` file that **Import plan** reads back. **Copy share link** puts the whole plan in a link, for another device or a friend. Opening it asks before replacing the plan that's there.
- **Planned load** is estimated from each workout's time and target effort, using the threshold heart rate and threshold pace in your intervals.icu sport settings, then scaled to match intervals.icu's own load for your last 90 days of sessions. Strength uses your own average load per hour. The plan view says how each sport is scaled. Treat it as roughly right, and more roughly for paddling, where load comes from heart rate.
- **The forecast** carries fitness, fatigue and form forward through the planned loads (dashed on the fitness chart). In a sport's tab each week is called **build**, **maintain** or **recover** against your average of the last four completed weeks, with a warning for big jumps; every tab warns when form across all sports would drop below −30.
- **Races** are A or B. The countdown runs to your next A race; the forecast reaches to it when it's within eight weeks.

**Printing the calendar.** Tap **Print** in the Plan view, pick All sports or one sport, the month and how many months, then **Print or save as PDF**. In the print dialog choose Letter, Landscape, and turn off headers and footers. On iPhone and iPad use Share → Print. Each month prints on one page: workouts with checkboxes (tagged R, P, B or S in All sports), rest days, days to the race, weekly totals, and for days already past, a tick with what you actually did.

**Week start.** Monday or Sunday, in **Settings**. It sets the 1-week tab, the plan's weeks and the calendar.

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
| `calendar.html`, `css/print.css` | The printable monthly calendar, one letter-landscape page per month. |
| `js/config.js` | What a fork would change: the sports and their activity types, presets, the coaching prompt, the API base URL. |
| `js/api.js` | Calls to intervals.icu (Basic auth, username `API_KEY`). |
| `js/store.js` | localStorage for credentials, preferences, a stripped-down cache with a daily refresh, and the plan. Plan-only mode stands in an empty set of training. |
| `js/data.js` | Weekly rollups for one sport or all of them, the previous-period comparison, fitness/fatigue/form, zone settings, and the plan's weeks and forecast. |
| `js/plan.js` | Planned-load estimates, calibration, the forecast, weekly verdicts, race countdowns, and the plan's file and share-link formats. |
| `js/text.js` | The plain-language sentences shared by the page and the report. |
| `js/charts.js` | The four Chart.js charts, with planned load hatched and the forecast dashed. |
| `js/report.js` | Markdown and JSON export, plus Blob downloads and copying to the clipboard. |
| `js/planner.js` | The Plan view: the week list and the workout and race editors. |
| `js/ui.js`, `js/icons.js` | Small shared helpers (notices, the toast with Undo) and the sport icons. |
| `js/calendar.js` | Builds the calendar pages from the same data and plan. |
| `js/demo.js` | Synthetic data and a sample plan for `?demo`. |
| `spike.html` | Day-one diagnostic. It calls the API from the browser and shows the raw JSON and which fields are present. |

**Data used.** Each activity's `icu_training_load`, `icu_hr_zone_times`, `pace_zone_times`, `distance` and `moving_time`. Zones, threshold heart rate and threshold pace come from the athlete's `sportSettings`, and all-sports fitness from wellness `ctl`/`atl`. Planned workouts come from the plan in this browser, not from intervals.icu.

**Fitness, fatigue and form.** intervals.icu stores fitness and fatigue for all sports combined, and All sports shows those values as it reports them. A sport's tab calculates its own from intervals.icu's load on each of that sport's sessions, with the standard 42-day and 7-day weighted averages. It fetches 150 days of extra history so the lines have settled.

**Weeks and days.** Bars are 7-day blocks counted back from the last day of the range, so "last 4 weeks" always ends today. The 1-week tab is the calendar week so far (starting Monday or Sunday, your choice), charted by day and compared with the same weekdays of last week. Other ranges of 14 days or less also switch to daily bars. The previous period is always the same length, immediately before.

**Sports.** Running is `Run`, `TrailRun` and `VirtualRun`. Paddling is `Canoeing`, `Kayaking`, `StandUpPaddling` and `Rowing`. Biking is `Ride`, `VirtualRide`, `GravelRide`, `MountainBikeRide` and `EBikeRide`. Strength is `WeightTraining`. Activity types no sport lists still count in All sports. To add a sport, add an entry to `SPORTS` in `js/config.js` (and an icon in `js/icons.js` and a `--sport-…` colour in `css/styles.css` if you like); `tracked: false` keeps it off the tabs, and `targets: false` plans it by duration alone.

## If the browser can't reach the API (CORS)

Open `spike.html` first. If requests fail before any response arrives, the browser is blocking cross-origin calls. In that case, deploy a Cloudflare Worker (free tier) that forwards `/api/v1/*` to `https://intervals.icu/api/v1/*`, passing through the `Authorization` header and adding `Access-Control-Allow-Origin` for your Pages domain. Then point `API_BASE` in `js/config.js` at the Worker.

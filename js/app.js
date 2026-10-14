// Page wiring: controls, loading, rendering and export.

import { DEFAULT_WEEKS, SPORTS } from './config.js';
import { addDays, eachDay, longDay, rangeLabel, shortDate, startOfWeek, today, weekday } from './dates.js';
import { buildModel, fetchWindow, sportsPresent } from './data.js';
import { drawFitness, drawLoad, drawLoadLine, drawVolume, drawVolumeLine, drawZones, fitnessPoints } from './charts.js';
import {
  PHASES, decodeShare, emptyPlan, encodeShare, estimateLoad, newId, paceClock, paceUnit, parsePace, validatePlan, weeksOut,
} from './plan.js';
import { buildJson, buildMarkdown, copyText, download, fileName } from './report.js';
import {
  EXPLAIN, about, change, dataNotes, fmt, formState, periodName, planNotes, planSummary, signed, summary, zoneLabel,
} from './text.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const demo = new URLSearchParams(location.search).has('demo');

const prefs = store.getPrefs();
const state = {
  sport: prefs.sport || null, // null until we know which sport the athlete has
  weeks: prefs.weeks || DEFAULT_WEEKS, // a number, or 'custom'
  weekStart: prefs.weekStart ?? 1, // 1 Monday, 0 Sunday
  compare: prefs.compare ?? true, // off: load and volume become draggable lines
  lineUnit: prefs.lineUnit || 'week', // what the lines plot and dragging reads: 'week' or 'day'
  customFrom: prefs.customFrom || addDays(today(), -27),
  customTo: prefs.customTo || today(),
  measure: 'distance',
  zone: 'hr',
  plan: demo ? null : store.getPlan(), // demo: an in-memory sample, set in start()
  planWeeks: 5, // weeks the plan list shows, from the current one
  sharedPlan: null, // a plan from a share link, waiting for "Use this plan" or "Keep mine"
  data: null,
  model: null,
};

function currentRange() {
  if (state.weeks === 'custom') return { from: state.customFrom, to: state.customTo };
  if (state.weeks === 1) {
    // The calendar week so far; the charts still show the whole week.
    const from = startOfWeek(today(), state.weekStart);
    return { from, to: today(), chartTo: addDays(from, 6), calendar: true };
  }
  return { from: addDays(today(), -(state.weeks * 7 - 1)), to: today() };
}

function creds() {
  return demo ? { apiKey: 'demo', athleteId: 'demo' } : store.getCreds();
}

// ---------- Loading ----------

async function load({ force = false } = {}) {
  const c = creds();
  if (!c) return showOnboarding();
  showDashboard();
  if (demo) return render(store.getCache());

  const win = fetchWindow(currentRange());
  const cached = store.getCache();
  if (cached && cached.athleteId === c.athleteId) render(cached); // show something immediately

  setBusy(true);
  try {
    const data = await store.ensureData(c, win.from, win.to, { force });
    if (!state.sharedPlan) hideNotice(); // a shared-plan question stays until it's answered
    render(data);
  } catch (err) {
    showNotice(err.message, err.kind === 'auth' ? { label: 'Open settings', onClick: openSettings } : null);
    if (!cached) $('summary-text').textContent = 'No data yet.';
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  $('refresh').disabled = busy;
  $('refresh').querySelector('span').textContent = busy ? 'Loading…' : 'Refresh';
  if (busy && !state.data) $('summary-text').textContent = 'Loading your training from intervals.icu…';
}

// ---------- Rendering ----------

function render(data) {
  if (!data) return;
  state.data = data;
  const range = currentRange();

  if (!state.sport) {
    // First visit: open on whichever sport the athlete actually does.
    const counts = sportsPresent(data, { from: data.from, to: data.to });
    state.sport = Object.keys(SPORTS).sort((a, b) => counts[b] - counts[a])[0];
  }

  const m = buildModel(data, state.sport, range, state.plan, { weekStart: state.weekStart });
  state.model = m;

  syncControls();
  renderUpdated(data);
  renderSummary(m);
  renderCharts(m);
  renderPlan(m);
  $('report-preview').textContent = buildMarkdown(m, data.athlete.name);
}

function syncControls() {
  for (const b of document.querySelectorAll('[data-sport]')) b.setAttribute('aria-checked', b.dataset.sport === state.sport);
  for (const b of document.querySelectorAll('[data-weeks]')) b.setAttribute('aria-checked', String(state.weeks) === b.dataset.weeks);
  for (const b of document.querySelectorAll('[data-measure]')) b.setAttribute('aria-checked', b.dataset.measure === state.measure);
  for (const b of document.querySelectorAll('[data-zone]')) b.setAttribute('aria-checked', b.dataset.zone === state.zone);
  $('custom-range').hidden = state.weeks !== 'custom';
  $('week-start').hidden = state.weeks !== 1;
  $('compare-toggle').checked = state.compare;
  const unitShown = !state.compare && state.model?.grain !== 'day';
  $('line-unit').hidden = !unitShown;
  for (const b of document.querySelectorAll('[data-lineunit]')) b.setAttribute('aria-checked', b.dataset.lineunit === state.lineUnit);
  for (const b of document.querySelectorAll('[data-weekstart]')) b.setAttribute('aria-checked', Number(b.dataset.weekstart) === state.weekStart);
  $('custom-from').value = state.customFrom;
  $('custom-to').value = state.customTo;
  $('custom-from').max = $('custom-to').max = today();
  $('zone-toggle').hidden = !SPORTS[state.sport].hasPaceZones;
}

function renderUpdated(data) {
  const d = new Date(data.fetchedAt);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = data.fetchedOn === today();
  $('updated').textContent = demo
    ? 'Demo data'
    : `Updated ${sameDay ? 'today' : d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

function renderSummary(m) {
  $('summary-title').textContent = `${m.sport.label} · ${rangeLabel(m.range.from, m.range.to)}`;
  const { lead, lines } = summary(m);
  $('summary-text').textContent = lead;
  $('summary-lines').innerHTML = lines
    .map(({ label, text }) => `<div><dt>${label}</dt><dd>${emphasis(text)}</dd></div>`)
    .join('');
  // Notes about the plan's estimates sit with the plan, further down.
  $('notes').replaceChildren(...dataNotes(m, { plan: false }).map((n) => Object.assign(document.createElement('li'), { textContent: n })));
  renderTiles(m);
  renderGauge(m);
}

// Headline numbers, each against the previous period. Deltas stay neutral in colour:
// more training isn't automatically better.
function renderTiles(m) {
  const t = m.totals;
  const p = m.prevTotals;
  const delta = (cur, prev) => {
    const c = change(cur, prev);
    if (!c) return 'nothing to compare';
    if (c === 'level') return 'level with before';
    const [dir, pct] = c.split(' ');
    return `<span class="arrow">${dir === 'up' ? '▲' : '▼'}</span>${pct} vs before`;
  };
  const tiles = [
    [m.sport.noun[1][0].toUpperCase() + m.sport.noun[1].slice(1), fmt(t.sessions), '', delta(t.sessions, p.sessions)],
    ['Distance', fmt(t.distanceKm), 'km', delta(t.distanceKm, p.distanceKm)],
    [`${m.sport.label} time`, fmt(t.hours, 1), 'h', delta(t.hours, p.hours)],
    ['All sports time', fmt(t.allHours, 1), 'h', delta(t.allHours, p.allHours)],
    ['Load', fmt(t.load), '', delta(t.load, p.load)],
  ];
  if (t.easyShare != null) {
    const pts = p.easyShare != null ? Math.round((t.easyShare - p.easyShare) * 100) : null;
    tiles.push([
      'Easy time (Z1–Z2)',
      fmt(t.easyShare * 100),
      '%',
      pts == null ? 'nothing to compare' : pts === 0 ? 'level with before' : `<span class="arrow">${pts > 0 ? '▲' : '▼'}</span>${Math.abs(pts)} pts vs before`,
    ]);
  }
  // Only numbers and fixed labels go into this markup.
  $('tiles').innerHTML = tiles
    .map(([label, value, unit, d]) => `
      <div class="tile">
        <div class="tile-label">${label}</div>
        <div class="tile-value">${value}${unit ? `<small>${unit}</small>` : ''}</div>
        <div class="tile-delta">${d}</div>
      </div>`)
    .join('');
}

// Where today's form sits, on intervals.icu's bands.
const FORM_BANDS = [
  { from: -45, to: -30, name: 'High fatigue', color: '--state-risk' },
  { from: -30, to: -10, name: 'Productive', color: '--state-productive' },
  { from: -10, to: 5, name: 'Neutral', color: '--state-neutral' },
  { from: 5, to: 25, name: 'Fresh', color: '--state-fresh' },
  { from: 25, to: 40, name: 'Very fresh', color: '--state-transition' },
];

function renderGauge(m) {
  const last = m.fitness[m.fitness.length - 1];
  $('form-gauge').hidden = !last || !m.totals.sessions;
  if (!last) return;
  const min = FORM_BANDS[0].from;
  const max = FORM_BANDS[FORM_BANDS.length - 1].to;
  const pos = (v) => ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100;

  $('gauge-track').style.background = `linear-gradient(to right, ${FORM_BANDS.map(
    (b) => `color-mix(in oklab, var(${b.color}) 45%, var(--surface)) ${pos(b.from)}% ${pos(b.to)}%`,
  ).join(', ')})`;
  $('gauge-marker').style.left = `${pos(last.form)}%`;
  $('gauge-value').innerHTML = `${signed(last.form)} <span class="state">· ${formState(last.form)}</span>`;
  $('gauge-scale').innerHTML = [
    ...FORM_BANDS.map((b) => `<span class="band-name" style="left:${pos((b.from + b.to) / 2)}%">${b.name}</span>`),
    ...FORM_BANDS.slice(1).map((b) => `<span class="tick" style="left:${pos(b.from)}%">${signed(b.from)}</span>`),
  ].join('');
  $('form-gauge').title = EXPLAIN.form;
}

// One line under each chart title that says what the chart shows.
function renderTakeaways(m) {
  const t = m.totals;
  const weeks = m.range.days / 7;
  const sport = m.sport.label.toLowerCase();
  const span = m.range.calendar
    ? periodName(m.range).toLowerCase()
    : `over ${m.range.days % 7 === 0 && weeks > 1 ? `${weeks} weeks` : `${m.range.days} days`}`;
  // With comparison off the headlines drop the change against the period before.
  const vs = (cur, prev) => (state.compare ? change(cur, prev) : null);
  const c = vs(t.load, m.prevTotals.load);
  if (m.grain === 'day') {
    // A short range is about its total against the period before; the bars give the days.
    const cd = vs(t.distanceKm, m.prevTotals.distanceKm);
    const ch = vs(t.allHours, m.prevTotals.allHours);
    $('take-load').innerHTML = t.sessions ? `<strong>${fmt(t.load)}</strong> ${span}${c ? ` (${c})` : ''}` : '';
    $('take-volume').innerHTML = !t.sessions
      ? ''
      : state.measure === 'distance'
        ? `<strong>${fmt(t.distanceKm, 1)} km</strong> ${span}${cd ? ` (${cd})` : ''}`
        : `<strong>${fmt(t.allHours, 1)} h</strong> all sports ${span}${ch ? ` (${ch})` : ''} · ${fmt(t.hours, 1)} h of it ${sport}`;
  } else {
    // The charts are per week, so lead with the weekly average and label the total.
    $('take-load').innerHTML = t.sessions
      ? `<strong>${fmt(t.load / weeks)}</strong> a week on average · ${fmt(t.load)} ${span}${c ? ` (${c})` : ''}`
      : '';
    $('take-volume').innerHTML = !t.sessions
      ? ''
      : state.measure === 'distance'
        ? `<strong>${fmt(t.distanceKm / weeks)} km</strong> a week on average · ${fmt(t.distanceKm)} km ${span}`
        : `<strong>${fmt(t.allHours / weeks, 1)} h</strong> a week on average, all sports · ${fmt(t.hours / weeks, 1)} h of it ${sport}`;
  }
  if (!state.compare && t.sessions) {
    $('take-load').innerHTML += ` · drag along the line for any ${lineUnit(m)}`;
  }
  const pace = m.sport.hasPaceZones && state.zone === 'pace';
  const secs = pace ? t.paceSecs : t.hrSecs;
  const total = pace ? t.paceTotalSecs : t.hrTotalSecs;
  $('take-zones').innerHTML = total
    ? `<strong>${fmt((((secs[0] || 0) + (secs[1] || 0)) / total) * 100)}%</strong> of time easy (Z1–Z2) ${span}`
    : '';
  const last = m.fitness[m.fitness.length - 1];
  $('take-fitness').innerHTML = last
    ? `Today: Fitness <strong>${fmt(last.fitness)}</strong> · Fatigue <strong>${fmt(last.fatigue)}</strong> · Form <strong>${signed(last.form)}</strong>` +
      (m.forecastShown.length ? ' · dashed: if you follow the plan' : '')
    : '';
}

function legend(el, items) {
  el.replaceChildren(
    ...items.map(({ label, color, line, hatch, tip }) => {
      const item = document.createElement(tip ? 'button' : 'span');
      item.className = 'legend-item';
      if (tip) {
        item.type = 'button';
        item.dataset.tip = tip;
      }
      const sw = document.createElement('span');
      sw.className = 'swatch' + (line ? ' line' : '') + (hatch ? ' hatch' : '');
      if (!hatch) sw.style.background = color;
      item.append(sw, label);
      return item;
    }),
  );
}

// Summary text can include zone names from the user's intervals.icu settings, so
// escape it before turning **emphasis** into bold.
const emphasis = (text) =>
  text
    .replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// With comparison off, the lines plot weeks or days (the "By week / By day" choice).
// Ranges already charted by day only have days.
const lineUnit = (m) => (m.grain === 'day' ? 'day' : state.lineUnit);
const lineList = (m) => (lineUnit(m) === 'day' && m.grain !== 'day' ? m.days : m.weeks);
// The load line continues into the plan: weeks (or days) after a range that ends today.
const loadLineList = (m) => [
  ...lineList(m),
  ...(m.grain === 'day' ? [] : lineUnit(m) === 'day' ? m.plannedDays : m.plannedWeeks).map((w) => ({ ...w, future: true })),
];
const plannedLegend = { label: 'Planned', hatch: true, tip: EXPLAIN.plannedLoad };

function renderCharts(m) {
  if (!window.Chart) return; // Chart.js still loading; render() runs again once it has

  renderTakeaways(m);

  // With comparison off, load and volume become lines (same points as the bars) you can drag along.
  const lines = !state.compare;
  const per = (lines ? lineUnit(m) : m.grain) === 'day' ? 'per day' : 'per week';
  $('load-title').textContent = `Training load ${per}`;
  $('zones-title').textContent = `Time in zones ${m.grain === 'day' ? 'per day' : 'per week'}`;
  $('volume-title').textContent = state.measure === 'distance' ? `Distance ${per}` : `Training time ${per}`;
  $('info-load').dataset.tip = EXPLAIN.load;

  if (lines) {
    const planned = drawLoadLine(m, loadLineList(m), (i) => scrubLoad(m, i));
    legend($('legend-load'), planned ? [{ label: 'Load', color: cssVar('--series-1'), line: true }, plannedLegend] : []);
    legend($('legend-volume'), drawVolumeLine(m, lineList(m), state.measure, (i) => scrubVolume(m, i)));
  } else {
    const daily = m.grain === 'day';
    const planned = drawLoad(m);
    legend($('legend-load'), [
      { label: m.range.calendar ? 'This week' : 'This period', color: cssVar('--series-1') },
      { label: daily ? (m.range.calendar ? 'Last week' : m.range.days === 7 ? 'Same day, week before' : 'Same day, period before') : 'Previous period, same week', color: cssVar('--series-prev') },
      ...(planned ? [plannedLegend] : []),
    ]);
    legend($('legend-volume'), drawVolume(m, state.measure));
  }

  renderZones(m);

  const series = drawFitness(m, lines ? (i) => scrubFitness(m, i) : null);
  legend($('legend-fitness'), series.map((s) => ({ label: s.label, color: s.color, line: true, tip: s.explain })));

  $('footnote').textContent = !lines && m.weeks.some((w) => w.partial)
    ? `* The first bar covers ${m.weeks[0].days} days; weeks are counted back from ${shortDate(m.range.to)}.`
    : '';
}

// ---------- Drag readouts (comparison off) ----------
// Each puts the dragged-to day's value where the chart's headline sits, and
// restores the period figure when the finger lifts or the pointer leaves.

// The point being dragged: "in the week of Sep 20" or "on Mon Oct 5".
function pointName(m, w) {
  if (w.days === 1) return `on ${longDay(w.from)}`;
  return `in the week of ${shortDate(w.from)}${w.partial ? ` (${w.days} days)` : ''}`;
}

function scrubLoad(m, i) {
  const w = i == null ? null : loadLineList(m)[i];
  if (!w) return renderTakeaways(m);
  const name = w.label ? `${w.label} (${shortDate(w.from)})` : longDay(w.from);
  const sessions = (n) => `${n} ${m.sport.noun[n === 1 ? 0 : 1]}`;
  $('take-load').innerHTML = w.future
    ? w.plannedLoad
      ? `${name}: planned about <strong>${about(w.plannedLoad)}</strong>${w.plannedSessions ? ` · ${sessions(w.plannedSessions)}` : ''}`
      : `${name}: ${w.label ? 'nothing planned' : 'still to come'}`
    : `<strong>${fmt(w.load)}</strong> ${pointName(m, w)} · ${w.sessions ? sessions(w.sessions) : `no ${m.sport.noun[1]}`}`;
}

function scrubVolume(m, i) {
  const w = i == null ? null : lineList(m)[i];
  if (!w) return renderTakeaways(m);
  $('take-volume').innerHTML = w.future
    ? `${longDay(w.from)}: still to come`
    : state.measure === 'distance'
      ? `<strong>${fmt(w.distanceKm, 1)} km</strong> ${pointName(m, w)}`
      : `<strong>${fmt(w.allHours, 1)} h</strong> all sports ${pointName(m, w)} · ${fmt(w.hours, 1)} h ${m.sport.label.toLowerCase()}`;
}

function scrubFitness(m, i) {
  const p = i == null ? null : fitnessPoints(m)[i];
  if (!p) return renderTakeaways(m);
  $('take-fitness').innerHTML =
    `${longDay(p.date)}${p.forecast ? ' (forecast)' : ''}: Fitness <strong>${fmt(p.fitness)}</strong> · Fatigue <strong>${fmt(p.fatigue)}</strong> · Form <strong>${signed(p.form)}</strong>`;
}

function renderZones(m) {
  const kind = m.sport.hasPaceZones ? state.zone : 'hr';
  const zones = kind === 'pace' ? m.zones.pace : m.zones.hr;
  const total = kind === 'pace' ? m.totals.paceTotalSecs : m.totals.hrTotalSecs;
  let empty = '';
  if (!zones.ok && !total) {
    empty = kind === 'pace'
      ? 'Pace zones need a threshold pace for running in intervals.icu (Settings → Running → Pace zones).'
      : `Heart-rate zones aren't set for ${m.sport.label.toLowerCase()} in intervals.icu (Settings → ${m.sport.label} → Heart rate zones).`;
  } else if (!total) {
    empty = `No ${kind === 'pace' ? 'pace' : 'heart-rate'} zone data in this range.`;
  }
  $('zones-empty').textContent = empty;
  $('zones-empty').hidden = !empty;
  const items = drawZones(m, kind);
  legend($('legend-zones'), empty ? [] : items);
  $('chart-zones').setAttribute('aria-label', kind === 'pace' ? 'Time in pace zones per week' : 'Time in heart-rate zones per week');
}

// ---------- Plan ----------
// The week list from the current week on, and the workout and race editors. Only the
// selected sport's workouts and races show. Every change saves, then re-renders the
// whole page so the summary, charts, report and list stay in step.

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

function savePlan(plan) {
  state.plan = plan;
  if (!demo && !store.setPlan(plan)) {
    toast("The plan couldn't be saved in this browser (storage full or blocked). Export it to keep a copy.");
  }
  render(state.data);
}

const sessionsText = (m, n) => `${n} ${m.sport.noun[n === 1 ? 0 : 1]}`;
const weekDates = (from, to) =>
  from.slice(5, 7) === to.slice(5, 7) ? `${shortDate(from)} – ${+to.slice(8, 10)}` : `${shortDate(from)} – ${shortDate(to)}`;

function weeksOutText(race, from, to) {
  if (!race || race.date < from) return '';
  if (race.date <= to) return 'Race week';
  const n = weeksOut(from, race.date);
  return `${n} week${n === 1 ? '' : 's'} out`;
}

function chipHtml(w, ctx) {
  const parts = [esc(w.title || 'Workout')];
  if (w.kind !== 'rest') {
    parts.push(`${fmt(w.estimate.minutes)} min`);
    if (w.estimate.load != null) parts.push(`~${fmt(w.estimate.load)}`);
  }
  let status = '';
  let cls = 'chip';
  if (w.kind === 'rest') cls += ' rest';
  if (w.key) cls += ' key';
  if (w.kind !== 'rest' && w.done.length) {
    cls += ' done';
    status = '<span class="tick" aria-label="done">✓</span>';
  } else if (w.kind !== 'rest' && w.date < ctx.now) {
    cls += ' missed';
    status = '<span class="missed-mark">missed</span>';
  }
  return `<button type="button" class="${cls}" data-workout="${esc(w.id)}">${status}<span>${parts.join(' · ')}</span></button>`;
}

function renderPlan(m) {
  const ctx = m.planContext;
  const lede = planSummary(m);
  $('plan-lede').innerHTML = lede
    ? emphasis(lede)
    : `Nothing planned for ${m.sport.label.toLowerCase()} yet. Add workouts to see what they do to your fitness.`;
  const keep = demo
    ? 'Demo plan: changes last until you reload.'
    : 'Saved in this browser only. Export it or copy a share link now and then to keep a copy.';
  $('plan-note').innerHTML = [...planNotes(m), keep].map((n) => `<span>${esc(n)}</span>`).join(' ');

  const html = [];
  for (let k = 0; k < state.planWeeks; k++) {
    const w = ctx.week(addDays(ctx.currentStart, 7 * k));
    const out = weeksOutText(m.nextRace, w.from, w.to);
    const p = w.planned;
    const totals = p.sessions
      ? `${sessionsText(m, p.sessions)} · ${fmt(p.hours, 1)} h · load ~${about(p.load)}`
      : 'Nothing planned';
    const verdict = p.sessions && w.verdict !== 'first weeks' ? `<span class="verdict ${w.verdict}">${w.verdict}</span>` : '';
    const flags = w.flags.map((f) => `<span class="flag">${f}</span>`).join('');
    const phase = w.phase || '';
    const phaseOptions = ['', ...PHASES].map((ph) => `<option value="${ph}"${ph === phase ? ' selected' : ''}>${ph ? ph[0].toUpperCase() + ph.slice(1) : 'Phase'}</option>`).join('');

    const days = eachDay(w.from, w.to).map((d) => {
      const items = [
        ...m.plan.races.filter((r) => r.date === d).map((r) => `<button type="button" class="race-badge" data-race="${esc(r.id)}">${esc(r.name)} · ${r.priority} race</button>`),
        ...m.plan.workouts.filter((x) => x.date === d).map((x) => chipHtml(x, ctx)),
      ];
      const cls = ['day', d < ctx.now ? 'past' : '', d === ctx.now ? 'today' : ''].filter(Boolean).join(' ');
      return `<li class="${cls}">
          <span class="day-label"><span class="dow">${weekday(d)}</span> <span class="dom">${+d.slice(8, 10)}</span></span>
          <span class="day-items">${items.join('')}</span>
          <button type="button" class="add-day" data-add="${d}" aria-label="Add a workout on ${longDay(d)}">+</button>
        </li>`;
    });

    html.push(`<section class="plan-week${w.current ? ' current' : ''}">
        <header class="week-head">
          <div class="week-title"><strong>${k === 0 ? 'This week' : k === 1 ? 'Next week' : weekDates(w.from, w.to)}</strong>
            <span class="week-sub">${k < 2 ? weekDates(w.from, w.to) : ''}${k < 2 && out ? ' · ' : ''}${out}</span></div>
          <div class="week-totals">${totals}${verdict}${flags}</div>
          <div class="week-tools">
            <select class="phase" data-phase="${w.from}" aria-label="Training phase, week of ${shortDate(w.from)}">${phaseOptions}</select>
            <button type="button" class="btn btn-quiet btn-small" data-copy-week="${w.from}">Copy last week</button>
          </div>
        </header>
        <ul class="days">${days.join('')}</ul>
      </section>`);
  }
  $('plan-weeks').innerHTML = html.join('');
}

// ----- Workout editor -----

const wf = $('workout-form');
let editing = null; // { id, sport, kind, target } while the workout dialog is open

const DEFAULTS = { minutes: 45, reps: 6, workMin: 3, restMin: 2, warmMin: 15, coolMin: 10 };

function zoneOptions(hr) {
  const b = hr.bounds || [];
  const n = b.length || hr.count || 5;
  return Array.from({ length: n }, (_, i) => {
    let band = '';
    if (b.length) band = i === 0 ? ` · up to ${b[0]} bpm` : i === n - 1 ? ` · ${b[i - 1] + 1}+ bpm` : ` · ${b[i - 1] + 1}–${b[i]} bpm`;
    return `<option value="${i + 1}">${esc(zoneLabel(hr, i))}${band}</option>`;
  }).join('');
}

function openWorkout(id, date) {
  const m = state.model;
  const w = id ? state.plan.workouts.find((x) => x.id === id) : null;
  const sport = SPORTS[w?.sport || state.sport];
  editing = { id: w?.id || null, sport: w?.sport || state.sport, kind: w?.kind || 'steady', target: w?.target?.type || 'hrZone' };
  if (editing.target === 'pace' && !sport.hasPaceZones) editing.target = 'hrZone';

  wf.reset();
  $('workout-heading').textContent = w ? 'Edit workout' : 'Add workout';
  $('delete-workout').hidden = !w;
  $('workout-error').hidden = true;
  wf.date.value = w?.date || date || today();
  wf.title.value = w?.title || '';
  for (const k of Object.keys(DEFAULTS)) wf[k].value = w?.[k] || DEFAULTS[k];
  wf.zone.innerHTML = zoneOptions(m.zones.hr);
  wf.zone.value = String(w?.target?.type === 'hrZone' ? w.target.value : 2);
  wf.hr.value = w?.target?.type === 'hr' ? w.target.value : '';
  const units = m.zones.pace.units;
  wf.pace.value = w?.target?.type === 'pace' ? paceClock(w.target.value, units) : '';
  $('pace-unit').textContent = `/${paceUnit(units)}`;
  wf.key.checked = !!w?.key;
  wf.notes.value = w?.notes || '';
  $('target-toggle').querySelector('[data-target="pace"]').hidden = !sport.hasPaceZones;

  const titles = new Set([
    ...state.plan.workouts.filter((x) => x.sport === editing.sport).map((x) => x.title),
    ...m.activities.slice(-30).map((a) => a.name),
  ]);
  $('title-options').innerHTML = [...titles].filter(Boolean).slice(0, 20).map((t) => `<option value="${esc(t)}">`).join('');

  syncWorkoutForm();
  $('workout-dialog').showModal();
}

function syncWorkoutForm() {
  for (const b of document.querySelectorAll('[data-kind]')) b.setAttribute('aria-checked', b.dataset.kind === editing.kind);
  for (const b of document.querySelectorAll('[data-target]')) b.setAttribute('aria-checked', b.dataset.target === editing.target);
  for (const el of wf.querySelectorAll('[data-show]')) {
    const show = el.dataset.show;
    el.hidden = show === 'target' ? editing.kind === 'rest' : show !== editing.kind;
  }
  for (const el of wf.querySelectorAll('[data-show-target]')) el.hidden = el.dataset.showTarget !== editing.target;
  updateEstimate();
}

const num = (input) => (input.value === '' ? 0 : Number(input.value));

// The workout as the form describes it, and what's wrong with it, if anything.
function readWorkout() {
  const kind = editing.kind;
  const w = {
    id: editing.id || newId('w'),
    date: wf.date.value,
    sport: editing.sport,
    kind,
    title: wf.title.value.trim(),
    key: wf.key.checked,
    notes: wf.notes.value.trim(),
  };
  let error = !w.date ? 'Pick a date.' : !w.title ? 'Give the workout a title.' : '';
  if (kind === 'rest') return { workout: { ...w, minutes: 0, target: null }, error };

  let value = null;
  if (editing.target === 'hrZone') value = Number(wf.zone.value) || null;
  if (editing.target === 'hr') value = num(wf.hr) >= 60 && num(wf.hr) <= 230 ? num(wf.hr) : null;
  if (editing.target === 'pace') value = parsePace(wf.pace.value, state.model.zones.pace.units);
  w.target = value ? { type: editing.target, value } : null;

  if (kind === 'steady') {
    w.minutes = num(wf.minutes);
    if (!error && !(w.minutes > 0)) error = 'Set how many minutes.';
  } else {
    for (const k of ['reps', 'workMin', 'restMin', 'warmMin', 'coolMin']) w[k] = num(wf[k]);
    w.minutes = 0;
    if (!error && !(w.reps > 0 && w.workMin > 0)) error = 'Set the number of reps and how long each one is.';
  }
  if (!error && !w.target) {
    error = editing.target === 'pace' ? 'Set a pace like 4:45.' : editing.target === 'hr' ? 'Set a heart rate in bpm.' : 'Pick a zone.';
  }
  return { workout: w, error };
}

// "around Z3": the heart-rate or pace zone a target falls in.
function zoneOf(target, zones) {
  if (target.type === 'hrZone') return `Z${target.value}`;
  if (target.type === 'hr') {
    const i = (zones.hr.bounds || []).findIndex((b) => target.value <= b);
    return i < 0 ? '' : `Z${i + 1}`;
  }
  const tp = zones.pace.thresholdPace;
  const i = tp ? (zones.pace.pcts || []).findIndex((p) => (target.value / tp) * 100 <= p) : -1;
  return i < 0 ? '' : `pace Z${i + 1}`;
}

function updateEstimate() {
  const m = state.model;
  const { workout } = readWorkout();
  const est = estimateLoad(workout, m.planContext.zones, m.calibration);
  const sport = m.sport.label.toLowerCase();
  const missing = {
    lthr: `No estimate: intervals.icu has no threshold heart rate for ${sport}.`,
    hrZones: `No estimate: intervals.icu has no heart-rate zones for ${sport}.`,
    thresholdPace: `No estimate: intervals.icu has no threshold pace for ${sport}.`,
    target: 'Set a target to see the estimated load.',
  };
  let text;
  if (workout.kind === 'rest') text = 'A rest day: no load.';
  else if (est.load == null) text = missing[est.missing] || '';
  else {
    const zone = zoneOf(workout.target, m.planContext.zones);
    text = `About ${fmt(est.load)} load · ${fmt(est.minutes)} min${zone ? ` · around ${zone}` : ''}`;
  }
  $('workout-estimate').textContent = text;
}

// ----- Race editor -----

const rf = $('race-form');
let editingRace = null; // { id, priority }

function openRace(id) {
  const r = id ? state.plan.races.find((x) => x.id === id) : null;
  editingRace = { id: r?.id || null, priority: r?.priority || 'A' };
  rf.reset();
  $('race-heading').textContent = r ? 'Edit race' : 'Add race';
  $('delete-race').hidden = !r;
  $('race-error').hidden = true;
  $('race-sport').innerHTML = Object.entries(SPORTS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('');
  rf.name.value = r?.name || '';
  rf.date.value = r?.date || '';
  rf.sport.value = r?.sport || state.sport;
  syncRaceForm();
  $('race-dialog').showModal();
}

function syncRaceForm() {
  for (const b of document.querySelectorAll('[data-priority]')) b.setAttribute('aria-checked', b.dataset.priority === editingRace.priority);
}

// ----- Plan actions -----

function copyLastWeek(from) {
  const prevFrom = addDays(from, -7);
  const source = state.plan.workouts.filter((w) => w.sport === state.sport && w.date >= prevFrom && w.date < from);
  if (!source.length) return toast('Nothing was planned the week before to copy.');
  const copies = source.map((w) => ({ ...w, id: newId('w'), date: addDays(w.date, 7) }));
  savePlan({ ...state.plan, workouts: [...state.plan.workouts, ...copies] });
  toast(`Copied ${copies.length} workout${copies.length === 1 ? '' : 's'} from the week before.`);
}

function setPhase(from, phase) {
  const weekPhases = { ...state.plan.weekPhases };
  if (phase) weekPhases[from] = phase;
  else delete weekPhases[from];
  savePlan({ ...state.plan, weekPhases });
}

const planCounts = (p) =>
  `${p.workouts.length} workout${p.workouts.length === 1 ? '' : 's'} and ${p.races.length} race${p.races.length === 1 ? '' : 's'}`;

async function sharePlan() {
  const value = await encodeShare(state.plan);
  const url = `${location.origin}${location.pathname}${location.search}#plan=${value}`;
  const ok = await copyText(url);
  toast(ok ? `Share link copied. It carries ${planCounts(state.plan)}.` : "Couldn't copy the link. Use Export plan instead.");
}

// A plan arriving in a share link: in demo it simply replaces the sample; otherwise
// ask before replacing the saved plan. The hash is removed either way.
async function receiveSharedPlan() {
  const match = location.hash.match(/^#plan=(.+)$/);
  if (!match) return;
  history.replaceState(null, '', location.pathname + location.search);
  const { plan, error } = await decodeShare(match[1]);
  if (error) return showNotice(error);
  if (demo) {
    state.plan = plan;
    return toast(`Showing the shared plan: ${planCounts(plan)}.`);
  }
  state.sharedPlan = plan;
  const done = () => {
    state.sharedPlan = null;
    hideNotice();
  };
  showNotice(`This link carries a plan with ${planCounts(plan)}.`, [
    { label: 'Use this plan', onClick: () => (done(), savePlan(plan), toast('Using the shared plan.')) },
    { label: 'Keep mine', onClick: done },
  ]);
}

// ---------- Notices ----------

// action is one { label, onClick } or a list of them.
function showNotice(text, action) {
  const el = $('notice');
  el.replaceChildren(text);
  for (const a of [action || []].flat()) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: a.label });
    b.addEventListener('click', a.onClick);
    el.append(b);
  }
  el.hidden = false;
}
const hideNotice = () => ($('notice').hidden = true);

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3000);
}

// ---------- Screens ----------

function showOnboarding() {
  $('onboarding').hidden = false;
  $('dashboard').hidden = true;
  $('topbar-actions').hidden = true;
}

function showDashboard() {
  $('onboarding').hidden = true;
  $('dashboard').hidden = false;
  $('topbar-actions').hidden = false;
}

function readCreds(form) {
  const f = new FormData(form);
  return { athleteId: f.get('athleteId').trim(), apiKey: f.get('apiKey').trim() };
}

function openSettings() {
  const form = $('settings-form');
  const c = store.getCreds() || {};
  form.athleteId.value = c.athleteId || '';
  form.apiKey.value = c.apiKey || '';
  $('settings').showModal();
}

// ---------- Events ----------

$('onboarding-form').addEventListener('submit', (e) => {
  e.preventDefault();
  store.setCreds(readCreds(e.target));
  load({ force: true });
});

$('open-settings').addEventListener('click', openSettings);
$('cancel-settings').addEventListener('click', () => $('settings').close());
$('settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  store.setCreds(readCreds(e.target));
  $('settings').close();
  load({ force: true });
});
$('clear-data').addEventListener('click', () => {
  store.clearAll();
  $('settings').close();
  location.reload();
});

$('refresh').addEventListener('click', () => load({ force: true }));

for (const b of document.querySelectorAll('[data-sport]')) {
  b.addEventListener('click', () => {
    state.sport = b.dataset.sport;
    state.zone = 'hr';
    store.setPrefs({ sport: state.sport });
    render(state.data);
  });
}

for (const b of document.querySelectorAll('[data-weeks]')) {
  b.addEventListener('click', () => {
    state.weeks = b.dataset.weeks === 'custom' ? 'custom' : Number(b.dataset.weeks);
    store.setPrefs({ weeks: state.weeks });
    load();
  });
}

$('compare-toggle').addEventListener('change', (e) => {
  state.compare = e.target.checked;
  store.setPrefs({ compare: state.compare });
  syncControls();
  if (state.model) renderCharts(state.model);
});

for (const b of document.querySelectorAll('[data-lineunit]')) {
  b.addEventListener('click', () => {
    state.lineUnit = b.dataset.lineunit;
    store.setPrefs({ lineUnit: state.lineUnit });
    syncControls();
    if (state.model) renderCharts(state.model);
  });
}

for (const b of document.querySelectorAll('[data-weekstart]')) {
  b.addEventListener('click', () => {
    state.weekStart = Number(b.dataset.weekstart);
    store.setPrefs({ weekStart: state.weekStart });
    load();
  });
}

for (const id of ['custom-from', 'custom-to']) {
  $(id).addEventListener('change', () => {
    const from = $('custom-from').value;
    const to = $('custom-to').value;
    if (!from || !to) return;
    if (from > to) return toast('The start date has to be before the end date.');
    if (addDays(from, 7 * 52) < to) return toast('Pick a range of a year or less.');
    state.customFrom = from;
    state.customTo = to;
    store.setPrefs({ customFrom: from, customTo: to });
    load();
  });
}

for (const b of document.querySelectorAll('[data-measure]')) {
  b.addEventListener('click', () => {
    state.measure = b.dataset.measure;
    syncControls();
    renderCharts(state.model);
  });
}

for (const b of document.querySelectorAll('[data-zone]')) {
  b.addEventListener('click', () => {
    state.zone = b.dataset.zone;
    syncControls();
    renderZones(state.model);
    renderTakeaways(state.model);
  });
}

$('copy-report').addEventListener('click', async () => {
  if (!state.model) return;
  const ok = await copyText(buildMarkdown(state.model, state.data.athlete.name));
  toast(ok ? 'Report copied. Paste it into Claude.' : 'Copy failed. Use Download report instead.');
});
$('download-md').addEventListener('click', () => {
  if (!state.model) return;
  download(buildMarkdown(state.model, state.data.athlete.name), fileName(state.model, 'md'), 'text/markdown;charset=utf-8');
});
$('download-json').addEventListener('click', () => {
  if (!state.model) return;
  download(buildJson(state.model), fileName(state.model, 'json'), 'application/json;charset=utf-8');
});

// Plan section
$('add-workout').addEventListener('click', () => state.model && openWorkout(null));
$('add-race').addEventListener('click', () => state.model && openRace(null));
$('more-weeks').addEventListener('click', () => {
  state.planWeeks += 4;
  renderPlan(state.model);
});

$('plan-weeks').addEventListener('click', (e) => {
  const el = e.target.closest('[data-workout], [data-add], [data-race], [data-copy-week]');
  if (!el || !state.model) return;
  if (el.dataset.workout) openWorkout(el.dataset.workout);
  else if (el.dataset.add) openWorkout(null, el.dataset.add);
  else if (el.dataset.race) openRace(el.dataset.race);
  else copyLastWeek(el.dataset.copyWeek);
});
$('plan-weeks').addEventListener('change', (e) => {
  if (e.target.dataset.phase) setPhase(e.target.dataset.phase, e.target.value);
});

const menu = $('plan-menu');
const setMenu = (open) => {
  menu.hidden = !open;
  $('plan-more').setAttribute('aria-expanded', open);
};
$('plan-more').addEventListener('click', (e) => {
  e.stopPropagation();
  setMenu(menu.hidden);
  if (!menu.hidden) menu.querySelector('button').focus();
});
document.addEventListener('click', (e) => !menu.contains(e.target) && setMenu(false));
document.addEventListener('keydown', (e) => e.key === 'Escape' && !menu.hidden && (setMenu(false), $('plan-more').focus()));
menu.addEventListener('click', () => setMenu(false));

$('export-plan').addEventListener('click', () =>
  download(JSON.stringify(state.plan, null, 2), `training-plan-${today()}.json`, 'application/json;charset=utf-8'));
$('import-plan').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // so choosing the same file again still fires
  if (!file) return;
  let result;
  try {
    result = validatePlan(JSON.parse(await file.text()));
  } catch {
    result = { error: "That file isn't a training plan." };
  }
  if (result.error) return toast(result.error);
  if (!confirm(`This file holds ${planCounts(result.plan)}. Replace your current plan with it?`)) return;
  savePlan(result.plan);
  toast(`Plan imported: ${planCounts(result.plan)}.`);
});
$('share-plan').addEventListener('click', sharePlan);
$('delete-plan').addEventListener('click', () => {
  if (!state.plan.workouts.length && !state.plan.races.length) return toast('There is no plan to delete.');
  if (!confirm(`Delete the whole plan, ${planCounts(state.plan)}, for every sport? Export it first if you might want it back.`)) return;
  savePlan(emptyPlan());
  toast('Plan deleted.');
});

// Workout dialog
for (const b of document.querySelectorAll('[data-kind]')) {
  b.addEventListener('click', () => {
    editing.kind = b.dataset.kind;
    if (editing.kind === 'rest' && !wf.title.value.trim()) wf.title.value = 'Rest';
    syncWorkoutForm();
  });
}
for (const b of document.querySelectorAll('[data-target]')) {
  b.addEventListener('click', () => {
    editing.target = b.dataset.target;
    syncWorkoutForm();
  });
}
wf.addEventListener('input', updateEstimate);
wf.addEventListener('change', updateEstimate);
wf.addEventListener('submit', (e) => {
  e.preventDefault();
  const { workout, error } = readWorkout();
  if (error) {
    $('workout-error').textContent = error;
    $('workout-error').hidden = false;
    return;
  }
  const others = state.plan.workouts.filter((w) => w.id !== workout.id);
  $('workout-dialog').close();
  savePlan({ ...state.plan, workouts: [...others, workout] });
});
$('cancel-workout').addEventListener('click', () => $('workout-dialog').close());
$('delete-workout').addEventListener('click', () => {
  $('workout-dialog').close();
  savePlan({ ...state.plan, workouts: state.plan.workouts.filter((w) => w.id !== editing.id) });
});

// Race dialog
for (const b of document.querySelectorAll('[data-priority]')) {
  b.addEventListener('click', () => {
    editingRace.priority = b.dataset.priority;
    syncRaceForm();
  });
}
rf.addEventListener('submit', (e) => {
  e.preventDefault();
  const race = { id: editingRace.id || newId('r'), name: rf.name.value.trim(), date: rf.date.value, sport: rf.sport.value, priority: editingRace.priority };
  const error = !race.name ? 'Give the race a name.' : !race.date ? 'Pick the race date.' : '';
  if (error) {
    $('race-error').textContent = error;
    $('race-error').hidden = false;
    return;
  }
  $('race-dialog').close();
  savePlan({ ...state.plan, races: [...state.plan.races.filter((r) => r.id !== race.id), race] });
});
$('cancel-race').addEventListener('click', () => $('race-dialog').close());
$('delete-race').addEventListener('click', () => {
  $('race-dialog').close();
  savePlan({ ...state.plan, races: state.plan.races.filter((r) => r.id !== editingRace.id) });
});

// Charts read colours from CSS, so redraw when the light/dark scheme flips.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.model && renderCharts(state.model));

// ---------- Start ----------

async function start() {
  if (demo) {
    const { makeDemoData, makeDemoPlan } = await import('./demo.js');
    store.useData(makeDemoData());
    state.plan = makeDemoPlan(state.weekStart);
  }
  await receiveSharedPlan();
  // A share link opened in a tab already showing this page only changes the hash.
  window.addEventListener('hashchange', async () => {
    await receiveSharedPlan();
    render(state.data);
  });
  await new Promise((resolve) => (window.Chart ? resolve() : window.addEventListener('load', resolve, { once: true })));
  load();
}

start();

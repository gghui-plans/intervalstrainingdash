// Page wiring: controls, loading, rendering and export.

import { DEFAULT_WEEKS, SPORTS } from './config.js';
import { addDays, rangeLabel, shortDate, today } from './dates.js';
import { buildModel, fetchWindow, sportsPresent } from './data.js';
import { drawFitness, drawLoad, drawVolume, drawZones } from './charts.js';
import { buildJson, buildMarkdown, copyText, download, fileName } from './report.js';
import { EXPLAIN, change, dataNotes, fmt, formState, signed, summary } from './text.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const demo = new URLSearchParams(location.search).has('demo');

const prefs = store.getPrefs();
const state = {
  sport: prefs.sport || null, // null until we know which sport the athlete has
  weeks: prefs.weeks || DEFAULT_WEEKS, // a number, or 'custom'
  customFrom: prefs.customFrom || addDays(today(), -27),
  customTo: prefs.customTo || today(),
  measure: 'distance',
  zone: 'hr',
  data: null,
  model: null,
};

function currentRange() {
  if (state.weeks === 'custom') return { from: state.customFrom, to: state.customTo };
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
    hideNotice();
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

  const m = buildModel(data, state.sport, range);
  state.model = m;

  syncControls();
  renderUpdated(data);
  renderSummary(m);
  renderCharts(m);
  $('report-preview').textContent = buildMarkdown(m, data.athlete.name);
}

function syncControls() {
  for (const b of document.querySelectorAll('[data-sport]')) b.setAttribute('aria-checked', b.dataset.sport === state.sport);
  for (const b of document.querySelectorAll('[data-weeks]')) b.setAttribute('aria-checked', String(state.weeks) === b.dataset.weeks);
  for (const b of document.querySelectorAll('[data-measure]')) b.setAttribute('aria-checked', b.dataset.measure === state.measure);
  for (const b of document.querySelectorAll('[data-zone]')) b.setAttribute('aria-checked', b.dataset.zone === state.zone);
  $('custom-range').hidden = state.weeks !== 'custom';
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
  $('notes').replaceChildren(...dataNotes(m).map((n) => Object.assign(document.createElement('li'), { textContent: n })));
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
  const span = `over ${m.range.days % 7 === 0 && weeks > 1 ? `${weeks} weeks` : `${m.range.days} days`}`;
  const c = change(t.load, m.prevTotals.load);
  if (m.grain === 'day') {
    // A short range is about its total against the period before; the bars give the days.
    const cd = change(t.distanceKm, m.prevTotals.distanceKm);
    const ch = change(t.allHours, m.prevTotals.allHours);
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
  const pace = m.sport.hasPaceZones && state.zone === 'pace';
  const secs = pace ? t.paceSecs : t.hrSecs;
  const total = pace ? t.paceTotalSecs : t.hrTotalSecs;
  $('take-zones').innerHTML = total
    ? `<strong>${fmt((((secs[0] || 0) + (secs[1] || 0)) / total) * 100)}%</strong> of time easy (Z1–Z2) ${span}`
    : '';
  const last = m.fitness[m.fitness.length - 1];
  $('take-fitness').innerHTML = last
    ? `Today: Fitness <strong>${fmt(last.fitness)}</strong> · Fatigue <strong>${fmt(last.fatigue)}</strong> · Form <strong>${signed(last.form)}</strong>`
    : '';
}

function legend(el, items) {
  el.replaceChildren(
    ...items.map(({ label, color, line, tip }) => {
      const item = document.createElement(tip ? 'button' : 'span');
      item.className = 'legend-item';
      if (tip) {
        item.type = 'button';
        item.dataset.tip = tip;
      }
      const sw = document.createElement('span');
      sw.className = 'swatch' + (line ? ' line' : '');
      sw.style.background = color;
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

function renderCharts(m) {
  if (!window.Chart) return; // Chart.js still loading; render() runs again once it has

  renderTakeaways(m);

  const daily = m.grain === 'day';
  const per = daily ? 'per day' : 'per week';
  $('load-title').textContent = `Training load ${per}`;
  $('zones-title').textContent = `Time in zones ${per}`;
  $('volume-title').textContent = state.measure === 'distance' ? `Distance ${per}` : `Training time ${per}`;

  $('info-load').dataset.tip = EXPLAIN.load;
  drawLoad(m);
  legend($('legend-load'), [
    { label: 'This period', color: cssVar('--series-1') },
    { label: daily ? (m.range.days === 7 ? 'Same day, week before' : 'Same day, period before') : 'Previous period, same week', color: cssVar('--series-prev') },
  ]);

  legend($('legend-volume'), drawVolume(m, state.measure));

  renderZones(m);

  const series = drawFitness(m);
  legend($('legend-fitness'), series.map((s) => ({ label: s.label, color: s.color, line: true, tip: s.explain })));

  $('footnote').textContent = m.weeks.some((w) => w.partial)
    ? `* The first bar covers ${m.weeks[0].days} days; weeks are counted back from ${shortDate(m.range.to)}.`
    : '';
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

// ---------- Notices ----------

function showNotice(text, action) {
  const el = $('notice');
  el.replaceChildren(text);
  if (action) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: action.label });
    b.addEventListener('click', action.onClick);
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

// Charts read colours from CSS, so redraw when the light/dark scheme flips.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.model && renderCharts(state.model));

// ---------- Start ----------

async function start() {
  if (demo) {
    const { makeDemoData } = await import('./demo.js');
    store.useData(makeDemoData());
  }
  await new Promise((resolve) => (window.Chart ? resolve() : window.addEventListener('load', resolve, { once: true })));
  load();
}

start();

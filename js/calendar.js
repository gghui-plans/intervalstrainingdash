// The printed calendar: one month per letter-landscape page, built from the same
// cached data, plan and maths as the dashboard. Read-only: it never writes to storage.

import { SPORTS } from './config.js';
import {
  addDays, addMonths, daysBetween, eachDay, longDay, monthEnd, monthName, monthStart, shortDate, startOfWeek, today, weekday,
} from './dates.js';
import { planContext } from './data.js';
import { nextRace, weeksOut } from './plan.js';
import { about, fmt } from './text.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const demo = params.has('demo');
const prefs = store.getPrefs();
const weekStart = prefs.weekStart ?? 1;

// ?sport=paddling&month=2026-11&months=3 open the page on a given view.
const state = {
  sport: SPORTS[params.get('sport')] ? params.get('sport') : prefs.sport || 'running',
  month: /^\d{4}-\d{2}$/.test(params.get('month')) ? `${params.get('month')}-01` : monthStart(today()),
  months: [1, 2, 3].includes(Number(params.get('months'))) ? Number(params.get('months')) : 1,
  data: null,
  plan: null,
};

const MAX_ITEMS = 3; // a fourth workout becomes "+1 more"

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const duration = (min) => (min >= 60 ? `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}` : `${Math.round(min)} min`);
const actual = (a) => [a.distance ? `${fmt(a.distance / 1000, 1)} km` : '', a.icu_training_load ? `load ${fmt(a.icu_training_load)}` : '']
  .filter(Boolean)
  .join(' · ');

// ---------- One day ----------

function dayCell(d, month, ctx, race) {
  if (d.slice(0, 7) !== month.slice(0, 7)) return '<div class="cell cday out"></div>';
  const now = ctx.now;
  const recorded = d <= now; // past days, and today once something is recorded
  const acts = [...(ctx.doneOn[d] || [])];
  const items = [];
  let key = false;

  for (const w of ctx.workouts.filter((x) => x.date === d)) {
    if (w.kind === 'rest') {
      items.push('<li class="rest">Rest</li>');
      continue;
    }
    key ||= w.key;
    const a = recorded ? acts.shift() : null;
    const title = `<span class="t">${esc(w.title || 'Workout')}</span>`;
    if (a) items.push(`<li class="done${w.key ? ' key' : ''}"><span class="mark tick">✓</span>${title} <span class="m">${actual(a)}</span></li>`);
    else if (d < now) items.push(`<li class="missed"><span class="mark circle"></span>${title} <span class="m">${duration(w.estimate.minutes)}</span></li>`);
    else items.push(`<li class="${w.key ? 'key' : ''}"><span class="mark box"></span>${title} <span class="m">${duration(w.estimate.minutes)}</span></li>`);
  }
  // Sessions nobody planned still get their tick.
  for (const a of acts) {
    items.push(`<li class="done extra"><span class="mark tick">✓</span><span class="t">${esc(a.name || 'Session')}</span> <span class="m">${actual(a)}</span></li>`);
  }
  if (items.length > MAX_ITEMS) items.splice(MAX_ITEMS, Infinity, `<li class="more">+${items.length - MAX_ITEMS} more</li>`);

  const races = ctx.allRaces.filter((r) => r.date === d && (r.sport === ctx.sportKey || r.id === race?.id));
  const countdown = race && d < race.date ? `<span class="cd">${daysBetween(d, race.date)}</span>` : '';
  const cls = ['cell', 'cday', key ? 'key' : '', d === now ? 'today' : '', d < now ? 'past' : ''].filter(Boolean).join(' ');
  return `<div class="${cls}">
      <div class="cday-top"><span class="num">${+d.slice(8, 10)}</span>${countdown}</div>
      ${races.map((r) => `<div class="badge">${esc(r.name)}</div>`).join('')}
      <ul class="items">${items.join('')}</ul>
    </div>`;
}

// ---------- One week row ----------

function weekCells(from, month, ctx, race) {
  const w = ctx.week(from);
  const out = !race || race.date < from ? '' : race.date <= w.to ? 'Race week' : `${weeksOut(from, race.date)} wks out`;
  const label = `<div class="cell wk">${out ? `<span class="out">${out}</span>` : ''}${w.phase ? `<span class="ph">${w.phase}</span>` : ''}</div>`;

  let totals;
  if (w.past) {
    totals = [
      `<b>${fmt(w.done.load)}</b> load`,
      w.planned.sessions ? `of ~${about(w.planned.load)} planned` : 'nothing planned',
      `${fmt(w.done.hours, 1)} h · ${w.done.sessions} done`,
    ];
  } else if (w.planned.sessions) {
    totals = [
      `<b>${fmt(w.planned.hours, 1)} h</b> planned`,
      `load ~${about(w.planned.load)}`,
      w.verdict === 'first weeks' ? '' : `<span class="vd">${w.verdict}</span>`,
    ];
  } else {
    totals = ['Nothing planned'];
  }
  const days = eachDay(from, w.to).map((d) => dayCell(d, month, ctx, race));
  return [label, ...days, `<div class="cell tot">${totals.filter(Boolean).map((t) => `<span>${t}</span>`).join('')}</div>`].join('');
}

// ---------- Footer ----------

// Last month's adherence, then one headline: the fitness forecast if the plan covers
// this month, else a record month, else the month's planned totals.
function footer(month, ctx, race) {
  const lines = [];
  const now = ctx.now;
  const prev = addMonths(month, -1);
  const prevPlanned = ctx.workouts.filter(
    (w) => w.kind !== 'rest' && w.date >= prev && w.date <= monthEnd(prev) && (w.date < now || w.done.length),
  );
  if (prevPlanned.length) {
    const done = prevPlanned.filter((w) => w.done.length).length;
    const soFar = monthEnd(prev) >= now ? ' so far' : '';
    lines.push(`${done} of ${prevPlanned.length} planned sessions done${soFar} in ${monthName(prev)}.`);
  }

  const end = monthEnd(month);
  const inMonth = ctx.workouts.filter((w) => w.kind !== 'rest' && w.date >= month && w.date <= end);
  const ahead = inMonth.filter((w) => w.date >= now);
  const lastPlanned = ctx.workouts.length ? ctx.workouts[ctx.workouts.length - 1].date : null;
  const hours = inMonth.reduce((s, w) => s + w.estimate.minutes, 0) / 60;

  if (ahead.length && ctx.fitnessNow) {
    // Quote month end only when the plan reaches it; otherwise the last planned day.
    const until = lastPlanned >= addDays(end, -7) ? end : lastPlanned;
    let text = `Fitness ${fmt(ctx.fitnessNow.fitness)} now, ${fmt(ctx.pointOn(until).fitness)} by ${until === end ? 'month end' : shortDate(until)}`;
    if (race && race.sport === ctx.sportKey && race.date > now && lastPlanned >= addDays(race.date, -7)) {
      text += `, ${fmt(ctx.pointOn(race.date).fitness)} on race day`;
    }
    lines.push(`${text}.`);
  } else if (inMonth.length) {
    // Completed months in the cache, by actual hours.
    const first = ctx.dataFrom === monthStart(ctx.dataFrom) ? ctx.dataFrom : addMonths(ctx.dataFrom, 1);
    const months = [];
    for (let m = first; monthEnd(m) < monthStart(now); m = addMonths(m, 1)) {
      months.push(ctx.activities.filter((a) => a.start_date_local.slice(0, 7) === m.slice(0, 7)).reduce((s, a) => s + (a.moving_time || 0) / 3600, 0));
    }
    if (months.length >= 2 && hours > Math.max(...months)) {
      lines.push(`Biggest planned month since ${monthName(first)}: ${fmt(hours, 1)} hours.`);
    } else {
      lines.push(`${inMonth.length} ${ctx.sport.noun[inMonth.length === 1 ? 0 : 1]}, ${fmt(hours, 1)} hours planned.`);
    }
  }
  return lines.slice(0, 2).map((l) => `<p>${esc(l)}</p>`).join('');
}

// ---------- One page ----------

function page(month, ctx) {
  const race = nextRace(ctx.allRaces, ctx.sportKey, month);
  const first = startOfWeek(month, weekStart);
  const starts = [];
  for (let d = first; d <= monthEnd(month); d = addDays(d, 7)) starts.push(d);
  const dayNames = Array.from({ length: 7 }, (_, i) => weekday(addDays(first, i)));
  const raceLine = race
    ? `<b>${esc(race.name)}</b>${race.sport === ctx.sportKey ? '' : ` (${race.sport})`} · ${longDay(race.date)} · ${fmt(daysBetween(month, race.date))} days from ${shortDate(month)}`
    : '';
  return `<section class="page" aria-label="${monthName(month)} ${month.slice(0, 4)}">
      <header class="page-head">
        <div class="page-title"><h1>${monthName(month)} ${month.slice(0, 4)}</h1><span class="sport">${ctx.sport.label}</span></div>
        <div class="page-race">${raceLine}</div>
      </header>
      <div class="cal" style="grid-template-rows: auto repeat(${starts.length}, 1fr)">
        <div class="cell hd"></div>${dayNames.map((n) => `<div class="cell hd">${n}</div>`).join('')}<div class="cell hd">Week</div>
        ${starts.map((s) => weekCells(s, month, ctx, race)).join('')}
      </div>
      <footer class="page-foot">${footer(month, ctx, race)}</footer>
    </section>`;
}

// ---------- Screen ----------

function render() {
  for (const b of document.querySelectorAll('[data-calsport]')) b.setAttribute('aria-checked', b.dataset.calsport === state.sport);
  for (const b of document.querySelectorAll('[data-months]')) b.setAttribute('aria-checked', Number(b.dataset.months) === state.months);
  const last = addMonths(state.month, state.months - 1);
  $('month-label').textContent =
    state.months === 1 ? `${monthName(state.month)} ${state.month.slice(0, 4)}` : `${monthName(state.month).slice(0, 3)} – ${monthName(last).slice(0, 3)} ${last.slice(0, 4)}`;

  if (!state.data) {
    $('pages').innerHTML = `<p class="cal-empty">There's no training loaded in this browser yet. Open the <a href="./">dashboard</a> first, then come back to print.</p>`;
    return;
  }
  const ctx = { ...planContext(state.data, state.sport, state.plan, weekStart), dataFrom: state.data.from };
  $('pages').innerHTML = Array.from({ length: state.months }, (_, k) => page(addMonths(state.month, k), ctx)).join('');
  fit();
}

// The preview shows the printed page scaled to the window, so phones see it whole.
const PAGE_PX = 11 * 96; // the sheet with its 0.4in margins
function fit() {
  const room = document.documentElement.clientWidth - 32;
  $('pages').style.setProperty('--fit', Math.min(1, room / PAGE_PX).toFixed(3));
}

for (const b of document.querySelectorAll('[data-calsport]')) {
  b.addEventListener('click', () => {
    state.sport = b.dataset.calsport;
    render();
  });
}
for (const b of document.querySelectorAll('[data-months]')) {
  b.addEventListener('click', () => {
    state.months = Number(b.dataset.months);
    render();
  });
}
$('prev-month').addEventListener('click', () => {
  state.month = addMonths(state.month, -1);
  render();
});
$('next-month').addEventListener('click', () => {
  state.month = addMonths(state.month, 1);
  render();
});
$('print').addEventListener('click', () => window.print());
$('back').href = demo ? './?demo' : './';
addEventListener('resize', fit);

async function start() {
  if (demo) {
    const { makeDemoData, makeDemoPlan } = await import('./demo.js');
    state.data = makeDemoData();
    state.plan = makeDemoPlan(weekStart);
  } else {
    state.data = store.getCache();
    state.plan = store.getPlan();
  }
  if (!SPORTS[state.sport]) state.sport = Object.keys(SPORTS)[0];
  render();
}

start();

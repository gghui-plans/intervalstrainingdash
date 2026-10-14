// The printed calendar: one month per letter-landscape page, built from the same
// cached data, plan and maths as the dashboard. All sports by default, each workout
// tagged with its sport's letter; or one sport. Read-only: it never writes to storage.

import { SPORTS } from './config.js';
import {
  addDays, addMonths, daysBetween, eachDay, longDay, monthEnd, monthName, monthStart, shortDate, startOfWeek, today, weekday,
} from './dates.js';
import { ALL, planContext, viewSport, visibleSports } from './data.js';
import { icon } from './icons.js';
import { nextRace, weeksOut } from './plan.js';
import { about, fmt, signed } from './text.js';
import { $, esc } from './ui.js';
import * as store from './store.js';

const params = new URLSearchParams(location.search);
const demo = params.has('demo');
const prefs = store.getPrefs();
const weekStart = prefs.weekStart ?? 1;

// ?sport=paddling&month=2026-11&months=3 open the page on a given view.
const state = {
  sport: SPORTS[params.get('sport')] ? params.get('sport') : ALL,
  month: /^\d{4}-\d{2}$/.test(params.get('month')) ? `${params.get('month')}-01` : monthStart(today()),
  months: [1, 2, 3].includes(Number(params.get('months'))) ? Number(params.get('months')) : 1,
  data: null,
  plan: null,
};

const MAX_ITEMS = 3; // a fourth workout becomes "+1 more"

const duration = (min) => (min >= 60 ? `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}` : `${Math.round(min)} min`);
const actual = (a) => [a.distance ? `${fmt(a.distance / 1000, 1)} km` : '', a.icu_training_load ? `load ${fmt(a.icu_training_load)}` : '']
  .filter(Boolean)
  .join(' · ');
const letter = (key) => SPORTS[key]?.letter || '·';

// ---------- One day ----------

function dayCell(d, month, v) {
  if (d.slice(0, 7) !== month.slice(0, 7)) return '<div class="cell cday out"></div>';
  const { ctx, all, race } = v;
  const now = ctx.now;
  const recorded = d <= now; // past days, and today once something is recorded
  const tag = (key) => (all ? `<span class="lt">${letter(key)}</span>` : '');
  const workouts = v.workouts.filter((w) => w.date === d);
  // Each planned workout claims one session of its own sport that day; the rest are extras.
  const left = [...(all ? ctx.doneOn[d] || [] : ctx.sports[v.view].doneOn[d] || [])];
  const claim = (sport) => {
    const i = left.findIndex((a) => SPORTS[sport].types.includes(a.type));
    return i < 0 ? null : left.splice(i, 1)[0];
  };
  const items = ctx.restDays.has(d) ? ['<li class="rest">Rest</li>'] : [];
  let key = false;

  for (const w of workouts) {
    key ||= w.key;
    const a = recorded ? claim(w.sport) : null;
    const title = `${tag(w.sport)}<span class="t">${esc(w.title || 'Workout')}</span>`;
    if (a) items.push(`<li class="done${w.key ? ' key' : ''}"><span class="mark tick">✓</span>${title} <span class="m">${actual(a)}</span></li>`);
    else if (d < now) items.push(`<li class="missed"><span class="mark circle"></span>${title} <span class="m">${duration(w.estimate.minutes)}</span></li>`);
    else items.push(`<li class="${w.key ? 'key' : ''}"><span class="mark box"></span>${title} <span class="m">${duration(w.estimate.minutes)}</span></li>`);
  }
  // Sessions nobody planned still get their tick.
  for (const a of left) {
    const k = Object.keys(SPORTS).find((s) => SPORTS[s].types.includes(a.type));
    items.push(`<li class="done extra"><span class="mark tick">✓</span>${tag(k)}<span class="t">${esc(a.name || a.type || 'Session')}</span> <span class="m">${actual(a)}</span></li>`);
  }
  if (items.length > MAX_ITEMS) items.splice(MAX_ITEMS, Infinity, `<li class="more">+${items.length - MAX_ITEMS} more</li>`);

  const races = ctx.races.filter((r) => r.date === d && (all || r.sport === v.view || r.id === race?.id));
  const countdown = race && d < race.date ? `<span class="cd">${daysBetween(d, race.date)}</span>` : '';
  const cls = ['cell', 'cday', key ? 'key' : '', d === now ? 'today' : '', d < now ? 'past' : ''].filter(Boolean).join(' ');
  return `<div class="${cls}">
      <div class="cday-top"><span class="num">${+d.slice(8, 10)}</span>${countdown}</div>
      ${races.map((r) => `<div class="badge">${all ? `${letter(r.sport)} · ` : ''}${esc(r.name)}</div>`).join('')}
      <ul class="items">${items.join('')}</ul>
    </div>`;
}

// ---------- One week row ----------

function weekCells(from, month, v) {
  const { ctx, all, race } = v;
  const w = ctx.week(from, v.view);
  const out = !race || race.date < from ? '' : race.date <= w.to ? 'Race week' : `${weeksOut(from, race.date)} wks out`;
  const label = `<div class="cell wk">${out ? `<span class="out">${out}</span>` : ''}${w.phase ? `<span class="ph">${w.phase}</span>` : ''}</div>`;

  let totals;
  if (all) {
    // Hours, in total and by sport, and a warning if form would drop below −30.
    const bySport = Object.keys(SPORTS).filter((k) => w.bySport[k]).map((k) => `<span class="nw">${letter(k)} ${fmt(w.bySport[k].hours, 1)} h</span>`);
    totals = w.past
      ? [`<b>${fmt(w.done.hours, 1)} h</b> done`, w.planned.sessions ? `of ${fmt(w.planned.hours, 1)} h planned` : 'nothing planned', `${w.done.sessions} sessions`]
      : w.planned.sessions
        ? [`<b>${fmt(w.planned.hours, 1)} h</b> planned`, bySport.join(' · '), w.flags.length ? '<span class="vd">High fatigue</span>' : '']
        : ['Nothing planned'];
  } else if (w.past) {
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
  const days = eachDay(from, w.to).map((d) => dayCell(d, month, v));
  return [label, ...days, `<div class="cell tot">${totals.filter(Boolean).map((t) => `<span>${t}</span>`).join('')}</div>`].join('');
}

// ---------- Footer ----------

// Last month's adherence, then one headline: the fitness forecast if the plan covers
// this month, else a record month, else the month's planned totals.
function footer(month, v) {
  const { ctx, all, race } = v;
  const lines = [];
  const now = ctx.now;
  const prev = addMonths(month, -1);
  const prevPlanned = v.workouts.filter((w) => w.date >= prev && w.date <= monthEnd(prev) && (w.date < now || w.done.length));
  if (prevPlanned.length) {
    const done = prevPlanned.filter((w) => w.done.length).length;
    const soFar = monthEnd(prev) >= now ? ' so far' : '';
    lines.push(`${done} of ${prevPlanned.length} planned sessions done${soFar} in ${monthName(prev)}.`);
  }

  const end = monthEnd(month);
  const inMonth = v.workouts.filter((w) => w.date >= month && w.date <= end);
  const ahead = inMonth.filter((w) => w.date >= now);
  const lastPlanned = v.workouts.length ? v.workouts[v.workouts.length - 1].date : null;
  const hours = inMonth.reduce((s, w) => s + w.estimate.minutes, 0) / 60;
  const fitness = all ? ctx.overall : ctx.sports[v.view];
  const fitnessNow = all ? ctx.overall.now : fitness.fitnessNow;

  if (ahead.length && fitnessNow) {
    // Quote month end only when the plan reaches it; otherwise the last planned day.
    const until = lastPlanned >= addDays(end, -7) ? end : lastPlanned;
    let text = `Fitness ${fmt(fitnessNow.fitness)} now, ${fmt(fitness.pointOn(until)?.fitness)} by ${until === end ? 'month end' : shortDate(until)}`;
    if (race && race.date > now && race.date <= addDays(lastPlanned, 7) && (all || race.sport === v.view)) {
      text += all
        ? `; form about ${signed(ctx.overall.pointOn(race.date).form)} on race day`
        : `, ${fmt(fitness.pointOn(race.date).fitness)} on race day`;
    }
    lines.push(`${text}.`);
  } else if (inMonth.length) {
    // Completed months in the cache, by actual hours.
    const first = v.dataFrom === monthStart(v.dataFrom) ? v.dataFrom : addMonths(v.dataFrom, 1);
    const sessions = all ? ctx.everything : ctx.sports[v.view].inSport;
    const months = [];
    for (let m = first; monthEnd(m) < monthStart(now); m = addMonths(m, 1)) {
      months.push(sessions.filter((a) => a.start_date_local.slice(0, 7) === m.slice(0, 7)).reduce((s, a) => s + (a.moving_time || 0) / 3600, 0));
    }
    if (months.length >= 2 && hours > Math.max(...months)) {
      lines.push(`Biggest planned month since ${monthName(first)}: ${fmt(hours, 1)} hours.`);
    } else {
      const noun = v.sport.noun;
      lines.push(`${inMonth.length} ${noun[inMonth.length === 1 ? 0 : 1]}, ${fmt(hours, 1)} hours planned.`);
    }
  }
  return lines.slice(0, 2).map((l) => `<p>${esc(l)}</p>`).join('');
}

// ---------- One page ----------

function page(month, v) {
  const race = nextRace(v.ctx.races, v.all ? null : v.view, month);
  const pv = { ...v, race };
  const first = startOfWeek(month, weekStart);
  const starts = [];
  for (let d = first; d <= monthEnd(month); d = addDays(d, 7)) starts.push(d);
  const dayNames = Array.from({ length: 7 }, (_, i) => weekday(addDays(first, i)));
  const raceLine = race
    ? `<b>${esc(race.name)}</b>${race.sport === v.view ? '' : ` (${SPORTS[race.sport]?.label.toLowerCase() || race.sport})`} · ${longDay(race.date)} · ${fmt(daysBetween(month, race.date))} days from ${shortDate(month)}`
    : '';
  // In All sports, a key to the letters for the sports on this page.
  const shown = [...new Set(v.workouts.filter((w) => w.date.slice(0, 7) === month.slice(0, 7)).map((w) => w.sport))];
  const legend = v.all && shown.length
    ? `<span class="legend">${Object.keys(SPORTS).filter((k) => shown.includes(k)).map((k) => `${letter(k)} ${SPORTS[k].label.toLowerCase()}`).join(' · ')}</span>`
    : '';
  return `<section class="page" aria-label="${monthName(month)} ${month.slice(0, 4)}">
      <header class="page-head">
        <div class="page-title"><h1>${monthName(month)} ${month.slice(0, 4)}</h1><span class="sport">${v.sport.label}</span>${legend}</div>
        <div class="page-race">${raceLine}</div>
      </header>
      <div class="cal" style="grid-template-rows: auto repeat(${starts.length}, 1fr)">
        <div class="cell hd"></div>${dayNames.map((n) => `<div class="cell hd">${n}</div>`).join('')}<div class="cell hd">Week</div>
        ${starts.map((s) => weekCells(s, month, pv)).join('')}
      </div>
      <footer class="page-foot">${footer(month, pv)}</footer>
    </section>`;
}

// ---------- Screen ----------

function render() {
  if (state.data) {
    const keys = [ALL, ...visibleSports(state.data, state.plan)];
    if (!keys.includes(state.sport)) state.sport = ALL;
    $('cal-sport').innerHTML = keys
      .map((k) => `<button type="button" role="radio" data-calsport="${k}" aria-checked="${k === state.sport}">${icon(k)}<span class="label">${k === ALL ? 'All' : SPORTS[k].label}</span></button>`)
      .join('');
  }
  for (const b of document.querySelectorAll('[data-months]')) b.setAttribute('aria-checked', Number(b.dataset.months) === state.months);
  const last = addMonths(state.month, state.months - 1);
  $('month-label').textContent =
    state.months === 1 ? `${monthName(state.month)} ${state.month.slice(0, 4)}` : `${monthName(state.month).slice(0, 3)} – ${monthName(last).slice(0, 3)} ${last.slice(0, 4)}`;

  if (!state.data) {
    $('pages').innerHTML = `<p class="cal-empty">There's no training loaded in this browser yet. Open the <a href="./">dashboard</a> first, then come back to print.</p>`;
    return;
  }
  const ctx = planContext(state.data, state.plan, weekStart);
  const all = state.sport === ALL;
  const v = {
    ctx,
    view: state.sport,
    all,
    sport: viewSport(state.sport),
    workouts: all ? ctx.workouts : ctx.sports[state.sport].workouts,
    dataFrom: state.data.from,
  };
  $('pages').innerHTML = Array.from({ length: state.months }, (_, k) => page(addMonths(state.month, k), v)).join('');
  fit();
}

// The preview shows the printed page scaled to the window, so phones see it whole.
const PAGE_PX = 11 * 96; // the sheet with its 0.4in margins
function fit() {
  const room = document.documentElement.clientWidth - 32;
  $('pages').style.setProperty('--fit', Math.min(1, room / PAGE_PX).toFixed(3));
}

$('cal-sport').addEventListener('click', (e) => {
  const b = e.target.closest('[data-calsport]');
  if (!b) return;
  state.sport = b.dataset.calsport;
  render();
});
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
  render();
}

start();

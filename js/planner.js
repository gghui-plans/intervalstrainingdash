// The Plan view: races, then the week list from the current week on, and the workout
// and race editors. Every sport's workouts show; in a sport tab that sport's come
// first and the week headers carry its verdict. Every change saves, then re-renders
// the whole page so the summary, charts, report and list stay in step.

import { SPORTS } from './config.js';
import { addDays, daysBetween, eachDay, longDay, shortDate, today, weekday } from './dates.js';
import { ALL, visibleSports } from './data.js';
import { icon } from './icons.js';
import {
  PHASES, decodeShare, emptyPlan, encodeShare, estimateLoad, hasTargets, newId, paceClock, paceUnit, parsePace, validatePlan, weeksOut,
} from './plan.js';
import { copyText, download } from './report.js';
import { about, defaultTitle, fmt, phaseCheck, planNotes, planSummary, plural, zoneLabel } from './text.js';
import { $, emphasis, esc, hideNotice, showNotice, toast } from './ui.js';
import * as store from './store.js';

let app; // { state, demo, render } from app.js

export function initPlanner(a) {
  app = a;
  wire();
}

// ---------- Saving ----------

function commit(plan) {
  app.state.plan = plan;
  if (!app.demo && !store.setPlan(plan)) {
    toast("The plan couldn't be saved in this browser (storage full or blocked). Export it to keep a copy.");
  }
  app.render();
}

// Saves, and with a message offers to undo it.
function savePlan(plan, message = '') {
  const before = app.state.plan;
  commit(plan);
  if (message) toast(message, { undo: () => commit(before) });
}

const plan = () => app.state.plan;
const model = () => app.state.model;

// ---------- The week list ----------

const weekDates = (from, to) =>
  from.slice(5, 7) === to.slice(5, 7) ? `${shortDate(from)} – ${+to.slice(8, 10)}` : `${shortDate(from)} – ${shortDate(to)}`;

function weeksOutText(race, from, to) {
  if (!race || race.date < from) return '';
  if (race.date <= to) return 'Race week';
  const n = weeksOut(from, race.date);
  return `${n} week${n === 1 ? '' : 's'} out`;
}

const minutesText = (min) => `${fmt(min)} min`;
const sportOrder = (view) => [...(view === ALL ? [] : [view]), ...Object.keys(SPORTS).filter((k) => k !== view)];

function chipHtml(w, ctx) {
  let status = '';
  let cls = 'chip';
  if (w.key) cls += ' key';
  if (w.done.length) {
    cls += ' done';
    status = '<span class="tick" aria-label="done">✓</span>';
  } else if (w.date < ctx.now) {
    cls += ' missed';
    status = '<span class="missed-mark">missed</span>';
  }
  const label = `${SPORTS[w.sport].label}: ${w.title}`;
  return `<button type="button" class="${cls}" data-workout="${esc(w.id)}" aria-label="${esc(label)}">
      <span class="chip-icon" style="color: var(--sport-${w.sport})">${icon(w.sport)}</span>${status}<span class="chip-text">${esc(w.title || 'Workout')} · ${minutesText(w.estimate.minutes)}</span>
    </button>`;
}

function dayHtml(m, d) {
  const { ctx } = m;
  const order = sportOrder(m.view);
  const workouts = ctx.workouts.filter((w) => w.date === d).sort((a, b) => order.indexOf(a.sport) - order.indexOf(b.sport));
  const rest = ctx.restDays.has(d);
  const items = [
    ...ctx.races.filter((r) => r.date === d).map((r) => `<button type="button" class="race-badge" data-race="${esc(r.id)}">${esc(r.name)} · ${r.priority} race</button>`),
    rest ? `<button type="button" class="chip rest" data-rest="${d}" aria-pressed="true" title="Tap to clear the rest day">Rest day</button>` : '',
    ...workouts.map((w) => chipHtml(w, ctx)),
  ];
  const cls = ['day', d < ctx.now ? 'past' : '', d === ctx.now ? 'today' : ''].filter(Boolean).join(' ');
  const restButton = !workouts.length && !rest ? `<button type="button" class="day-btn" data-rest="${d}" aria-label="Make ${longDay(d)} a rest day">Rest</button>` : '';
  return `<li class="${cls}">
      <span class="day-label"><span class="dow">${weekday(d)}</span> <span class="dom">${+d.slice(8, 10)}</span></span>
      <span class="day-items">${items.join('')}</span>
      <span class="day-actions">${restButton}<button type="button" class="add-day" data-add="${d}" aria-label="Add a workout on ${longDay(d)}">+</button></span>
    </li>`;
}

function weekHtml(m, k) {
  const { ctx, view } = m;
  const from = addDays(ctx.currentStart, 7 * k);
  const w = ctx.week(from, view);
  const title = k === 0 ? 'This week' : k === 1 ? 'Next week' : weekDates(w.from, w.to);
  const sub = [k < 2 ? weekDates(w.from, w.to) : '', weeksOutText(m.nextRace, w.from, w.to)].filter(Boolean).join(' · ');
  const p = w.planned;
  const totals = !p.sessions
    ? 'Nothing planned'
    : m.all
      ? `${fmt(p.hours, 1)} h · ${plural(p.sessions, ['session', 'sessions'])}`
      : `${plural(p.sessions, m.sport.noun)} · ${fmt(p.hours, 1)} h · load ~${about(p.load)}`;
  const check = phaseCheck(w, m.all);
  const tag = check.label ? `<span class="tag ${check.kind}">${check.label}</span>` : '';
  const flags = w.flags.map((f) => `<span class="flag">${f}</span>`).join('');
  const note = check.note ? `<span class="week-note">${esc(check.note)}</span>` : '';
  const open = app.state.weekOpen[from] ?? k < 2;
  const phaseOptions = ['', ...PHASES]
    .map((ph) => `<option value="${ph}"${ph === (w.phase || '') ? ' selected' : ''}>${ph ? ph[0].toUpperCase() + ph.slice(1) : 'No phase'}</option>`)
    .join('');
  return `<details class="plan-week${w.current ? ' current' : ''}" data-week="${from}"${open ? ' open' : ''}>
      <summary class="week-head">
        <span class="week-title"><strong>${title}</strong>${sub ? ` <span class="week-sub">${sub}</span>` : ''}</span>
        <span class="week-totals">${totals}${tag}${flags}</span>
        ${note}
      </summary>
      <div class="week-tools">
        <label class="phase-label">Phase <select class="phase" data-phase="${from}">${phaseOptions}</select></label>
        <button type="button" class="btn btn-quiet btn-small" data-copy-week="${from}">Copy last week</button>
      </div>
      <ul class="days">${eachDay(w.from, w.to).map((d) => dayHtml(m, d)).join('')}</ul>
    </details>`;
}

function racesHtml(m) {
  const { ctx } = m;
  const upcoming = ctx.races.filter((r) => r.date >= ctx.now);
  const pills = upcoming.map((r) => {
    const days = daysBetween(ctx.now, r.date);
    const sport = SPORTS[r.sport] ? ` · ${SPORTS[r.sport].label.toLowerCase()}` : '';
    return `<button type="button" class="race-pill" data-race="${esc(r.id)}"><strong>${esc(r.name)}</strong> · ${r.priority}${sport} · ${longDay(r.date)} · ${days === 0 ? 'today' : `${days} days`}</button>`;
  });
  return `<span class="races-label">Races</span>${pills.join('') || '<span class="races-none">None yet.</span>'}<button type="button" class="btn btn-quiet btn-small" id="add-race">+ Add race</button>`;
}

export function renderPlan(m) {
  const lede = planSummary(m);
  const what = m.all ? '' : ` ${m.sport.label.toLowerCase()}`;
  $('plan-lede').innerHTML = lede ? emphasis(lede) : `Nothing${what} planned yet. Add workouts to see what they do to your fitness.`;
  $('races-line').innerHTML = racesHtml(m);
  const keep = app.demo
    ? 'Demo plan: changes last until you reload.'
    : 'Saved in this browser only. Export it or copy a share link now and then to keep a copy.';
  $('plan-note').innerHTML = [...planNotes(m), keep].map((n) => `<span>${esc(n)}</span>`).join(' ');
  $('print-calendar').href = `calendar.html?${app.demo ? 'demo&' : ''}sport=${m.view}`;
  $('plan-weeks').innerHTML = Array.from({ length: app.state.planWeeks }, (_, k) => weekHtml(m, k)).join('');
}

// ---------- Workout editor ----------

const wf = $('workout-form');
let editing = null; // { id, sport, kind, target } while the workout dialog is open

const DEFAULTS = { minutes: 45, reps: 6, workMin: 3, restMin: 2, warmMin: 15, coolMin: 10 };
const zonesFor = (sport) => model().ctx.sports[sport].zones;

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
  const m = model();
  const w = id ? plan().workouts.find((x) => x.id === id) : null;
  const sport = w?.sport || (m.view !== ALL ? m.view : app.state.lastSport || visibleSports(app.state.data, plan())[0]);
  editing = { id: w?.id || null, sport, kind: w?.kind || 'steady', target: w?.target?.type || 'hrZone' };

  wf.reset();
  $('workout-heading').textContent = w ? 'Edit workout' : 'Add workout';
  $('delete-workout').hidden = !w;
  $('workout-error').hidden = true;
  $('workout-sport').innerHTML = Object.entries(SPORTS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('');
  wf.sport.value = sport;
  wf.date.value = w?.date || date || today();
  wf.title.value = w?.title || '';
  for (const k of Object.keys(DEFAULTS)) wf[k].value = w?.[k] || DEFAULTS[k];
  wf.hr.value = w?.target?.type === 'hr' ? w.target.value : '';
  wf.key.checked = !!w?.key;
  wf.notes.value = w?.notes || '';
  setSport(sport, w);
  $('workout-dialog').showModal();
}

// Zones, pace units and title suggestions follow the workout's sport.
function setSport(sport, w = null) {
  editing.sport = sport;
  const s = SPORTS[sport];
  if (!hasTargets(sport)) editing.kind = 'steady';
  if (editing.target === 'pace' && !s.hasPaceZones) editing.target = 'hrZone';
  const zones = zonesFor(sport);
  wf.zone.innerHTML = zoneOptions(zones.hr);
  wf.zone.value = String(w?.target?.type === 'hrZone' ? w.target.value : 2);
  wf.pace.value = w?.target?.type === 'pace' ? paceClock(w.target.value, zones.pace.units) : '';
  $('pace-unit').textContent = `/${paceUnit(zones.pace.units)}`;
  $('target-toggle').querySelector('[data-target="pace"]').hidden = !s.hasPaceZones;
  const titles = new Set([
    ...plan().workouts.filter((x) => x.sport === sport).map((x) => x.title),
    ...model().ctx.sports[sport].inSport.slice(-30).map((a) => a.name),
  ]);
  $('title-options').innerHTML = [...titles].filter(Boolean).slice(0, 20).map((t) => `<option value="${esc(t)}">`).join('');
  syncWorkoutForm();
}

function syncWorkoutForm() {
  const targets = hasTargets(editing.sport);
  for (const b of document.querySelectorAll('[data-kind]')) b.setAttribute('aria-checked', b.dataset.kind === editing.kind);
  for (const b of document.querySelectorAll('[data-target]')) b.setAttribute('aria-checked', b.dataset.target === editing.target);
  for (const el of wf.querySelectorAll('[data-show]')) {
    const show = el.dataset.show;
    el.hidden = show === 'target' || show === 'kind' ? !targets : show !== editing.kind;
  }
  for (const el of wf.querySelectorAll('[data-show-target]')) el.hidden = el.dataset.showTarget !== editing.target;
  updateEstimate();
}

const num = (input) => (input.value === '' ? 0 : Number(input.value));

// The workout as the form describes it, and what's wrong with it, if anything.
function readWorkout() {
  const kind = editing.kind;
  const zones = zonesFor(editing.sport);
  const w = {
    id: editing.id || newId('w'),
    date: wf.date.value,
    sport: editing.sport,
    kind,
    title: wf.title.value.trim(),
    key: wf.key.checked,
    notes: wf.notes.value.trim(),
    target: null,
  };
  let error = !w.date ? 'Pick a date.' : '';

  if (hasTargets(w.sport)) {
    let value = null;
    if (editing.target === 'hrZone') value = Number(wf.zone.value) || null;
    if (editing.target === 'hr') value = num(wf.hr) >= 60 && num(wf.hr) <= 230 ? num(wf.hr) : null;
    if (editing.target === 'pace') value = parsePace(wf.pace.value, zones.pace.units);
    w.target = value ? { type: editing.target, value } : null;
  }
  if (kind === 'steady') {
    w.minutes = num(wf.minutes);
    if (!error && !(w.minutes > 0)) error = 'Set how many minutes.';
  } else {
    for (const k of ['reps', 'workMin', 'restMin', 'warmMin', 'coolMin']) w[k] = num(wf[k]);
    w.minutes = 0;
    if (!error && !(w.reps > 0 && w.workMin > 0)) error = 'Set the number of reps and how long each one is.';
  }
  if (!error && hasTargets(w.sport) && !w.target) {
    error = editing.target === 'pace' ? 'Set a pace like 4:45.' : editing.target === 'hr' ? 'Set a heart rate in bpm.' : 'Pick a zone.';
  }
  const fallback = defaultTitle(w, zones);
  wf.title.placeholder = fallback;
  if (!w.title) w.title = fallback;
  return { workout: w, error };
}

// "around Z3": the heart-rate or pace zone a target falls in.
function zoneOf(target, zones) {
  if (!target) return '';
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
  const sc = model().ctx.sports[editing.sport];
  const { workout } = readWorkout();
  const est = estimateLoad(workout, sc.zones, sc.calibration);
  const sport = SPORTS[editing.sport].label.toLowerCase();
  const missing = {
    lthr: `No estimate: intervals.icu has no threshold heart rate for ${sport}.`,
    hrZones: `No estimate: intervals.icu has no heart-rate zones for ${sport}.`,
    thresholdPace: `No estimate: intervals.icu has no threshold pace for ${sport}.`,
    target: 'Set a target to see the estimated load.',
    history: `No estimate yet: it comes from your own past ${SPORTS[editing.sport].noun[1]}, and there are fewer than three.`,
  };
  let text;
  if (est.load == null) text = missing[est.missing] || '';
  else {
    const zone = zoneOf(workout.target, sc.zones);
    text = `About ${fmt(est.load)} load · ${fmt(est.minutes)} min${zone ? ` · around ${zone}` : ''}`;
  }
  $('workout-estimate').textContent = text;
}

// ---------- Race editor ----------

const rf = $('race-form');
let editingRace = null; // { id, priority }

function openRace(id) {
  const r = id ? plan().races.find((x) => x.id === id) : null;
  const m = model();
  editingRace = { id: r?.id || null, priority: r?.priority || 'A' };
  rf.reset();
  $('race-heading').textContent = r ? 'Edit race' : 'Add race';
  $('delete-race').hidden = !r;
  $('race-error').hidden = true;
  const tracked = Object.entries(SPORTS).filter(([, s]) => s.tracked !== false);
  $('race-sport').innerHTML = tracked.map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('');
  rf.name.value = r?.name || '';
  rf.date.value = r?.date || '';
  rf.sport.value = r?.sport || (m.view !== ALL ? m.view : visibleSports(app.state.data, plan())[0]);
  syncRaceForm();
  $('race-dialog').showModal();
}

function syncRaceForm() {
  for (const b of document.querySelectorAll('[data-priority]')) b.setAttribute('aria-checked', b.dataset.priority === editingRace.priority);
}

// ---------- Plan actions ----------

const workoutsText = (n) => `${n} workout${n === 1 ? '' : 's'}`;
const planCounts = (p) => `${workoutsText(p.workouts.length)} and ${p.races.length} race${p.races.length === 1 ? '' : 's'}`;

// Adds the week before's workouts and rest days, every sport, to the same weekdays.
function copyLastWeek(from) {
  const p = plan();
  const prevFrom = addDays(from, -7);
  const source = p.workouts.filter((w) => w.date >= prevFrom && w.date < from);
  const rest = p.restDays.filter((d) => d >= prevFrom && d < from).map((d) => addDays(d, 7));
  if (!source.length && !rest.length) return toast('Nothing was planned the week before to copy.');
  const copies = source.map((w) => ({ ...w, id: newId('w'), date: addDays(w.date, 7) }));
  savePlan(
    { ...p, workouts: [...p.workouts, ...copies], restDays: [...new Set([...p.restDays, ...rest])].sort() },
    `Copied ${workoutsText(copies.length)} from the week before.`,
  );
}

function toggleRest(d) {
  const days = new Set(plan().restDays);
  if (days.has(d)) days.delete(d);
  else days.add(d);
  savePlan({ ...plan(), restDays: [...days].sort() });
}

function setPhase(from, phase) {
  const weekPhases = { ...plan().weekPhases };
  if (phase) weekPhases[from] = phase;
  else delete weekPhases[from];
  savePlan({ ...plan(), weekPhases });
}

async function sharePlan() {
  const value = await encodeShare(plan());
  const url = `${location.origin}${location.pathname}${location.search}#plan=${value}`;
  const ok = await copyText(url);
  toast(ok ? `Share link copied. It carries ${planCounts(plan())}.` : "Couldn't copy the link. Use Export plan instead.");
}

// A plan arriving in a share link: in demo it simply replaces the sample; otherwise
// ask before replacing the saved plan. The hash is removed either way.
export async function receiveSharedPlan() {
  const match = location.hash.match(/^#plan=(.+)$/);
  if (!match) return;
  history.replaceState(null, '', location.pathname + location.search);
  const { plan: shared, error } = await decodeShare(match[1]);
  if (error) return showNotice(error);
  if (app.demo) {
    app.state.plan = shared;
    return toast(`Showing the shared plan: ${planCounts(shared)}.`);
  }
  app.state.sharedPlan = shared;
  const done = () => {
    app.state.sharedPlan = null;
    hideNotice();
  };
  showNotice(`This link carries a plan with ${planCounts(shared)}.`, [
    { label: 'Use this plan', onClick: () => (done(), savePlan(shared, 'Using the shared plan.')) },
    { label: 'Keep mine', onClick: done },
  ]);
}

// ---------- Events ----------

function wire() {
  $('add-workout').addEventListener('click', () => model() && openWorkout(null));
  $('more-weeks').addEventListener('click', () => {
    app.state.planWeeks += 4;
    renderPlan(model());
  });
  $('races-line').addEventListener('click', (e) => {
    const el = e.target.closest('[data-race], #add-race');
    if (!el || !model()) return;
    openRace(el.dataset.race || null);
  });

  const weeks = $('plan-weeks');
  weeks.addEventListener('click', (e) => {
    const el = e.target.closest('[data-workout], [data-add], [data-race], [data-copy-week], [data-rest]');
    if (!el || !model()) return;
    if (el.dataset.workout) openWorkout(el.dataset.workout);
    else if (el.dataset.add) openWorkout(null, el.dataset.add);
    else if (el.dataset.race) openRace(el.dataset.race);
    else if (el.dataset.rest) toggleRest(el.dataset.rest);
    else copyLastWeek(el.dataset.copyWeek);
  });
  weeks.addEventListener('change', (e) => {
    if (e.target.dataset.phase != null) setPhase(e.target.dataset.phase, e.target.value);
  });
  // Remember which weeks are open across re-renders. toggle doesn't bubble, so listen while capturing.
  weeks.addEventListener('toggle', (e) => (app.state.weekOpen[e.target.dataset.week] = e.target.open), true);

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
    download(JSON.stringify(plan(), null, 2), `training-plan-${today()}.json`, 'application/json;charset=utf-8'));
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
    savePlan(result.plan, `Plan imported: ${planCounts(result.plan)}.`);
  });
  $('share-plan').addEventListener('click', sharePlan);
  $('delete-plan').addEventListener('click', () => {
    const p = plan();
    if (!p.workouts.length && !p.races.length && !p.restDays.length) return toast('There is no plan to delete.');
    if (!confirm(`Delete the whole plan, ${planCounts(p)}, for every sport?`)) return;
    savePlan(emptyPlan(), 'Plan deleted.');
  });

  // Workout dialog
  wf.sport.addEventListener('change', () => setSport(wf.sport.value));
  for (const b of document.querySelectorAll('[data-kind]')) {
    b.addEventListener('click', () => {
      editing.kind = b.dataset.kind;
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
    const p = plan();
    app.state.lastSport = workout.sport;
    store.setPrefs({ lastSport: workout.sport });
    $('workout-dialog').close();
    // A workout on a rest day means it isn't one any more.
    savePlan({
      ...p,
      workouts: [...p.workouts.filter((w) => w.id !== workout.id), workout],
      restDays: p.restDays.filter((d) => d !== workout.date),
    });
  });
  $('cancel-workout').addEventListener('click', () => $('workout-dialog').close());
  $('delete-workout').addEventListener('click', () => {
    const p = plan();
    const w = p.workouts.find((x) => x.id === editing.id);
    $('workout-dialog').close();
    savePlan({ ...p, workouts: p.workouts.filter((x) => x.id !== editing.id) }, `Deleted ${w?.title || 'the workout'}.`);
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
    savePlan({ ...plan(), races: [...plan().races.filter((r) => r.id !== race.id), race] });
  });
  $('cancel-race').addEventListener('click', () => $('race-dialog').close());
  $('delete-race').addEventListener('click', () => {
    const r = plan().races.find((x) => x.id === editingRace.id);
    $('race-dialog').close();
    savePlan({ ...plan(), races: plan().races.filter((x) => x.id !== editingRace.id) }, `Deleted ${r?.name || 'the race'}.`);
  });
}

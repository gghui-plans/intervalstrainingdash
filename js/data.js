// Turns cached intervals.icu data and the local plan into the model the dashboard,
// report and calendar share. A view is one sport, or 'all' for every sport together:
// weekly rollups, the previous period, fitness/fatigue/form, zones and the plan.

import { DAILY_MAX_DAYS, FATIGUE_DAYS, FITNESS_DAYS, SPORTS, WARMUP_DAYS } from './config.js';
import { addDays, daysBetween, eachDay, startOfWeek, today } from './dates.js';
import { CALIBRATION_DAYS, calibrate, estimateLoad, forecast, nextRace, weekVerdict } from './plan.js';

export const ALL = 'all';

// The All sports view, shaped like an entry in SPORTS.
const ALL_SPORTS = { label: 'All sports', noun: ['session', 'sessions'], types: [], hasPaceZones: false };
export const viewSport = (view) => (view === ALL ? ALL_SPORTS : SPORTS[view]);

const dateOf = (a) => (a.start_date_local || '').slice(0, 10);
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

// Which sport an activity belongs to, or 'other' for types no sport lists.
export const sportOf = (a) => Object.keys(SPORTS).find((k) => SPORTS[k].types.includes(a.type)) || 'other';

// Sports with a tab: tracked sports this athlete has done or planned. Someone with no
// history yet sees them all.
export function visibleSports(data, plan) {
  const tracked = Object.keys(SPORTS).filter((k) => SPORTS[k].tracked !== false);
  const used = tracked.filter(
    (k) =>
      data.activities.some((a) => SPORTS[k].types.includes(a.type)) ||
      plan.workouts.some((w) => w.sport === k) ||
      plan.races.some((r) => r.sport === k),
  );
  return used.length ? used : tracked;
}

// The full window to fetch for a range: warm-up, previous period, then the range.
// It always runs to today, which the plan's calibration and forecast start from.
export function fetchWindow(range) {
  const days = daysBetween(range.from, range.to) + 1;
  const now = today();
  return { from: addDays(range.from, -days - WARMUP_DAYS), to: range.to > now ? range.to : now };
}

export function previousPeriod(range) {
  // A calendar week compares with the same weekdays of the week before.
  if (range.calendar) return { from: addDays(range.from, -7), to: addDays(range.to, -7) };
  const days = daysBetween(range.from, range.to) + 1;
  const to = addDays(range.from, -1);
  return { from: addDays(to, -(days - 1)), to };
}

// Seven-day blocks ending on the last day of the range. If the range isn't a whole
// number of weeks, the first block is short; three days or fewer fold into the next
// block rather than standing as a misleadingly small bar. Either way it's marked partial.
function weekBlocks(from, to) {
  const blocks = [];
  for (let end = to; end >= from; end = addDays(end, -7)) {
    const start = addDays(end, -6) < from ? from : addDays(end, -6);
    blocks.unshift({ from: start, to: end, days: daysBetween(start, end) + 1 });
  }
  if (blocks.length > 1 && blocks[0].days <= 3) {
    const [short, next] = blocks.splice(0, 2);
    blocks.unshift({ from: short.from, to: next.to, days: short.days + next.days });
  }
  return blocks.map((b) => ({ ...b, partial: b.days !== 7 }));
}

function addSecs(into, secs) {
  (secs || []).forEach((s, i) => (into[i] = (into[i] || 0) + (s || 0)));
}

function rollup(activities, zoneCounts) {
  const r = {
    sessions: activities.length,
    distanceKm: 0,
    hours: 0,
    load: 0,
    hrSecs: new Array(zoneCounts.hr).fill(0),
    paceSecs: new Array(zoneCounts.pace).fill(0),
    hoursWithHr: 0,
    bySport: {}, // sessions, hours and load per sport, for the All sports view
  };
  for (const a of activities) {
    const hours = (a.moving_time || 0) / 3600;
    r.distanceKm += (a.distance || 0) / 1000;
    r.hours += hours;
    r.load += a.icu_training_load || 0;
    addSecs(r.hrSecs, a.icu_hr_zone_times);
    addSecs(r.paceSecs, a.pace_zone_times);
    if (a.icu_hr_zone_times?.some((s) => s > 0)) r.hoursWithHr += hours;
    const s = (r.bySport[sportOf(a)] ||= { sessions: 0, hours: 0, load: 0 });
    s.sessions += 1;
    s.hours += hours;
    s.load += a.icu_training_load || 0;
  }
  const hrTotal = r.hrSecs.reduce((s, x) => s + x, 0);
  r.hrTotalSecs = hrTotal;
  r.easyShare = hrTotal ? (r.hrSecs[0] + (r.hrSecs[1] || 0)) / hrTotal : null;
  r.dominantZone = hrTotal ? r.hrSecs.indexOf(Math.max(...r.hrSecs)) : null;
  r.paceTotalSecs = r.paceSecs.reduce((s, x) => s + x, 0);
  return r;
}

// The sport-settings block in intervals.icu that applies to this sport.
// A sport with no settings block of its own falls under intervals.icu's "Other"
// block, which is what intervals.icu itself uses for its zones and load.
function settingsFor(sportSettings, sport) {
  const matches = sportSettings.filter((s) => (s.types || []).some((t) => sport.types.includes(t)));
  const own = matches.find((s) => s.types.includes(sport.types[0])) || matches[0];
  if (own) return { settings: own, fallback: false };
  const other = sportSettings.find((s) => (s.types || []).includes('Other'));
  return { settings: other || null, fallback: !!other };
}

function zoneInfo({ settings, fallback }, sport, activities) {
  const dataHr = Math.max(0, ...activities.map((a) => a.icu_hr_zone_times?.length || 0));
  const dataPace = Math.max(0, ...activities.map((a) => a.pace_zone_times?.length || 0));
  const hrBounds = settings?.hr_zones || [];
  const pacePcts = settings?.pace_zones || [];
  const hrCount = Math.max(hrBounds.length, dataHr);
  const paceCount = sport.hasPaceZones ? Math.max(pacePcts.length, dataPace) : 0;
  const names = (given, n) => Array.from({ length: n }, (_, i) => given?.[i] || '');
  return {
    settingsFound: !!settings,
    usesOther: fallback,
    hr: {
      ok: hrBounds.length > 0,
      count: hrCount,
      names: names(settings?.hr_zone_names, hrCount),
      bounds: hrBounds, // upper bpm of each zone
      lthr: settings?.lthr,
      maxHr: settings?.max_hr,
    },
    pace: {
      ok: sport.hasPaceZones && pacePcts.length > 0 && !!settings?.threshold_pace,
      count: paceCount,
      names: names(settings?.pace_zone_names, paceCount),
      pcts: pacePcts, // upper bound of each zone, % of threshold speed
      thresholdPace: settings?.threshold_pace,
      units: settings?.pace_units,
    },
  };
}

// All sports together: each session's time counts in its own sport's zones, so the
// zones are numbered but not named.
function mixedZones(activities) {
  const count = Math.max(0, ...activities.map((a) => a.icu_hr_zone_times?.length || 0));
  return {
    settingsFound: true,
    usesOther: false,
    mixed: true,
    hr: { ok: count > 0, count, names: new Array(count).fill(''), bounds: [] },
    pace: { ok: false, count: 0, names: [], pcts: [] },
  };
}

// Fitness (long-term) and fatigue (short-term) as exponentially weighted averages of
// daily intervals.icu load. Form is fitness minus fatigue.
function fitnessSeries(activities, from, to) {
  const loadByDay = {};
  for (const a of activities) loadByDay[dateOf(a)] = (loadByDay[dateOf(a)] || 0) + (a.icu_training_load || 0);
  const kFit = Math.exp(-1 / FITNESS_DAYS);
  const kFat = Math.exp(-1 / FATIGUE_DAYS);
  let fitness = 0;
  let fatigue = 0;
  const out = [];
  for (const d of eachDay(from, to)) {
    const load = loadByDay[d] || 0;
    fitness = fitness * kFit + load * (1 - kFit);
    fatigue = fatigue * kFat + load * (1 - kFat);
    out.push({ date: d, fitness, fatigue, form: fitness - fatigue });
  }
  return out;
}

// All-sports fitness as intervals.icu reports it (wellness), so the numbers match
// what you see there. Days without a wellness record use the same sum of every sport.
function overallSeries(data, everything, to) {
  const computed = fitnessSeries(everything, data.from, to);
  const wellness = Object.fromEntries(data.wellness.filter((w) => w.ctl != null).map((w) => [w.id, w]));
  return computed.map((p) => {
    const w = wellness[p.date];
    return w ? { date: p.date, fitness: w.ctl, fatigue: w.atl, form: w.ctl - w.atl } : p;
  });
}

// Days ahead the fitness forecast runs by default, and how far it stretches to reach
// an A race.
const FORECAST_DAYS = 14;
const RACE_REACH_DAYS = 56;

// Every activity with data: Strava placeholders carry nothing, so they're left out.
const allActivities = (data) =>
  data.activities.filter((a) => !a._note && a.type).sort((a, b) => (a.start_date_local < b.start_date_local ? -1 : 1));

// One sport's plan: each workout's estimated load and what was done that day,
// calibration, and fitness from its own sessions, projected through its plan.
function sportContext(data, key, plan, now) {
  const sport = SPORTS[key];
  const inSport = allActivities(data).filter((a) => sport.types.includes(a.type));
  const recent = inSport.filter((a) => dateOf(a) > addDays(now, -CALIBRATION_DAYS));
  const zones = zoneInfo(settingsFor(data.athlete.sportSettings, sport), sport, recent);
  const calibration = calibrate(inSport, zones, sport, now);

  const doneOn = {};
  for (const a of inSport) (doneOn[dateOf(a)] ||= []).push(a);

  const workouts = plan.workouts
    .filter((w) => w.sport === key)
    .sort(byDate)
    .map((w) => ({ ...w, estimate: estimateLoad(w, zones, calibration), done: doneOn[w.date] || [] }));

  // A workout planned for today is still to come until a session of this sport is recorded today.
  const pendingToday = !doneOn[now];
  const ahead = (d) => d > now || (d === now && pendingToday);
  const plannedByDay = {};
  for (const w of workouts) {
    if (ahead(w.date) && w.estimate.load) plannedByDay[w.date] = (plannedByDay[w.date] || 0) + w.estimate.load;
  }

  const actual = fitnessSeries(inSport, data.from, now);
  const actualOn = Object.fromEntries(actual.map((p) => [p.date, p]));
  const forecastFrom = pendingToday ? now : addDays(now, 1);
  const project = projector(actualOn[addDays(forecastFrom, -1)] || null, plannedByDay, forecastFrom);
  const pointOn = (d) => (d < forecastFrom ? actualOn[d] || null : project.on(d));

  return {
    key,
    sport,
    inSport,
    zones,
    calibration,
    workouts,
    doneOn,
    pendingToday,
    ahead,
    plannedByDay,
    actualOn,
    forecastFrom,
    projectTo: project.to,
    pointOn,
    fitnessNow: actualOn[now] || null,
  };
}

// A forecast that extends itself as later days are asked for.
function projector(start, loads, from) {
  let points = [];
  const to = (end) => {
    if (end >= from && (!points.length || points[points.length - 1].date < end)) points = forecast(start, loads, from, end);
    return points.filter((p) => p.date <= end);
  };
  return { to, on: (d) => to(d).find((p) => p.date === d) || null };
}

// Everything the plan needs, shared by the dashboard and the calendar: a context per
// sport, the all-sports fitness and forecast that fatigue and form come from, and a
// summary for any calendar week, for one sport or all of them.
export function planContext(data, plan, weekStart, now = today()) {
  const sports = Object.fromEntries(Object.keys(SPORTS).map((k) => [k, sportContext(data, k, plan, now)]));
  const workouts = Object.values(sports).flatMap((s) => s.workouts).sort(byDate);
  const restDays = new Set(plan.restDays || []);
  const everything = allActivities(data);
  const doneOn = {};
  for (const a of everything) (doneOn[dateOf(a)] ||= []).push(a);
  const currentStart = startOfWeek(now, weekStart);
  const ahead = (w) => sports[w.sport].ahead(w.date);

  // All sports: history from intervals.icu, then today's recorded load plus every
  // sport's plan still to come.
  const history = overallSeries(data, everything, now);
  const historyOn = Object.fromEntries(history.map((p) => [p.date, p]));
  const loads = {};
  for (const s of Object.values(sports)) for (const [d, l] of Object.entries(s.plannedByDay)) loads[d] = (loads[d] || 0) + l;
  loads[now] = (loads[now] || 0) + (doneOn[now] || []).reduce((t, a) => t + (a.icu_training_load || 0), 0);
  const project = projector(historyOn[addDays(now, -1)] || null, loads, now);
  const overall = {
    history,
    now: historyOn[now] || null,
    projectTo: project.to,
    pointOn: (d) => (d < now ? historyOn[d] || null : project.on(d)),
  };

  const inRange = (list, from, to) => list.filter((x) => (x.date || dateOf(x)) >= from && (x.date || dateOf(x)) <= to);
  const loadOf = (list) => list.reduce((t, a) => t + (a.icu_training_load || 0), 0);
  const hoursOf = (list) => list.reduce((t, a) => t + (a.moving_time || 0) / 3600, 0);
  const totals = (list) => ({
    sessions: list.length,
    hours: list.reduce((t, w) => t + w.estimate.minutes, 0) / 60,
    load: list.reduce((t, w) => t + (w.estimate.load || 0), 0),
    unestimated: list.filter((w) => w.estimate.load == null).length,
  });
  const bySport = (list) => {
    const out = {};
    for (const w of list) (out[w.sport] ||= []).push(w);
    return Object.fromEntries(Object.entries(out).map(([k, l]) => [k, totals(l)]));
  };

  // A week's load for one sport: recorded for past weeks, planned for future ones,
  // and for the current week what's done so far plus what's still to come.
  function weekLoad(s, from) {
    const to = addDays(from, 6);
    if (to < now) return loadOf(inRange(s.inSport, from, to));
    return loadOf(inRange(s.inSport, from, now)) + inRange(s.workouts, from, to).filter((w) => s.ahead(w.date)).reduce((t, w) => t + (w.estimate.load || 0), 0);
  }
  const baselineBefore = (s, from) =>
    [1, 2, 3, 4].reduce((t, k) => t + loadOf(inRange(s.inSport, addDays(from, -7 * k), addDays(from, -7 * k + 6))), 0) / 4;

  // view: a sport key, or ALL.
  function week(from, view = ALL) {
    const to = addDays(from, 6);
    const past = to < now;
    const current = from <= now && now <= to;
    const s = view === ALL ? null : sports[view];
    const list = inRange(s ? s.workouts : workouts, from, to);
    const doneList = inRange(s ? s.inSport : everything, from, to < now ? to : now);
    const done = { sessions: doneList.length, hours: hoursOf(doneList), load: loadOf(doneList), km: doneList.reduce((t, a) => t + (a.distance || 0) / 1000, 0) };
    const planned = totals(list);
    const toCome = totals(list.filter(ahead));
    const end = overall.pointOn(to); // fatigue and form are all-sports
    const base = {
      from,
      to,
      past,
      current,
      planned,
      done,
      toCome,
      bySport: bySport(list),
      others: s ? bySport(inRange(workouts, from, to).filter((w) => w.sport !== view)) : {},
      restDays: eachDay(from, to).filter((d) => restDays.has(d)),
      sessions: past ? done.sessions : current ? done.sessions + toCome.sessions : planned.sessions,
      hours: past ? done.hours : current ? done.hours + toCome.hours : planned.hours,
      formEnd: end?.form ?? null,
      phase: plan.weekPhases?.[from] || null,
    };
    if (!s) {
      return {
        ...base,
        load: past ? done.load : current ? done.load + toCome.load : planned.load,
        fitnessStart: overall.pointOn(addDays(from, -1))?.fitness ?? null,
        fitnessEnd: end?.fitness ?? null,
        flags: end && end.form < -30 ? ['high fatigue'] : [],
      };
    }
    const load = weekLoad(s, from);
    const lastWeek = weekLoad(s, addDays(from, -7));
    const baseline = baselineBefore(s, from < currentStart ? from : currentStart);
    return {
      ...base,
      load,
      lastWeek,
      baseline,
      ...weekVerdict({ load, baseline, lastWeek, formEnd: end?.form }),
      fitnessStart: s.pointOn(addDays(from, -1))?.fitness ?? null,
      fitnessEnd: s.pointOn(to)?.fitness ?? null,
    };
  }

  const races = [...plan.races].sort(byDate);
  // The race the view counts down to, and the forecast's reach: two weeks, or on to
  // the next A race (this sport's, or any in All sports) if it's within eight weeks.
  function outlook(view) {
    const race = nextRace(races, view === ALL ? null : view, now);
    const targetA = races.find((r) => r.priority === 'A' && r.date >= now && (view === ALL || r.sport === view));
    let horizon = addDays(now, FORECAST_DAYS);
    if (targetA && targetA.date > horizon && daysBetween(now, targetA.date) <= RACE_REACH_DAYS) horizon = targetA.date;
    // Race-day numbers only when the race's sport is planned to within a week of it;
    // otherwise they'd mostly show fitness fading over unplanned weeks.
    let atRace = null;
    if (race && race.date > now && race.date <= horizon && SPORTS[race.sport]) {
      const rs = sports[race.sport];
      const last = rs.workouts.length ? rs.workouts[rs.workouts.length - 1].date : null;
      if (last && last >= addDays(race.date, -7)) {
        atRace = { fitnessNow: rs.fitnessNow?.fitness ?? null, fitness: rs.pointOn(race.date)?.fitness ?? null, form: overall.pointOn(race.date)?.form ?? null };
      }
    }
    return { race, horizon, atRace };
  }

  return {
    now,
    weekStart,
    currentStart,
    sports,
    workouts,
    restDays,
    races,
    weekPhases: plan.weekPhases || {},
    everything,
    doneOn,
    overall,
    ahead,
    week,
    outlook,
  };
}

export function buildModel(data, view, range, ctx) {
  const all = view === ALL;
  const sport = viewSport(view);
  const sc = all ? null : ctx.sports[view];
  const prev = previousPeriod(range);
  const list = all ? ctx.everything : sc.inSport;
  const within = (l, r) => l.filter((a) => dateOf(a) >= r.from && dateOf(a) <= r.to);

  const current = within(list, range);
  const before = within(list, prev);
  const zones = all ? mixedZones([...current, ...before]) : zoneInfo(settingsFor(data.athlete.sportSettings, sport), sport, [...current, ...before]);
  const counts = { hr: zones.hr.count, pace: zones.pace.count };

  // Total training time across every sport, as context for the selected one.
  const allHours = (r) => within(ctx.everything, r).reduce((s, a) => s + (a.moving_time || 0) / 3600, 0);
  const withAll = (l) => (w) => ({ ...w, ...rollup(within(l, w), counts), allHours: allHours(w) });

  // Bars are weeks, or days for short ranges. They're called weeks throughout.
  // A calendar week charts all seven days (chartTo), with the days still to come
  // empty, against the whole of the week before. Totals stay on equal days.
  const chartTo = range.chartTo || range.to;
  const prevChartTo = addDays(prev.from, daysBetween(range.from, chartTo));
  const grain = daysBetween(range.from, chartTo) + 1 <= DAILY_MAX_DAYS ? 'day' : 'week';
  const blocks = (from, to) =>
    grain === 'day' ? eachDay(from, to).map((d) => ({ from: d, to: d, days: 1, partial: false })) : weekBlocks(from, to);

  // Planned load on the bars still to come (the 1-week tab's later days).
  const viewWorkouts = all ? ctx.workouts : sc.workouts;
  const plannedOn = (from, to) => {
    const l = viewWorkouts.filter((w) => w.date >= from && w.date <= to && ctx.ahead(w));
    return {
      plannedLoad: l.reduce((s, w) => s + (w.estimate.load || 0), 0),
      plannedSessions: l.length,
      plannedHours: l.reduce((s, w) => s + w.estimate.minutes, 0) / 60,
    };
  };
  const pending = (d) => d > ctx.now || (d === ctx.now && (all ? !ctx.doneOn[d] : sc.pendingToday));
  const withPlan = (w) => (grain === 'day' && pending(w.from) ? { ...w, ...plannedOn(w.from, w.to) } : w);

  const weeks = blocks(range.from, chartTo)
    .map(withAll(current))
    .map((w) => withPlan({ ...w, future: w.from > range.to }));
  const prevWeeks = blocks(prev.from, prevChartTo).map(withAll(within(list, { from: prev.from, to: prevChartTo })));

  // Daily points for the line view's "By day" option, shaped like the weekly ones.
  const days = eachDay(range.from, chartTo)
    .map((d) => ({ from: d, to: d, days: 1, partial: false }))
    .map(withAll(current))
    .map((w) => ({ ...w, future: w.from > range.to }));

  const history = all ? ctx.overall.history : eachDay(data.from, ctx.now).map((d) => sc.actualOn[d]).filter(Boolean);
  const fitness = history.filter((p) => p.date >= range.from && p.date <= range.to);
  const fitnessAtPrevEnd = history.find((p) => p.date === prev.to) || null;

  // Activity types no sport lists: counted in All sports, noted elsewhere.
  const otherTypes = {};
  if (!all) {
    for (const a of within(ctx.everything, range)) {
      if (sportOf(a) === 'other') otherTypes[a.type] = (otherTypes[a.type] || 0) + 1;
    }
  }

  // Weekly charts that end today get up to two calendar weeks of plan after the range.
  const endsToday = range.to === ctx.now;
  let plannedWeeks = [];
  let plannedDays = [];
  if (grain === 'week' && endsToday) {
    plannedWeeks = [1, 2].map((k) => {
      const from = addDays(ctx.currentStart, 7 * k);
      return { from, to: addDays(from, 6), days: 7, label: k === 1 ? 'Next week' : 'Week after', ...plannedOn(from, addDays(from, 6)) };
    });
    while (plannedWeeks.length && !plannedWeeks[plannedWeeks.length - 1].plannedSessions) plannedWeeks.pop();
    if (plannedWeeks.length) {
      plannedDays = eachDay(addDays(ctx.now, 1), plannedWeeks[plannedWeeks.length - 1].to)
        .map((d) => ({ from: d, to: d, days: 1, ...plannedOn(d, d) }));
    }
  }

  // The plan's workouts in the range, shaped for the report's "Planned vs actual" table.
  const planned = viewWorkouts
    .filter((w) => w.date >= range.from && w.date <= range.to)
    .map((w) => ({
      name: w.title,
      sport: w.sport,
      start_date_local: `${w.date}T00:00:00`,
      moving_time: w.estimate.minutes * 60,
      icu_training_load: w.estimate.load,
      description: w.notes || '',
      done: w.done,
      workout: w,
    }));

  const { race, horizon, atRace } = ctx.outlook(view);
  const forecastPoints = (all ? ctx.overall.projectTo(horizon) : sc.projectTo(horizon)).filter((p) => p.date > ctx.now);

  return {
    view,
    sportKey: view, // the view, kept under its old name for the report and file names
    all,
    grain,
    days,
    sport,
    range: { ...range, days: daysBetween(range.from, range.to) + 1 },
    prev,
    weeks,
    prevWeeks,
    totals: { ...rollup(current, counts), allHours: allHours(range) },
    prevTotals: { ...rollup(before, counts), allHours: allHours(prev) },
    hasDistance: !all && [...current, ...before].some((a) => a.distance > 0),
    fitness,
    fitnessAtPrevEnd,
    overallNow: ctx.overall.now, // all-sports fitness, fatigue and form today
    overallEnd: range.to >= ctx.now ? ctx.overall.now : ctx.overall.pointOn(range.to), // and at the end of the range
    zones,
    activities: current,
    planned,
    plan: {
      workouts: viewWorkouts,
      races: all ? ctx.races : ctx.races.filter((r) => r.sport === view),
    },
    calibration: sc?.calibration || null,
    forecast: { to: horizon, points: forecastPoints },
    // Forecast days the fitness chart continues into: to the end of the week on the
    // 1-week tab, otherwise the whole forecast. Only when the range ends today.
    forecastShown: endsToday ? forecastPoints.filter((p) => !range.calendar || p.date <= chartTo) : [],
    nextRace: race,
    atRace,
    thisWeek: ctx.week(ctx.currentStart, view),
    nextWeek: ctx.week(addDays(ctx.currentStart, 7), view),
    plannedWeeks,
    plannedDays,
    today: ctx.now,
    weekStart: ctx.weekStart,
    ctx,
    otherTypes,
    // Activities synced from Strava come back from the API without data.
    unavailable: within(data.activities, range).filter((a) => a._note || (!a.type && a.source === 'STRAVA')).length,
  };
}

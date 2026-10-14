// Turns cached intervals.icu data into the model that the dashboard and report share:
// weekly rollups for one sport, the previous period, fitness/fatigue/form, and zones.

import { DAILY_MAX_DAYS, FATIGUE_DAYS, FITNESS_DAYS, SPORTS, WARMUP_DAYS } from './config.js';
import { addDays, daysBetween, eachDay, startOfWeek, today } from './dates.js';
import { CALIBRATION_DAYS, calibrate, estimateLoad, forecast, nextRace, weekVerdict } from './plan.js';

const dateOf = (a) => (a.start_date_local || '').slice(0, 10);

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
  };
  for (const a of activities) {
    r.distanceKm += (a.distance || 0) / 1000;
    r.hours += (a.moving_time || 0) / 3600;
    r.load += a.icu_training_load || 0;
    addSecs(r.hrSecs, a.icu_hr_zone_times);
    addSecs(r.paceSecs, a.pace_zone_times);
    if (a.icu_hr_zone_times?.some((s) => s > 0)) r.hoursWithHr += (a.moving_time || 0) / 3600;
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

// Fitness (long-term) and fatigue (short-term) as exponentially weighted averages of
// this sport's daily intervals.icu load. Form is fitness minus fatigue.
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

export function sportsPresent(data, range) {
  const counts = {};
  for (const [key, sport] of Object.entries(SPORTS)) {
    counts[key] = data.activities.filter(
      (a) => sport.types.includes(a.type) && dateOf(a) >= range.from && dateOf(a) <= range.to,
    ).length;
  }
  return counts;
}

const sportActivities = (data, sport) =>
  data.activities
    .filter((a) => sport.types.includes(a.type))
    .sort((a, b) => (a.start_date_local < b.start_date_local ? -1 : 1));

// Days ahead the fitness forecast runs by default, and how far it stretches to reach
// an A race.
const FORECAST_DAYS = 14;
const RACE_REACH_DAYS = 56;

// Everything the plan needs for one sport, shared by the dashboard and the calendar:
// each workout's estimated load and what was done that day, calibration, the
// fitness forecast from today, and a summary for any calendar week.
export function planContext(data, sportKey, plan, weekStart, now = today()) {
  const sport = SPORTS[sportKey];
  const inSport = sportActivities(data, sport);
  const recent = inSport.filter((a) => dateOf(a) > addDays(now, -CALIBRATION_DAYS));
  const zones = zoneInfo(settingsFor(data.athlete.sportSettings, sport), sport, recent);
  const calibration = calibrate(inSport, zones, sport, now);

  const doneOn = {};
  for (const a of inSport) (doneOn[dateOf(a)] ||= []).push(a);

  const workouts = plan.workouts
    .filter((w) => w.sport === sportKey)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((w) => ({ ...w, estimate: estimateLoad(w, zones, calibration), done: doneOn[w.date] || [] }));
  const races = plan.races.filter((r) => r.sport === sportKey).sort((a, b) => (a.date < b.date ? -1 : 1));

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
  const startPoint = actualOn[addDays(forecastFrom, -1)] || null;
  let projected = [];
  const projectTo = (to) => {
    if (to >= forecastFrom && (!projected.length || projected[projected.length - 1].date < to)) {
      projected = forecast(startPoint, plannedByDay, forecastFrom, to);
    }
    return projected.filter((p) => p.date <= to);
  };
  // Fitness on any day: recorded up to the forecast, projected after it.
  const pointOn = (d) => (d < forecastFrom ? actualOn[d] || null : projectTo(d).find((p) => p.date === d) || null);

  const inWeek = (list, from, to) => list.filter((x) => (x.date || dateOf(x)) >= from && (x.date || dateOf(x)) <= to);
  const actualLoad = (from, to) => inWeek(inSport, from, to).reduce((s, a) => s + (a.icu_training_load || 0), 0);
  const currentStart = startOfWeek(now, weekStart);

  // A week's load: recorded for past weeks, planned for future ones, and for the
  // current week what's done so far plus what's still to come.
  const weekLoad = (from) => {
    const to = addDays(from, 6);
    if (to < now) return actualLoad(from, to);
    const toCome = inWeek(workouts, from, to).filter((w) => ahead(w.date));
    return actualLoad(from, now) + toCome.reduce((s, w) => s + (w.estimate.load || 0), 0);
  };
  const baselineBefore = (from) => [1, 2, 3, 4].reduce((s, k) => s + actualLoad(addDays(from, -7 * k), addDays(from, -7 * k + 6)), 0) / 4;

  const totals = (list) => ({
    sessions: list.filter((w) => w.kind !== 'rest').length,
    hours: list.reduce((s, w) => s + w.estimate.minutes, 0) / 60,
    load: list.reduce((s, w) => s + (w.estimate.load || 0), 0),
    unestimated: list.filter((w) => w.kind !== 'rest' && w.estimate.load == null).length,
  });

  function week(from) {
    const to = addDays(from, 6);
    const own = inWeek(workouts, from, to);
    const doneList = inWeek(inSport, from, to < now ? to : now);
    const done = {
      sessions: doneList.length,
      hours: doneList.reduce((s, a) => s + (a.moving_time || 0) / 3600, 0),
      load: actualLoad(from, to),
      km: doneList.reduce((s, a) => s + (a.distance || 0) / 1000, 0),
    };
    const planned = totals(own);
    const toCome = totals(own.filter((w) => ahead(w.date)));
    const past = to < now;
    const current = from <= now && now <= to;
    const load = weekLoad(from);
    const lastWeek = weekLoad(addDays(from, -7));
    const end = pointOn(to);
    const baseline = baselineBefore(from < currentStart ? from : currentStart);
    return {
      from,
      to,
      past,
      current,
      sessions: past ? done.sessions : current ? done.sessions + toCome.sessions : planned.sessions,
      hours: past ? done.hours : current ? done.hours + toCome.hours : planned.hours,
      load,
      planned,
      done,
      toCome,
      lastWeek,
      baseline,
      ...weekVerdict({ load, baseline, lastWeek, formEnd: end?.form }),
      fitnessStart: pointOn(addDays(from, -1))?.fitness ?? null,
      fitnessEnd: end?.fitness ?? null,
      formEnd: end?.form ?? null,
      phase: plan.weekPhases?.[from] || null,
    };
  }

  const race = nextRace(plan.races, sportKey, now);
  // The forecast runs two weeks ahead, or on to this sport's next A race if it's within eight weeks.
  const ownA = races.find((r) => r.priority === 'A' && r.date >= now);
  let horizon = addDays(now, FORECAST_DAYS);
  if (ownA && ownA.date > horizon && daysBetween(now, ownA.date) <= RACE_REACH_DAYS) horizon = ownA.date;
  const points = projectTo(horizon).filter((p) => p.date > now);
  const raceForecast = race && race.sport === sportKey && race.date > now && race.date <= horizon ? pointOn(race.date) : null;

  return {
    sport,
    zones,
    calibration,
    workouts,
    races,
    nextRace: race,
    now,
    currentStart,
    pendingToday,
    ahead,
    fitnessNow: actualOn[now] || null,
    forecast: { from: forecastFrom, to: horizon, points, atRace: raceForecast },
    plannedByDay,
    projectTo,
    pointOn,
    week,
  };
}

export function buildModel(data, sportKey, range, plan, prefs = {}) {
  const sport = SPORTS[sportKey];
  const prev = previousPeriod(range);
  const inSport = sportActivities(data, sport);
  const ctx = planContext(data, sportKey, plan, prefs.weekStart ?? 1);
  const within = (list, r) => list.filter((a) => dateOf(a) >= r.from && dateOf(a) <= r.to);

  const current = within(inSport, range);
  const before = within(inSport, prev);
  const zones = zoneInfo(settingsFor(data.athlete.sportSettings, sport), sport, [...current, ...before]);
  const counts = { hr: zones.hr.count, pace: zones.pace.count };

  // Total training time across every sport, as context for the selected one.
  // Strava placeholders carry no time, so they're left out.
  const everything = data.activities.filter((a) => !a._note);
  const allHours = (r) => within(everything, r).reduce((s, a) => s + (a.moving_time || 0) / 3600, 0);
  const withAll = (list) => (w) => ({ ...w, ...rollup(within(list, w), counts), allHours: allHours(w) });

  // Bars are weeks, or days for short ranges. They're called weeks throughout.
  // A calendar week charts all seven days (chartTo), with the days still to come
  // empty, against the whole of the week before. Totals stay on equal days.
  const chartTo = range.chartTo || range.to;
  const prevChartTo = addDays(prev.from, daysBetween(range.from, chartTo));
  const grain = daysBetween(range.from, chartTo) + 1 <= DAILY_MAX_DAYS ? 'day' : 'week';
  const blocks = (from, to) =>
    grain === 'day' ? eachDay(from, to).map((d) => ({ from: d, to: d, days: 1, partial: false })) : weekBlocks(from, to);

  // Planned load on the bars still to come (the 1-week tab's later days).
  const plannedOn = (from, to) => {
    const list = ctx.workouts.filter((w) => w.date >= from && w.date <= to && ctx.ahead(w.date));
    return {
      plannedLoad: list.reduce((s, w) => s + (w.estimate.load || 0), 0),
      plannedSessions: list.filter((w) => w.kind !== 'rest').length,
      plannedHours: list.reduce((s, w) => s + w.estimate.minutes, 0) / 60,
    };
  };
  const withPlan = (w) => (grain === 'day' && ctx.ahead(w.from) ? { ...w, ...plannedOn(w.from, w.to) } : w);

  const weeks = blocks(range.from, chartTo)
    .map(withAll(current))
    .map((w) => withPlan({ ...w, future: w.from > range.to }));
  const prevWeeks = blocks(prev.from, prevChartTo).map(withAll(within(inSport, { from: prev.from, to: prevChartTo })));

  // Daily points for the line view's "By day" option, shaped like the weekly ones.
  const days = eachDay(range.from, chartTo)
    .map((d) => ({ from: d, to: d, days: 1, partial: false }))
    .map(withAll(current))
    .map((w) => ({ ...w, future: w.from > range.to }));

  const fitnessAll = fitnessSeries(inSport, data.from, range.to);
  const fitness = fitnessAll.filter((p) => p.date >= range.from);
  const fitnessAtPrevEnd = fitnessAll.find((p) => p.date === prev.to) || null;

  const wellnessInRange = data.wellness.filter((w) => w.id >= range.from && w.id <= range.to && w.ctl != null);
  const lastWellness = wellnessInRange[wellnessInRange.length - 1] || null;

  const otherTypes = {};
  for (const a of within(data.activities, range)) {
    if (!a._note && !Object.values(SPORTS).some((s) => s.types.includes(a.type))) {
      const t = a.type || 'Unknown';
      otherTypes[t] = (otherTypes[t] || 0) + 1;
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

  // The local plan's workouts in the range, shaped for the report's "Planned vs actual" table.
  const planned = ctx.workouts
    .filter((w) => w.kind !== 'rest' && w.date >= range.from && w.date <= range.to)
    .map((w) => ({
      name: w.title,
      start_date_local: `${w.date}T00:00:00`,
      moving_time: w.estimate.minutes * 60,
      icu_training_load: w.estimate.load,
      description: w.notes || '',
      done: w.done,
      workout: w,
    }));

  return {
    sportKey,
    grain,
    days,
    sport,
    range: { ...range, days: daysBetween(range.from, range.to) + 1 },
    prev,
    weeks,
    prevWeeks,
    totals: { ...rollup(current, counts), allHours: allHours(range) },
    prevTotals: { ...rollup(before, counts), allHours: allHours(prev) },
    fitness,
    fitnessAtPrevEnd,
    allSports: lastWellness && {
      date: lastWellness.id,
      fitness: lastWellness.ctl,
      fatigue: lastWellness.atl,
      form: lastWellness.ctl - lastWellness.atl,
    },
    zones,
    activities: current,
    planned,
    plan: { workouts: ctx.workouts, races: ctx.races },
    calibration: ctx.calibration,
    forecast: ctx.forecast,
    fitnessNow: ctx.fitnessNow,
    nextRace: ctx.nextRace,
    thisWeek: ctx.week(ctx.currentStart),
    nextWeek: ctx.week(addDays(ctx.currentStart, 7)),
    plannedWeeks,
    plannedDays,
    today: ctx.now,
    weekStart: prefs.weekStart ?? 1,
    planContext: ctx, // for the plan section's week list
    otherTypes,
    // Activities synced from Strava come back from the API without data.
    unavailable: within(data.activities, range).filter((a) => a._note || (!a.type && a.source === 'STRAVA')).length,
  };
}

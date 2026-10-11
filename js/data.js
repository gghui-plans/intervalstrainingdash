// Turns cached intervals.icu data into the model that the dashboard and report share:
// weekly rollups for one sport, the previous period, fitness/fatigue/form, and zones.

import { DAILY_MAX_DAYS, FATIGUE_DAYS, FITNESS_DAYS, SPORTS, WARMUP_DAYS } from './config.js';
import { addDays, daysBetween, eachDay } from './dates.js';

const dateOf = (a) => (a.start_date_local || '').slice(0, 10);

// The full window to fetch for a range: warm-up, previous period, then the range.
export function fetchWindow(range) {
  const days = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -days - WARMUP_DAYS), to: range.to };
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

export function buildModel(data, sportKey, range) {
  const sport = SPORTS[sportKey];
  const prev = previousPeriod(range);
  const inSport = data.activities
    .filter((a) => sport.types.includes(a.type))
    .sort((a, b) => (a.start_date_local < b.start_date_local ? -1 : 1));
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
  const weeks = blocks(range.from, chartTo)
    .map(withAll(current))
    .map((w) => ({ ...w, future: w.from > range.to }));
  const prevWeeks = blocks(prev.from, prevChartTo).map(withAll(within(inSport, { from: prev.from, to: prevChartTo })));

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

  const planned = data.planned
    .filter((e) => sport.types.includes(e.type) && dateOf(e) >= range.from && dateOf(e) <= range.to)
    .sort((a, b) => (a.start_date_local < b.start_date_local ? -1 : 1))
    .map((e) => ({ ...e, done: current.filter((a) => dateOf(a) === dateOf(e)) }));

  return {
    sportKey,
    grain,
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
    otherTypes,
    // Activities synced from Strava come back from the API without data.
    unavailable: within(data.activities, range).filter((a) => a._note || (!a.type && a.source === 'STRAVA')).length,
  };
}

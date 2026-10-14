// The training plan: estimated load for planned workouts, the calibration that keeps
// those estimates in line with intervals.icu, the fitness forecast, weekly verdicts,
// race countdowns, and the plan's file and share-link formats. Pure functions only:
// no DOM and no storage, so the page, the report and the calendar all share them.

import { FATIGUE_DAYS, FITNESS_DAYS, SPORTS } from './config.js';
import { addDays, daysBetween, eachDay } from './dates.js';

// 'steady' is shown as "Continuous". Rest is a day (restDays), not a workout; plans
// saved before that held rest as a workout kind, which normalizePlan converts.
export const KINDS = ['steady', 'intervals'];
export const TARGETS = ['hrZone', 'hr', 'pace'];
export const PHASES = ['base', 'build', 'peak', 'taper', 'recovery'];

export const emptyPlan = () => ({ version: 1, workouts: [], races: [], restDays: [], weekPhases: {} });

// Fills defaults and turns old rest workouts into rest days.
export function normalizePlan(plan) {
  const rest = (plan.workouts || []).filter((w) => w.kind === 'rest').map((w) => w.date);
  return {
    version: 1,
    workouts: (plan.workouts || []).filter((w) => w.kind !== 'rest'),
    races: plan.races || [],
    restDays: [...new Set([...(plan.restDays || []), ...rest])].sort(),
    weekPhases: plan.weekPhases || {},
  };
}

// Whether a sport is planned with heart-rate or pace targets (strength isn't).
export const hasTargets = (sportKey) => SPORTS[sportKey]?.targets !== false;

export const newId = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 7)}`;

// ---------- Planned load ----------

// Intensity as a fraction of threshold. The fixed parts of an interval session
// (warm-up, cool-down, recoveries) are easy whatever the target.
const WARM_INTENSITY = 0.65;
const RECOVERY_INTENSITY = 0.6;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// The bpm in the middle of heart-rate zone `zone` (1-based). Bounds are the upper bpm
// of each zone; the first zone starts at 55% of threshold, and the open-ended top
// zone counts as 5 bpm above the zone below it.
export function zoneMidHr(zone, hr) {
  const b = hr.bounds || [];
  const i = zone - 1;
  if (!hr.lthr || i < 0 || i >= b.length) return null;
  const lower = i === 0 ? 0.55 * hr.lthr : b[i - 1] + 1;
  if (i === b.length - 1 && i > 0) return b[i - 1] + 5;
  return (lower + b[i]) / 2;
}

// What the target needs from intervals.icu that isn't there, or null.
export function missingFor(target, zones) {
  if (!target) return null;
  if (target.type === 'pace') return zones.pace.thresholdPace ? null : 'thresholdPace';
  if (!zones.hr.lthr) return 'lthr';
  if (target.type === 'hrZone' && !zones.hr.bounds?.length) return 'hrZones';
  return null;
}

// Intensity of a target as a fraction of threshold, or null when a setting is missing.
export function intensity(target, zones) {
  if (!target || missingFor(target, zones)) return null;
  let x;
  if (target.type === 'hr') x = target.value / zones.hr.lthr;
  else if (target.type === 'hrZone') x = zoneMidHr(target.value, zones.hr) / zones.hr.lthr;
  else x = target.value / zones.pace.thresholdPace; // both are speeds in m/s
  return Number.isFinite(x) ? clamp(x, 0.3, 1.3) : null;
}

const segmentLoad = (minutes, i) => (minutes / 60) * i * i * 100;

export function workoutMinutes(w) {
  if (w.kind === 'rest') return 0;
  if (w.kind === 'intervals') {
    return (w.warmMin || 0) + (w.coolMin || 0) + (w.reps || 0) * ((w.workMin || 0) + (w.restMin || 0));
  }
  return w.minutes || 0;
}

// Which calibration factor a target uses: heart-rate zones scale like heart rate.
const factorType = (target) => (target?.type === 'pace' ? 'pace' : 'hr');

// Estimated load for one planned workout: the time at each intensity, as
// hours × intensity² × 100 (an hour at threshold is 100), scaled by the athlete's
// calibration factor. load is null when intervals.icu lacks a needed setting.
// Sports without targets (strength) use your own average load per hour instead.
export function estimateLoad(w, zones, calibration = null) {
  const minutes = workoutMinutes(w);
  if (w.kind === 'rest') return { load: 0, minutes: 0, intensity: null, calibrated: true, missing: null };
  if (!hasTargets(w.sport)) {
    const ph = calibration?.perHour;
    return ph?.calibrated
      ? { load: (minutes / 60) * ph.value, minutes, intensity: null, calibrated: true, missing: null }
      : { load: null, minutes, intensity: null, calibrated: false, missing: 'history' };
  }
  const missing = missingFor(w.target, zones) || (w.target ? null : 'target');
  const i = intensity(w.target, zones);
  if (i == null) return { load: null, minutes, intensity: null, calibrated: false, missing };
  let raw = segmentLoad(minutes, i);
  if (w.kind === 'intervals') {
    raw =
      segmentLoad((w.warmMin || 0) + (w.coolMin || 0), WARM_INTENSITY) +
      segmentLoad((w.reps || 0) * (w.workMin || 0), i) +
      segmentLoad((w.reps || 0) * (w.restMin || 0), RECOVERY_INTENSITY);
  }
  const cal = calibration?.[factorType(w.target)];
  return { load: raw * (cal?.factor ?? 1), minutes, intensity: i, calibrated: !!cal?.calibrated, missing: null };
}

// ---------- Calibration ----------

export const CALIBRATION_DAYS = 90;
const CALIBRATION_MIN = 5;

// How the formula compares with intervals.icu's own load on the athlete's recent
// sessions of this sport. factor = Σ actual / Σ estimate (a ratio of sums, so one odd
// session barely moves it), clamped to [0.6, 1.6]. Unscaled below five sessions.
export function calibrate(activities, zones, sport, today) {
  const from = addDays(today, -(CALIBRATION_DAYS - 1));
  const usable = activities.filter((a) => {
    const d = (a.start_date_local || '').slice(0, 10);
    return d >= from && d <= today && a.icu_training_load > 0 && a.moving_time > 0;
  });
  const ratio = (pairs) => {
    const est = pairs.reduce((s, p) => s + p.est, 0);
    const act = pairs.reduce((s, p) => s + p.act, 0);
    const calibrated = pairs.length >= CALIBRATION_MIN && est > 0;
    return { factor: calibrated ? clamp(act / est, 0.6, 1.6) : 1, n: pairs.length, calibrated };
  };
  const hours = (a) => a.moving_time / 3600;
  const lthr = zones.hr.lthr;
  const tp = zones.pace.thresholdPace;
  const hr = lthr
    ? usable
        .filter((a) => a.average_heartrate > 0)
        .map((a) => ({ est: hours(a) * (a.average_heartrate / lthr) ** 2 * 100, act: a.icu_training_load }))
    : [];
  const pace = sport.hasPaceZones && tp
    ? usable
        .filter((a) => a.distance > 0)
        .map((a) => ({ est: hours(a) * (a.distance / a.moving_time / tp) ** 2 * 100, act: a.icu_training_load }))
    : [];
  // Load per hour, for sports planned by duration alone. Three sessions is enough.
  const hrs = usable.reduce((t, a) => t + hours(a), 0);
  const perHour = {
    value: hrs ? usable.reduce((t, a) => t + a.icu_training_load, 0) / hrs : 0,
    n: usable.length,
    calibrated: usable.length >= 3 && hrs > 0,
  };
  return { hr: ratio(hr), pace: ratio(pace), perHour };
}

// ---------- Forecast ----------

// Continues fitness and fatigue from `start` (the last real day) through the planned
// daily loads, with the same 42- and 7-day averages as the charts.
export function forecast(start, plannedLoadByDay, from, to) {
  const kFit = Math.exp(-1 / FITNESS_DAYS);
  const kFat = Math.exp(-1 / FATIGUE_DAYS);
  let fitness = start?.fitness || 0;
  let fatigue = start?.fatigue || 0;
  return eachDay(from, to).map((date) => {
    const plannedLoad = plannedLoadByDay[date] || 0;
    fitness = fitness * kFit + plannedLoad * (1 - kFit);
    fatigue = fatigue * kFat + plannedLoad * (1 - kFat);
    return { date, fitness, fatigue, form: fitness - fatigue, plannedLoad };
  });
}

// ---------- Weekly verdict ----------

export const FATIGUE_FLOOR = -30;

// A week's load against the mean of the last four completed weeks. lastWeek is the
// week before this one (actual, or projected for a week still under way).
export function weekVerdict({ load, baseline, lastWeek, formEnd }) {
  const ratio = baseline > 0 ? load / baseline : null;
  const verdict = ratio == null ? 'first weeks' : ratio > 1.1 ? 'build' : ratio < 0.9 ? 'recover' : 'maintain';
  const flags = [];
  if ((ratio != null && ratio > 1.3) || (lastWeek > 0 && load > 1.3 * lastWeek)) flags.push('big jump');
  if (formEnd != null && formEnd < FATIGUE_FLOOR) flags.push('high fatigue');
  return { ratio, verdict, flags };
}

// ---------- Races ----------

// The race to count down to: the next A race of this sport, else the next A race of
// any sport, else the next B race (this sport first).
export function nextRace(races, sportKey, today) {
  const ahead = races.filter((r) => r.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1));
  const race =
    ahead.find((r) => r.priority === 'A' && r.sport === sportKey) ||
    ahead.find((r) => r.priority === 'A') ||
    ahead.find((r) => r.sport === sportKey) ||
    ahead[0];
  return race ? { ...race, days: daysBetween(today, race.date) } : null;
}

export const weeksOut = (weekStart, raceDate) => Math.ceil(daysBetween(weekStart, raceDate) / 7);

// ---------- Pace ----------

const paceMetres = (units) => (units === 'MINS_MILE' ? 1609.344 : 1000);
export const paceUnit = (units) => (units === 'MINS_MILE' ? 'mi' : 'km');

// "4:45" per km (or mile) to a speed in m/s, or null if it doesn't parse.
export function parsePace(text, units) {
  const m = String(text).trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return null;
  const secs = +m[1] * 60 + +m[2];
  return secs > 0 ? paceMetres(units) / secs : null;
}

// A speed in m/s as "4:45" (no unit).
export function paceClock(speed, units) {
  const secs = Math.round(paceMetres(units) / speed);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

// ---------- File and share-link formats ----------

const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

// Checks an imported plan. Returns { plan } with defaults filled in, or { error }.
export function validatePlan(obj) {
  if (!obj || typeof obj !== 'object') return { error: 'That file is not a training plan.' };
  if (obj.version !== 1) return { error: 'That plan was saved by a different version of this page.' };
  if (!Array.isArray(obj.workouts) || !Array.isArray(obj.races)) return { error: 'That file is not a training plan.' };
  for (const w of obj.workouts) {
    const ok =
      w && isDate(w.date) && SPORTS[w.sport] && [...KINDS, 'rest'].includes(w.kind) && typeof w.title === 'string' &&
      (w.kind === 'rest' || !hasTargets(w.sport) || (w.target && TARGETS.includes(w.target.type) && isNum(w.target.value)));
    if (!ok) return { error: `A workout in that file is incomplete (${w?.date || 'no date'}).` };
  }
  for (const r of obj.races) {
    const ok = r && isDate(r.date) && SPORTS[r.sport] && typeof r.name === 'string' && ['A', 'B'].includes(r.priority);
    if (!ok) return { error: `A race in that file is incomplete (${r?.date || 'no date'}).` };
  }
  const phases = obj.weekPhases && typeof obj.weekPhases === 'object' ? obj.weekPhases : {};
  return {
    plan: normalizePlan({
      workouts: obj.workouts.map((w) => ({
        notes: '', key: false, ...w, id: typeof w.id === 'string' ? w.id : newId('w'), target: hasTargets(w.sport) && w.kind !== 'rest' ? w.target : null,
      })),
      races: obj.races.map((r) => ({ ...r, id: typeof r.id === 'string' ? r.id : newId('r') })),
      restDays: Array.isArray(obj.restDays) ? obj.restDays.filter(isDate) : [],
      weekPhases: Object.fromEntries(Object.entries(phases).filter(([d, p]) => isDate(d) && PHASES.includes(p))),
    }),
  };
}

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

// The plan as the value of a share link's hash: "z.<data>" when the browser can
// compress (deflate-raw), "u.<data>" otherwise. A month of workouts is a few kB.
export async function encodeShare(plan) {
  const json = JSON.stringify({ v: 1, w: plan.workouts, r: plan.races, d: plan.restDays, p: plan.weekPhases });
  const bytes = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'function') {
    return 'z.' + toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
  }
  return 'u.' + toBase64Url(bytes);
}

// The reverse of encodeShare. Returns { plan } or { error }.
export async function decodeShare(value) {
  try {
    const [kind, data] = [value.slice(0, 2), value.slice(2)];
    let bytes = fromBase64Url(data);
    if (kind === 'z.') {
      if (typeof DecompressionStream !== 'function') {
        return { error: 'This browser is too old to open that plan link. Ask for the plan file instead.' };
      }
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    } else if (kind !== 'u.') {
      throw new Error('unknown');
    }
    const o = JSON.parse(new TextDecoder().decode(bytes));
    return validatePlan({ version: o.v, workouts: o.w, races: o.r, restDays: o.d, weekPhases: o.p });
  } catch {
    return { error: 'That plan link is damaged or incomplete.' };
  }
}

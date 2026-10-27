// Browser-only persistence: credentials, UI preferences, the cached API data and the
// training plan. Nothing here is ever sent anywhere except the API key to intervals.icu.

import { fetchActivities, fetchAthlete, fetchWellness } from './api.js';
import { REFRESH_HOURS } from './config.js';
import { today } from './dates.js';
import { emptyPlan, normalizePlan } from './plan.js';

const KEYS = { creds: 'tdash.creds', prefs: 'tdash.prefs', cache: 'tdash.cache' };
// Outside KEYS so "Forget key and data" leaves the plan alone; it has its own delete.
const PLAN_KEY = 'tdash.plan';

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // storage full or blocked: the app still works for this visit
  }
}

export const getCreds = () => read(KEYS.creds);
export const setCreds = (creds) => write(KEYS.creds, creds);
export const getPrefs = () => read(KEYS.prefs) || {};
export const setPrefs = (patch) => write(KEYS.prefs, { ...getPrefs(), ...patch });

// The plan lives only in this browser; intervals.icu stays read-only. setPlan returns
// false when the browser refuses the write, so the page can say it wasn't saved.
export function getPlan() {
  const plan = read(PLAN_KEY);
  return plan ? normalizePlan(plan) : emptyPlan();
}
export const setPlan = (plan) => write(PLAN_KEY, plan);

export function clearAll() {
  for (const key of Object.values(KEYS)) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }
  memoryCache = null;
}

// Only the fields the app uses are kept, so a year of activities fits in localStorage.
const ACTIVITY_FIELDS = [
  'id', 'start_date_local', 'type', 'name', 'distance', 'moving_time', 'elapsed_time',
  'icu_training_load', 'icu_hr_zone_times', 'pace_zone_times', 'average_heartrate', 'source', '_note',
];
const SPORT_SETTING_FIELDS = [
  'types', 'hr_zones', 'hr_zone_names', 'pace_zones', 'pace_zone_names', 'pace_units',
  'threshold_pace', 'lthr', 'max_hr',
];

const pick = (obj, fields) =>
  Object.fromEntries(fields.filter((f) => obj[f] !== undefined).map((f) => [f, obj[f]]));

let memoryCache = null;

export const getCache = () => memoryCache || read(KEYS.cache);

// Returns cached data covering [from, to], fetching from intervals.icu when the cache
// is missing, stale, for another athlete, or too short. One request per endpoint
// covers the whole window, so toggling sport or range never refetches.
export async function ensureData(creds, from, to, { force = false } = {}) {
  const cache = getCache();
  const fresh =
    cache && Date.now() - cache.fetchedAt < REFRESH_HOURS * 3600 * 1000 && cache.fetchedOn === today();
  const sameAthlete = cache && cache.athleteId === creds.athleteId;
  const covers = cache && cache.from <= from && cache.to >= to;
  if (!force && fresh && sameAthlete && covers) return cache;

  const oldest = sameAthlete && cache.from < from ? cache.from : from;
  const newest = sameAthlete && cache.to > to ? cache.to : to;

  const [athlete, activities, wellness] = await Promise.all([
    fetchAthlete(creds),
    fetchActivities(creds, oldest, newest),
    fetchWellness(creds, oldest, newest),
  ]);

  const data = {
    athleteId: creds.athleteId,
    from: oldest,
    to: newest,
    fetchedAt: Date.now(),
    fetchedOn: today(),
    athlete: {
      name: athlete.name || athlete.firstname || '',
      sportSettings: (athlete.sportSettings || []).map((s) => pick(s, SPORT_SETTING_FIELDS)),
    },
    activities: activities.map((a) => pick(a, ACTIVITY_FIELDS)),
    wellness: wellness.map((w) => ({ id: w.id, ctl: w.ctl, atl: w.atl })),
  };
  memoryCache = data;
  write(KEYS.cache, data);
  return data;
}

// Demo mode bypasses the API entirely.
export function useData(data) {
  memoryCache = data;
}

// Plan only: someone who chose to plan without connecting intervals.icu. A saved key
// always wins, so connecting later simply brings the numbers in.
export const isPlanOnly = () => !getCreds() && !!getPrefs().planOnly;

// No training at all, shaped like the cache so the plan and calendar code run unchanged.
export const planOnlyData = () => ({
  planOnly: true,
  athleteId: null,
  from: today(),
  to: today(),
  fetchedAt: Date.now(),
  fetchedOn: today(),
  athlete: { name: '', sportSettings: [] },
  activities: [],
  wellness: [],
});

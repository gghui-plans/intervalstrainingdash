// Browser-only persistence: credentials, UI preferences and the cached API data.
// Nothing here is ever sent anywhere except the API key to intervals.icu.

import { fetchActivities, fetchAthlete, fetchPlanned, fetchWellness } from './api.js';
import { REFRESH_HOURS } from './config.js';
import { today } from './dates.js';

const KEYS = { creds: 'tdash.creds', prefs: 'tdash.prefs', cache: 'tdash.cache' };

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
const EVENT_FIELDS = [
  'id', 'start_date_local', 'type', 'name', 'description', 'moving_time', 'distance',
  'icu_training_load', 'load_target', 'time_target', 'distance_target',
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

  const [athlete, activities, wellness, planned] = await Promise.all([
    fetchAthlete(creds),
    fetchActivities(creds, oldest, newest),
    fetchWellness(creds, oldest, newest),
    fetchPlanned(creds, oldest, newest),
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
    planned: planned.map((e) => pick(e, EVENT_FIELDS)),
  };
  memoryCache = data;
  write(KEYS.cache, data);
  return data;
}

// Demo mode bypasses the API entirely.
export function useData(data) {
  memoryCache = data;
}

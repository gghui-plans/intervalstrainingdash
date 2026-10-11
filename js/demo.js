// Synthetic data for ?demo, shaped like the intervals.icu API responses. Lets anyone
// see the dashboard without an account, and lets layout work happen offline.

import { addDays, eachDay, today } from './dates.js';

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function splitZones(totalSecs, weights) {
  const sum = weights.reduce((s, w) => s + w, 0);
  return weights.map((w) => Math.round((totalSecs * w) / sum));
}

export function makeDemoData() {
  const rand = rng(42);
  const end = today();
  const from = addDays(end, -400);
  const activities = [];
  const planned = [];
  let id = 1;

  for (const d of eachDay(from, end)) {
    const dow = new Date(d + 'T12:00:00Z').getUTCDay(); // 0 Sunday
    const build = 0.8 + 0.4 * (eachDay(from, d).length / 400); // volume grows over the year

    const runDays = { 0: 'Long run', 1: 'Easy run', 3: 'Intervals', 5: 'Easy run', 6: 'Steady run' };
    if (runDays[dow] && rand() > 0.15) {
      const kind = runDays[dow];
      const km = { 'Long run': 18, 'Easy run': 8, Intervals: 10, 'Steady run': 12 }[kind] * build * (0.85 + rand() * 0.3);
      const secs = Math.round(km * (kind === 'Intervals' ? 300 : 335));
      const hard = kind === 'Intervals' ? [8, 20, 10, 18, 16, 10, 3] : kind === 'Steady run' ? [10, 45, 30, 10, 3, 0, 0] : [25, 65, 8, 2, 0, 0, 0];
      activities.push({
        id: `d${id++}`,
        start_date_local: `${d}T07:${String(10 + Math.floor(rand() * 40)).padStart(2, '0')}:00`,
        type: 'Run',
        name: kind,
        distance: Math.round(km * 1000),
        moving_time: secs,
        elapsed_time: secs + 120,
        icu_training_load: Math.round((secs / 3600) * (kind === 'Intervals' ? 85 : kind === 'Steady run' ? 65 : 52)),
        icu_hr_zone_times: splitZones(secs, hard),
        pace_zone_times: splitZones(secs, hard.map((w, i) => (i < 2 ? w * 1.1 : w))),
        average_heartrate: kind === 'Intervals' ? 162 : kind === 'Steady run' ? 152 : 141,
        source: 'GARMIN_CONNECT',
      });
    }

    if ((dow === 2 || dow === 4) && rand() > 0.2) {
      const km = 10 * build * (0.8 + rand() * 0.4);
      const secs = Math.round((km / 8.5) * 3600);
      const type = rand() > 0.7 ? 'Canoeing' : 'Kayaking';
      activities.push({
        id: `d${id++}`,
        start_date_local: `${d}T18:05:00`,
        type,
        name: dow === 2 ? 'Paddle intervals' : 'Easy paddle',
        distance: Math.round(km * 1000),
        moving_time: secs,
        elapsed_time: secs + 300,
        icu_training_load: Math.round((secs / 3600) * (dow === 2 ? 70 : 48)),
        icu_hr_zone_times: splitZones(secs, dow === 2 ? [15, 35, 25, 18, 7] : [40, 50, 9, 1, 0]),
        average_heartrate: dow === 2 ? 148 : 132,
        source: 'GARMIN_CONNECT',
      });
    }

    if (dow === 6 && rand() > 0.6) {
      activities.push({
        id: `d${id++}`, start_date_local: `${d}T15:00:00`, type: 'Ride', name: 'Commute',
        distance: 14000, moving_time: 2700, icu_training_load: 25, source: 'GARMIN_CONNECT',
      });
    }
  }

  // A Strava-synced activity comes back as a stub with a note.
  activities.push({
    id: `d${id++}`, start_date_local: `${addDays(end, -5)}T06:30:00`, source: 'STRAVA',
    _note: 'STRAVA activities are not available via the API',
  });

  // Planned runs for the last two weeks.
  for (const d of eachDay(addDays(end, -13), end)) {
    const dow = new Date(d + 'T12:00:00Z').getUTCDay();
    const plan = {
      0: ['Long run 20 km', 6600, 20000, 95, 'Easy, last 3 km at marathon effort'],
      3: ['6 × 800 m', 3600, 11000, 80, 'Warm up 2 km\n6 × 800 m at 5 km pace, 400 m jog\nCool down'],
      5: ['Easy 8 km', 2700, 8000, 40, ''],
    }[dow];
    if (plan) {
      planned.push({
        id: id++, start_date_local: `${d}T00:00:00`, type: 'Run', name: plan[0],
        moving_time: plan[1], distance: plan[2], icu_training_load: plan[3], description: plan[4],
      });
    }
  }

  // All-sports fitness and fatigue, as intervals.icu's wellness records carry them.
  const wellness = [];
  let ctl = 30;
  let atl = 30;
  for (const d of eachDay(from, end)) {
    const load = activities.filter((a) => a.start_date_local?.startsWith(d)).reduce((s, a) => s + (a.icu_training_load || 0), 0);
    ctl = ctl * Math.exp(-1 / 42) + load * (1 - Math.exp(-1 / 42));
    atl = atl * Math.exp(-1 / 7) + load * (1 - Math.exp(-1 / 7));
    wellness.push({ id: d, ctl, atl });
  }

  return {
    athleteId: 'demo',
    from,
    to: end,
    fetchedAt: Date.now(),
    fetchedOn: end,
    athlete: {
      name: 'Demo Athlete',
      sportSettings: [
        {
          types: ['Run', 'VirtualRun', 'TrailRun'],
          hr_zones: [138, 154, 160, 171, 176, 181, 190],
          hr_zone_names: ['Recovery', 'Aerobic', 'Tempo', 'SubThreshold', 'SuperThreshold', 'Aerobic Capacity', 'Anaerobic'],
          pace_zones: [77.5, 87.7, 94.3, 100, 103.4, 111.5, 999],
          pace_zone_names: ['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4', 'Zone 5a', 'Zone 5b', 'Zone 5c'],
          pace_units: 'MINS_KM',
          threshold_pace: 3.7,
          lthr: 171,
          max_hr: 190,
        },
        {
          types: ['Kayaking', 'Canoeing', 'StandUpPaddling', 'Rowing'],
          hr_zones: [130, 145, 158, 168, 185],
          hr_zone_names: ['Easy', 'Aerobic', 'Tempo', 'Threshold', 'Max'],
          lthr: 165,
          max_hr: 185,
        },
      ],
    },
    activities,
    wellness,
    planned,
  };
}

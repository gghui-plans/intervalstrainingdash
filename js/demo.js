// Synthetic data for ?demo, shaped like the intervals.icu API responses. Lets anyone
// see the dashboard without an account, and lets layout work happen offline.

import { addDays, eachDay, startOfWeek, today } from './dates.js';

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
  };
}

// A sample plan for ?demo, held in memory only. Four weeks from the current one
// (build, build, recovery, build): runs on Monday, Wednesday, Friday and Sunday,
// paddles on Tuesday and Thursday, Saturday off. Volumes are set so the weekly
// verdicts come out build, build, recover, build against the demo history.
export function makeDemoPlan(weekStart = 1) {
  const monday = startOfWeek(today(), 1);
  const workouts = [];
  const weekPhases = {};
  const scale = [1, 1.08, 0.68, 1.15];
  const phases = ['build', 'build', 'recovery', 'build'];
  let n = 0;
  const add = (date, w) => workouts.push({ id: `w_demo${n++}`, date, key: false, notes: '', ...w });

  scale.forEach((s, k) => {
    const day = (dow) => addDays(monday, k * 7 + dow); // 0 Monday … 6 Sunday
    const mins = (m) => Math.round((m * s) / 5) * 5;
    const reps = Math.max(3, Math.round(6 * s));
    weekPhases[startOfWeek(day(0), weekStart)] = phases[k];

    add(day(0), { sport: 'running', kind: 'steady', title: 'Easy run', minutes: mins(55), target: { type: 'hrZone', value: 2 } });
    add(day(1), {
      sport: 'paddling', kind: 'intervals', title: `Paddle intervals ${Math.max(3, Math.round(5 * s))} × 5 min`, target: { type: 'hrZone', value: 4 },
      reps: Math.max(3, Math.round(5 * s)), workMin: 5, restMin: 2, warmMin: 15, coolMin: 10, key: true,
    });
    add(day(2), {
      sport: 'running', kind: 'intervals', title: `Intervals ${reps} × 4 min`, target: { type: 'pace', value: 3.92 },
      reps, workMin: 4, restMin: 2, warmMin: 15, coolMin: 10, key: true, notes: 'Hills instead if the track is busy.',
    });
    add(day(3), { sport: 'paddling', kind: 'steady', title: 'Easy paddle', minutes: mins(70), target: { type: 'hrZone', value: 2 } });
    add(day(4), { sport: 'running', kind: 'steady', title: 'Steady run', minutes: mins(50), target: { type: 'hr', value: 150 } });
    add(day(5), { sport: 'running', kind: 'rest', title: 'Rest', minutes: 0, target: null });
    add(day(6), {
      sport: 'running', kind: 'steady', title: 'Long run', minutes: mins(120), target: { type: 'hrZone', value: 2 },
      key: true, notes: k === 3 ? 'Last 20 minutes at race effort.' : '',
    });
  });

  return {
    version: 1,
    workouts,
    races: [
      { id: 'r_demo1', date: addDays(monday, 34), sport: 'running', name: 'Winter 10K', priority: 'A' },
      { id: 'r_demo2', date: addDays(monday, 19), sport: 'paddling', name: 'Harbour 12K paddle', priority: 'B' },
    ],
    weekPhases,
  };
}

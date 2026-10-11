// Settings that a fork might reasonably change. Everything else reads from here.

// intervals.icu REST API. If the day-one spike shows CORS is blocked, point this
// at a Cloudflare Worker that forwards requests (see README).
export const API_BASE = 'https://intervals.icu/api/v1';

// intervals.icu activity types that count as each sport. Anything else is ignored.
export const SPORTS = {
  running: {
    label: 'Running',
    noun: ['run', 'runs'],
    types: ['Run', 'TrailRun', 'VirtualRun'],
    hasPaceZones: true,
  },
  paddling: {
    label: 'Paddling',
    noun: ['paddle', 'paddles'],
    types: ['Canoeing', 'Kayaking', 'StandUpPaddling', 'Rowing'],
    hasPaceZones: false,
  },
};

// Date range presets, in weeks, and the one selected on first visit.
export const PRESET_WEEKS = [1, 4, 8, 12];
export const DEFAULT_WEEKS = 4;

// Ranges this short or shorter are charted by day instead of by week.
export const DAILY_MAX_DAYS = 14;

// Fitness and fatigue time constants (days). These are intervals.icu's defaults.
export const FITNESS_DAYS = 42;
export const FATIGUE_DAYS = 7;

// Days of history fetched before the comparison period so per-sport fitness has
// time to settle before the first day shown.
export const WARMUP_DAYS = 150;

// Cached data older than this many hours is re-fetched on load.
export const REFRESH_HOURS = 24;

// The prompt that leads the copied report. Expect to edit this after real use.
export const COACHING_PROMPT = (sportLabel, rangeText) =>
  `You are my endurance coach. Here is my ${sportLabel.toLowerCase()} training for ${rangeText}, ` +
  `exported from intervals.icu. Review it the way a good coach would: tell me what the numbers say ` +
  `about consistency, volume, intensity balance and fatigue, compare it with the previous period, ` +
  `compare what I planned with what I did, and point out anything that worries you. Then suggest ` +
  `what the next one to two weeks should look like and why. Ask me about anything the data can't tell you ` +
  `(how sessions felt, sleep, niggles, goals) before giving firm advice.`;

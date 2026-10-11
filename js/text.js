// Plain-language wording shared by the dashboard and the report, so both say the
// same thing in the same words.

import { daysBetween, rangeLabel, today } from './dates.js';

export const EXPLAIN = {
  load: "intervals.icu's training load for each session, from heart rate (or pace when it has no HR). An hour at threshold is about 100.",
  fitness: 'Your long-term load: a weighted average of daily load over about six weeks. A steady rise means you are absorbing more training.',
  fatigue: 'Your short-term load: a weighted average over about a week. It jumps after hard days and drops with rest.',
  form: 'Fitness minus fatigue. −10 to −30 is productive training; above +5 is fresh for racing; below −30 risks overreaching.',
  hrZones: 'Time in each heart-rate zone, using the zones set in intervals.icu.',
  paceZones: 'Time in each pace zone, using the threshold pace set in intervals.icu.',
};

export const fmt = (n, dp = 0) =>
  n == null || Number.isNaN(n)
    ? '–'
    : n.toLocaleString('en-CA', { minimumFractionDigits: dp, maximumFractionDigits: dp });

export function signed(n, dp = 0) {
  const r = Number(n.toFixed(dp));
  return (r > 0 ? '+' : r < 0 ? '−' : '') + fmt(Math.abs(r), dp);
}

export const zoneLabel = (zones, i) => `Z${i + 1}${zones.names[i] ? ' ' + zones.names[i] : ''}`;

export function formState(form) {
  if (form > 25) return 'very fresh; fitness may start to slip';
  if (form > 5) return 'fresh';
  if (form >= -10) return 'neutral';
  if (form >= -30) return 'training productively';
  return 'carrying high fatigue';
}

// "Last 4 weeks" for a preset ending today, otherwise the dates.
export function periodName(range) {
  const days = daysBetween(range.from, range.to) + 1;
  if (range.to === today() && days % 7 === 0) return `Last ${days / 7} weeks`;
  return rangeLabel(range.from, range.to);
}

export function previousName(range) {
  const days = daysBetween(range.from, range.to) + 1;
  return days % 7 === 0 ? `the previous ${days / 7} weeks` : `the previous ${days} days`;
}

// "up 12%", "down 5%", "level", or null when there is nothing to compare against.
export function change(cur, prev) {
  if (!prev) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return 'level';
  return pct > 0 ? `up ${pct}%` : `down ${-pct}%`;
}

const plural = (n, [one, many]) => `${fmt(n)} ${n === 1 ? one : many}`;

// The coach's-glance paragraph, as a list of sentences.
export function summarySentences(m) {
  const t = m.totals;
  const p = m.prevTotals;
  const prevName = previousName(m.range);
  const out = [];

  if (!t.sessions) {
    out.push(`${periodName(m.range)}: no ${m.sport.noun[1]} recorded.`);
    if (p.sessions) out.push(`${prevName[0].toUpperCase() + prevName.slice(1)} had ${plural(p.sessions, m.sport.noun)}.`);
    return out;
  }

  out.push(
    `${periodName(m.range)}: ${plural(t.sessions, m.sport.noun)}, ${fmt(t.distanceKm)} km, ${fmt(t.hours, 1)} h, load ${fmt(t.load)}.`,
  );

  if (!p.sessions) {
    out.push(`No ${m.sport.noun[1]} in ${prevName} to compare against.`);
  } else {
    const parts = [
      ['load', change(t.load, p.load)],
      ['distance', change(t.distanceKm, p.distanceKm)],
      ['time', change(t.hours, p.hours)],
    ].filter(([, c]) => c);
    const sessionDiff = t.sessions - p.sessions;
    const sessions =
      sessionDiff === 0 ? 'the same number of sessions' : `${plural(Math.abs(sessionDiff), ['session', 'sessions'])} ${sessionDiff > 0 ? 'more' : 'fewer'}`;
    const first = parts.shift() || ['sessions', `${sessionDiff >= 0 ? 'up' : 'down'} ${Math.abs(sessionDiff)}`];
    out.push(
      `${first[0][0].toUpperCase() + first[0].slice(1)} ${first[1]} on ${prevName}` +
        (parts.length ? `; ${parts.map(([k, c]) => `${k} ${c}`).join(', ')}` : '') +
        `, with ${sessions}.`,
    );
  }

  if (t.easyShare != null) {
    let s = `${Math.round(t.easyShare * 100)}% of time in Z1–Z2`;
    if (p.easyShare != null) s += ` (${Math.round(p.easyShare * 100)}% before)`;
    s += `; most time in ${zoneLabel(m.zones.hr, t.dominantZone)}.`;
    out.push(s);
  }

  const last = m.fitness[m.fitness.length - 1];
  if (last) {
    let s = `Fitness ${fmt(last.fitness)}`;
    if (m.fitnessAtPrevEnd) {
      const d = signed(last.fitness - m.fitnessAtPrevEnd.fitness);
      s += d === '0' ? ' (level over the period)' : ` (${d} over the period)`;
    }
    s += `, form ${signed(last.form)}: ${formState(last.form)}.`;
    out.push(s);
  }
  return out;
}

// Notes about data quality, shown on the dashboard and repeated in the report.
export function dataNotes(m) {
  const notes = [];
  if (!m.zones.settingsFound) {
    notes.push(`No ${m.sport.label.toLowerCase()} sport settings found in intervals.icu, so zones may be missing.`);
  } else if (!m.zones.hr.ok) {
    notes.push(`Heart-rate zones are not set for ${m.sport.label.toLowerCase()} in intervals.icu, so time in zones can't be shown.`);
  }
  if (m.sport.hasPaceZones && m.zones.settingsFound && !m.zones.pace.ok) {
    notes.push('Pace zones or threshold pace are not set for running in intervals.icu, so pace zones can\'t be shown.');
  }
  const t = m.totals;
  if (t.sessions && t.hours && t.hoursWithHr / t.hours < 0.8) {
    notes.push(`Only ${Math.round((t.hoursWithHr / t.hours) * 100)}% of training time has heart-rate data, so zone shares cover part of the training.`);
  }
  if (m.unavailable) {
    notes.push(
      `${plural(m.unavailable, ['activity', 'activities'])} came from Strava, which intervals.icu can't share through its API. ` +
        'Connect your watch (Garmin, Coros, Suunto, Polar…) to intervals.icu directly to include them.',
    );
  }
  const other = Object.entries(m.otherTypes);
  if (other.length) {
    notes.push(`Not shown: ${other.map(([type, n]) => `${n} ${type}`).join(', ')}.`);
  }
  return notes;
}

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
  plannedLoad: "An estimate from the planned time and effort, scaled to match intervals.icu's load for your past sessions. Treat it as roughly right.",
  verdict: 'Build means more load than your recent average, recover means less, maintain means about the same. Fitness rises in build weeks and fatigue falls in recovery weeks.',
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
  if (range.calendar) return range.to === range.chartTo ? 'This week' : 'This week so far';
  if (range.to === today() && days === 7) return 'Last 7 days';
  if (range.to === today() && days % 7 === 0) return `Last ${days / 7} weeks`;
  return rangeLabel(range.from, range.to);
}

export function previousName(range) {
  const days = daysBetween(range.from, range.to) + 1;
  if (range.calendar) return range.to === range.chartTo ? 'last week' : 'the same days last week';
  return days % 7 === 0 && days > 7 ? `the previous ${days / 7} weeks` : `the previous ${days} days`;
}

// "up 12%", "down 5%", "level", or null when there is nothing to compare against.
export function change(cur, prev) {
  if (!prev) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return 'level';
  return pct > 0 ? `up ${pct}%` : `down ${-pct}%`;
}

const plural = (n, [one, many]) => `${fmt(n)} ${n === 1 ? one : many}`;

// The coach's-glance summary: a lead sentence, then one labelled line each for
// volume, intensity and fitness. **Double asterisks** mark emphasis; the page turns
// them into bold and the report keeps them as Markdown.
export function summary(m) {
  const t = m.totals;
  const p = m.prevTotals;
  const prevName = previousName(m.range);
  const lines = [];
  const plan = planSummary(m);

  if (!t.sessions) {
    const lead = `${periodName(m.range)}: no ${m.sport.noun[1]} recorded.`;
    if (p.sessions) lines.push({ label: 'Before', text: `${cap(prevName)} had ${plural(p.sessions, m.sport.noun)}.` });
    if (plan) lines.push({ label: 'Plan', text: plan });
    return { lead, lines };
  }

  const lead = `${periodName(m.range)}: ${plural(t.sessions, m.sport.noun)}, ${fmt(t.distanceKm)} km, ${fmt(t.hours, 1)} h, load ${fmt(t.load)}.`;

  if (!p.sessions) {
    lines.push({ label: 'Volume', text: `No ${m.sport.noun[1]} in ${prevName} to compare with.` });
  } else {
    const load = change(t.load, p.load) || 'level';
    const others = [
      ['distance', change(t.distanceKm, p.distanceKm)],
      ['time', change(t.hours, p.hours)],
    ].filter(([, c]) => c).map(([k, c]) => `${k} ${c}`);
    const diff = t.sessions - p.sessions;
    others.push(diff === 0 ? 'same number of sessions' : `${plural(Math.abs(diff), ['session', 'sessions'])} ${diff > 0 ? 'more' : 'fewer'}`);
    lines.push({ label: 'Volume', text: `Load **${load}** on ${prevName}. ${cap(others.join(', '))}.` });
  }

  if (t.easyShare != null) {
    const now = Math.round(t.easyShare * 100);
    const before = p.easyShare != null ? Math.round(p.easyShare * 100) : null;
    const trend = before == null ? '' : before === now ? ', same as before' : `, ${now > before ? 'up' : 'down'} from ${before}%`;
    lines.push({
      label: 'Intensity',
      text: `**${now}%** of time easy (Z1–Z2)${trend}. Most time in ${zoneLabel(m.zones.hr, t.dominantZone)}.`,
    });
  }

  const last = m.fitness[m.fitness.length - 1];
  if (last) {
    let text = `Fitness **${fmt(last.fitness)}**`;
    if (m.fitnessAtPrevEnd) {
      const d = Math.round(last.fitness - m.fitnessAtPrevEnd.fitness);
      text += d === 0 ? ', level over the period' : `, ${d > 0 ? 'up' : 'down'} ${Math.abs(d)} over the period`;
    }
    text += `. Form **${signed(last.form)}, ${formState(last.form)}**.`;
    lines.push({ label: 'Fitness', text });
  }

  if (plan) lines.push({ label: 'Plan', text: plan });
  return { lead, lines };
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

// ---------- The plan ----------

// Planned loads are estimates, so they're rounded: "about 410", "about 95".
export const about = (n) => fmt(n >= 200 ? Math.round(n / 10) * 10 : Math.round(n / 5) * 5);

// "Winter 10K in 33 days. Fitness is 44 and the plan takes it to 52 by race day."
export function countdown(m) {
  const r = m.nextRace;
  if (!r) return '';
  const other = r.sport !== m.sportKey ? ` (${r.sport})` : '';
  let text = r.days === 0 ? `**${r.name}**${other} is today.` : `**${r.name}**${other} in ${plural(r.days, ['day', 'days'])}.`;
  const f = m.forecast.atRace;
  if (f && m.fitnessNow) text += ` Fitness is ${fmt(m.fitnessNow.fitness)} and the plan takes it to ${fmt(f.fitness)} by race day.`;
  return text;
}

// "up 12% on your 4-week average, a **build** week"
function verdictPhrase(w) {
  if (w.verdict === 'first weeks') return '';
  const pct = Math.round((w.ratio - 1) * 100);
  const vs = pct === 0 ? 'level with your 4-week average' : `${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% on your 4-week average`;
  return `${vs}, a **${w.verdict}** week`;
}

export function flagSentences(w) {
  const out = [];
  if (w.flags.includes('big jump')) out.push('That is a big jump; most coaches keep weekly increases under about 10%.');
  if (w.flags.includes('high fatigue')) out.push('That would push form below −30, which is high fatigue.');
  return out;
}

// "Next week: 5 runs, 6.2 h, load about 410, up 12% on your 4-week average, a build
// week. Fitness would go from 44 to 46 and form to about −14."
export function weekSentence(m, w, name = 'Next week') {
  const p = w.planned;
  if (!p.sessions) return `Nothing planned for ${name.toLowerCase()} yet.`;
  const verdict = verdictPhrase(w);
  let text = `${name}: ${plural(p.sessions, m.sport.noun)}, ${fmt(p.hours, 1)} h, load about ${about(p.load)}${verdict ? `, ${verdict}` : ''}.`;
  if (w.verdict === 'first weeks') text += " There isn't enough recent history to call it a build or recovery week yet.";
  if (w.fitnessStart != null && w.fitnessEnd != null) {
    text += ` Fitness would go from ${fmt(w.fitnessStart)} to ${fmt(w.fitnessEnd)} and form to about ${signed(w.formEnd)}.`;
  }
  return [text, ...flagSentences(w)].join(' ');
}

// The 1-week tab: "Still to come this week: 2 runs, about 95 load. The week would
// land at 380, up 8% on last week."
export function thisWeekSentence(m) {
  const w = m.thisWeek;
  const c = w.toCome;
  let text = c.sessions
    ? `Still to come this week: ${plural(c.sessions, m.sport.noun)}, about ${about(c.load)} load.`
    : 'Nothing more planned this week.';
  if (w.load > 0) {
    const vs = change(w.load, w.lastWeek);
    text += ` The week would ${c.sessions ? 'land' : 'end'} at ${about(w.load)}${vs ? `, ${vs === 'level' ? 'level with' : `${vs} on`} last week` : ''}.`;
  }
  return [text, ...flagSentences(w)].join(' ');
}

// The summary's Plan line: the countdown, then next week (or, on the 1-week tab, the
// rest of this week).
function planSummary(m) {
  if (!m.plan.workouts.length && !m.nextRace) return '';
  const week = m.range.calendar ? thisWeekSentence(m) : weekSentence(m, m.nextWeek);
  return [countdown(m), week].filter(Boolean).join(' ');
}

// How planned loads are scaled, in one or two sentences.
export function calibrationText(m) {
  const noun = m.sport.noun[1];
  const targets = new Set(m.plan.workouts.filter((w) => w.target).map((w) => (w.target.type === 'pace' ? 'pace' : 'hr')));
  if (!targets.size) targets.add('hr');
  const out = [];
  for (const kind of ['hr', 'pace']) {
    if (!targets.has(kind)) continue;
    const c = m.calibration[kind];
    const what = kind === 'pace' ? 'Estimates for pace targets are' : targets.has('pace') ? 'Estimates for heart-rate targets are' : 'Planned-load estimates are';
    out.push(
      c.calibrated
        ? `${what} scaled by ${c.factor.toFixed(2)} to match intervals.icu's load for your last ${plural(c.n, m.sport.noun)}.`
        : `${what} unscaled until there are five ${noun} with ${kind === 'pace' ? 'distance' : 'heart rate'} to compare against.`,
    );
  }
  if (m.sportKey === 'paddling') out.push('Paddling load from heart rate is rough to begin with, so treat these as ballpark.');
  return out.join(' ');
}

// Planned workouts whose load can't be estimated, and why.
function missingSettingNotes(m) {
  const counts = {};
  for (const w of m.plan.workouts) if (w.estimate.missing) counts[w.estimate.missing] = (counts[w.estimate.missing] || 0) + 1;
  const sport = m.sport.label.toLowerCase();
  const what = {
    lthr: `a threshold heart rate for ${sport}`,
    hrZones: `heart-rate zones for ${sport}`,
    thresholdPace: `a threshold pace for ${sport}`,
  };
  return Object.entries(counts)
    .filter(([k]) => what[k])
    .map(([k, n]) => `${plural(n, ['planned workout has', 'planned workouts have'])} no load estimate because intervals.icu has no ${what[k]}.`);
}

// Plain sentences, for places without formatting (the JSON export).
export function summarySentences(m) {
  const { lead, lines } = summary(m);
  return [lead, ...lines.map((l) => l.text.replace(/\*\*/g, ''))];
}

// Notes about data quality, shown on the dashboard and repeated in the report.
export function dataNotes(m) {
  const notes = [];
  if (!m.zones.settingsFound) {
    notes.push(`No ${m.sport.label.toLowerCase()} sport settings found in intervals.icu, so zones may be missing.`);
  } else if (!m.zones.hr.ok) {
    notes.push(`Heart-rate zones are not set for ${m.sport.label.toLowerCase()} in intervals.icu, so time in zones can't be shown.`);
  }
  if (m.zones.usesOther) {
    const sport = m.sport.label.toLowerCase();
    notes.push(
      `${m.sport.label} has no sport settings of its own in intervals.icu, so zones and load use your "Other" settings` +
        (m.zones.hr.lthr ? ` (threshold heart rate ${m.zones.hr.lthr} bpm)` : '') +
        `. If your heart rate runs lower when ${sport === 'paddling' ? 'paddling' : 'doing this sport'}, add ${sport} settings there so zones and load fit.`,
    );
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
        'Connect your watch (Garmin, Coros, Suunto, Polar…) to intervals.icu directly; once it is, the watch copy normally replaces the Strava one.',
    );
  }
  const other = Object.entries(m.otherTypes);
  if (other.length) {
    notes.push(`Not shown: ${other.map(([type, n]) => `${n} ${type}`).join(', ')}.`);
  }
  if (m.plan.workouts.some((w) => w.kind !== 'rest')) notes.push(calibrationText(m), ...missingSettingNotes(m));
  return notes;
}

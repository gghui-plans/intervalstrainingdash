// Plain-language wording shared by the dashboard and the report, so both say the
// same thing in the same words.

import { SPORTS } from './config.js';
import { daysBetween, rangeLabel, today } from './dates.js';
import { hasTargets, paceClock, paceUnit } from './plan.js';

export const EXPLAIN = {
  load: "intervals.icu's training load for each session, from heart rate (or pace when it has no HR). An hour at threshold is about 100.",
  fitness: 'Your long-term load: a weighted average of daily load over about six weeks. A steady rise means you are absorbing more training.',
  fatigue: 'Your short-term load: a weighted average over about a week. It jumps after hard days and drops with rest.',
  form: 'Fitness minus fatigue. −10 to −30 is productive training; above +5 is fresh for racing; below −30 risks overreaching.',
  overallForm: 'Form across every sport, as intervals.icu reports it: a hard paddle tires you for tomorrow’s run too. −10 to −30 is productive training; below −30 risks overreaching.',
  hrZones: 'Time in each heart-rate zone, using the zones set in intervals.icu.',
  mixedZones: "Time in each heart-rate zone across every sport. Each session counts in its own sport's zones, so Z2 means easy for that sport.",
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

export const plural = (n, [one, many]) => `${fmt(n)} ${n === 1 ? one : many}`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);

export const sportName = (key) => (SPORTS[key] ? SPORTS[key].label.toLowerCase() : 'other');
const nounOf = (key) => SPORTS[key]?.noun || ['session', 'sessions'];

// Sports in order of time spent: [key, { sessions, hours, ... }].
export const sportsByTime = (bySport) => Object.entries(bySport).sort((a, b) => b[1].hours - a[1].hours);

// "4 runs, 2 paddles and 1 strength session"
export function sportCounts(bySport) {
  const parts = sportsByTime(bySport).map(([k, s]) => plural(s.sessions, nounOf(k)));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] || '';
}

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

  const km = m.hasDistance ? ` ${fmt(t.distanceKm)} km,` : '';
  const lead = `${periodName(m.range)}: ${plural(t.sessions, m.sport.noun)},${km} ${fmt(t.hours, 1)} h, load ${fmt(t.load)}.`;

  if (m.all) {
    const parts = sportsByTime(t.bySport).map(([k, s]) => `${fmt(s.hours, 1)} h ${sportName(k)} (${fmt(s.sessions)})`);
    if (parts.length) lines.push({ label: 'Sports', text: `${cap(parts.join(', '))}.` });
  }

  if (!p.sessions) {
    lines.push({ label: 'Volume', text: `No ${m.sport.noun[1]} in ${prevName} to compare with.` });
  } else {
    const load = change(t.load, p.load) || 'level';
    const others = [
      ['distance', m.hasDistance ? change(t.distanceKm, p.distanceKm) : null],
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
    const most = m.all ? '' : ` Most time in ${zoneLabel(m.zones.hr, t.dominantZone)}.`;
    lines.push({ label: 'Intensity', text: `**${now}%** of time easy (Z1–Z2)${trend}.${most}` });
  }

  // Fitness is this view's own; form is always all sports, since fatigue is shared.
  const last = m.fitness[m.fitness.length - 1];
  if (last) {
    let text = `Fitness **${fmt(last.fitness)}**`;
    if (m.fitnessAtPrevEnd) {
      const d = Math.round(last.fitness - m.fitnessAtPrevEnd.fitness);
      text += d === 0 ? ', level over the period' : `, ${d > 0 ? 'up' : 'down'} ${Math.abs(d)} over the period`;
    }
    const form = m.overallEnd;
    if (form) text += `. ${m.all ? 'Form' : 'Overall form'} **${signed(form.form)}, ${formState(form.form)}**`;
    lines.push({ label: 'Fitness', text: `${text}.` });
  }

  if (plan) lines.push({ label: 'Plan', text: plan });
  return { lead, lines };
}

// ---------- The plan ----------

// Planned loads are estimates, so they're rounded: "about 410", "about 95".
export const about = (n) => fmt(n >= 200 ? Math.round(n / 10) * 10 : Math.round(n / 5) * 5);

// "**Winter 10K** in 33 days, with fitness 44 now and 43 on race day, and overall form
// about +14." Fitness is the race's sport; form is all sports.
export function countdown(m) {
  const r = m.nextRace;
  if (!r) return '';
  const other = r.sport !== m.view ? ` (${sportName(r.sport)})` : '';
  if (r.days === 0) return `**${r.name}**${other} is today.`;
  let text = `**${r.name}**${other} in ${plural(r.days, ['day', 'days'])}`;
  const a = m.atRace;
  if (a && a.fitness != null && a.fitnessNow != null) {
    const which = r.sport === m.view ? 'fitness' : `${sportName(r.sport)} fitness`;
    text += `, with ${which} ${fmt(a.fitnessNow)} now and ${fmt(a.fitness)} on race day`;
    if (a.form != null) text += `, and ${m.all ? 'form' : 'overall form'} about ${signed(a.form)}`;
  }
  return `${text}.`;
}

const VERDICT_WORD = { build: 'build', maintain: 'maintenance', recover: 'recovery' };

// "up 12% on your 4-week average, a **build** week"
function verdictPhrase(w) {
  if (!w.verdict || w.verdict === 'first weeks') return '';
  const pct = Math.round((w.ratio - 1) * 100);
  const vs = pct === 0 ? 'level with your 4-week average' : `${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% on your 4-week average`;
  return `${vs}, a **${VERDICT_WORD[w.verdict]}** week`;
}

export function flagSentences(w, all = false) {
  const out = [];
  if (w.flags.includes('big jump')) out.push('That is a big jump; most coaches keep weekly increases under about 10%.');
  if (w.flags.includes('high fatigue')) out.push(`That would push ${all ? '' : 'overall '}form below −30, which is high fatigue.`);
  return out;
}

// Short forms for the summary's Plan line, which stays at two sentences.
function flagClause(w, all) {
  const parts = [];
  if (w.flags.includes('big jump')) parts.push('a big jump');
  if (w.flags.includes('high fatigue')) parts.push(`${all ? '' : 'overall '}form would drop below −30`);
  return parts.length ? `, and ${parts.join(', and ')}` : '';
}

// The opening of a week sentence: "Next week: 4 runs, 6.6 h, load about 400, up 22% on
// your 4-week average, a **build** week", or for all sports "Next week: 9.4 h over 7
// sessions (4 runs, 2 paddles and 1 strength session)". Null when nothing's planned.
function weekOpening(m, w, name) {
  const p = w.planned;
  if (!p.sessions) return null;
  if (m.all) return `${name}: ${fmt(p.hours, 1)} h over ${plural(p.sessions, ['session', 'sessions'])} (${sportCounts(w.bySport)})`;
  const verdict = verdictPhrase(w);
  return `${name}: ${plural(p.sessions, m.sport.noun)}, ${fmt(p.hours, 1)} h, load about ${about(p.load)}${verdict ? `, ${verdict}` : ''}`;
}

const nothingFor = (name) => `Nothing planned for ${name === 'Next week' ? 'next week' : `the ${name[0].toLowerCase()}${name.slice(1)}`} yet.`;

// The full week sentence, for the report: "Next week: 5 runs, 6.2 h, load about 410,
// up 12% on your 4-week average, a build week. Fitness would go from 44 to 46, and
// overall form to about −14." Flags add a sentence each.
export function weekSentence(m, w, name = 'Next week') {
  const open = weekOpening(m, w, name);
  if (!open) return nothingFor(name);
  let text = `${open}.`;
  if (!m.all && w.verdict === 'first weeks') text += " There isn't enough recent history to call it a build or recovery week yet.";
  if (w.fitnessStart != null && w.fitnessEnd != null) {
    text += ` Fitness would go from ${fmt(w.fitnessStart)} to ${fmt(w.fitnessEnd)}`;
    text += w.formEnd != null ? `, and ${m.all ? 'form' : 'overall form'} to about ${signed(w.formEnd)}.` : '.';
  }
  return [text, ...flagSentences(w, m.all)].join(' ');
}

// The 1-week tab: "Still to come this week: 2 runs, about 95 load; the week would land
// at 380, up 8% on last week."
export function thisWeekSentence(m, { short = false } = {}) {
  const w = m.thisWeek;
  const c = w.toCome;
  let text;
  if (m.all) {
    text = c.sessions ? `Still to come this week: ${fmt(c.hours, 1)} h over ${plural(c.sessions, ['session', 'sessions'])}` : 'Nothing more planned this week';
    if (w.hours > 0) text += `; the week would ${c.sessions ? 'land' : 'end'} at ${fmt(w.hours, 1)} h`;
  } else {
    text = c.sessions ? `Still to come this week: ${plural(c.sessions, m.sport.noun)}, about ${about(c.load)} load` : 'Nothing more planned this week';
    if (w.load > 0) {
      const vs = change(w.load, w.lastWeek);
      text += `; the week would ${c.sessions ? 'land' : 'end'} at ${about(w.load)}${vs ? `, ${vs === 'level' ? 'level with' : `${vs} on`} last week` : ''}`;
    }
  }
  if (short) return `${text}${flagClause(w, m.all)}.`;
  return [`${text}.`, ...flagSentences(w, m.all)].join(' ');
}

// The summary's Plan line, two sentences at most: the countdown, then next week (or,
// on the 1-week tab, the rest of this week). Without a race, the second sentence is
// where next week leaves fitness and form.
export function planSummary(m) {
  if (!m.plan.workouts.length && !m.nextRace) return '';
  let week;
  if (m.range.calendar) {
    week = thisWeekSentence(m, { short: true });
  } else {
    const open = weekOpening(m, m.nextWeek, 'Next week');
    week = open ? `${open}${flagClause(m.nextWeek, m.all)}.` : nothingFor('Next week');
  }
  const first = countdown(m);
  if (first) return `${first} ${week}`;
  const w = m.nextWeek;
  const fit = !m.range.calendar && w.planned.sessions && w.fitnessStart != null && w.fitnessEnd != null
    ? ` Fitness would go from ${fmt(w.fitnessStart)} to ${fmt(w.fitnessEnd)}${w.formEnd != null ? `, with ${m.all ? 'form' : 'overall form'} about ${signed(w.formEnd)}` : ''}.`
    : '';
  return `${week}${fit}`;
}

// Whether a week's planned phase and its load agree. In a sport view the phase is the
// intention and the verdict the check: one word when they agree, a sentence when not.
const PHASE_FITS = { build: ['build'], peak: ['build', 'maintain'], base: ['build', 'maintain'], recovery: ['recover'], taper: ['recover'] };
const VERDICT_TAG = { build: 'Build', maintain: 'Maintain', recover: 'Recover' };

export function phaseCheck(w, all = false) {
  const verdict = !all && w.planned.sessions && w.verdict && w.verdict !== 'first weeks' ? w.verdict : null;
  if (!w.phase) return { label: verdict ? VERDICT_TAG[verdict] : '', kind: verdict || '', note: '' };
  const label = cap(w.phase);
  if (!verdict || PHASE_FITS[w.phase].includes(verdict)) return { label, kind: verdict || 'phase', note: '' };
  const pct = Math.round((w.ratio - 1) * 100);
  const vs = pct === 0 ? 'level with' : `${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% on`;
  return { label, kind: 'mismatch', note: `Planned as ${w.phase}, but load is ${vs} your 4-week average.` };
}

// A workout's target in words: "Z2 Aerobic", "150 bpm", "4:45/km".
export function targetText(target, zones) {
  if (!target) return '';
  if (target.type === 'hrZone') return zoneLabel(zones.hr, target.value - 1);
  if (target.type === 'hr') return `${fmt(target.value)} bpm`;
  return `${paceClock(target.value, zones.pace.units)}/${paceUnit(zones.pace.units)}`;
}

// What a planned workout is, in words: "50 min at Z2 Aerobic", or for intervals
// "6 × 4 min at 4:15/km, 2 min easy between; 15 min warm-up, 10 min cool-down".
export function workoutText(w, zones) {
  const at = w.target ? ` at ${targetText(w.target, zones)}` : '';
  if (w.kind !== 'intervals') return `${fmt(w.minutes)} min${at}`;
  const parts = [`${fmt(w.reps)} × ${fmt(w.workMin, w.workMin % 1 ? 1 : 0)} min${at}`];
  if (w.restMin) parts[0] += `, ${fmt(w.restMin, w.restMin % 1 ? 1 : 0)} min easy between`;
  const wc = [w.warmMin && `${fmt(w.warmMin)} min warm-up`, w.coolMin && `${fmt(w.coolMin)} min cool-down`].filter(Boolean);
  return [parts[0], wc.join(', ')].filter(Boolean).join('; ');
}

// A title for a workout left untitled: "Easy run", "Tempo paddle", "Intervals 6 × 4 min".
export function defaultTitle(w, zones) {
  if (!hasTargets(w.sport)) return SPORTS[w.sport].label;
  if (w.kind === 'intervals') return `Intervals ${fmt(w.reps || 0)} × ${fmt(w.workMin || 0, (w.workMin || 0) % 1 ? 1 : 0)} min`;
  const noun = SPORTS[w.sport].noun[0];
  let zone = null;
  if (w.target?.type === 'hrZone') zone = w.target.value;
  else if (w.target?.type === 'hr') zone = (zones.hr.bounds || []).findIndex((b) => w.target.value <= b) + 1 || null;
  else if (w.target?.type === 'pace' && zones.pace.thresholdPace) {
    zone = (zones.pace.pcts || []).findIndex((p) => (w.target.value / zones.pace.thresholdPace) * 100 <= p) + 1 || null;
  }
  const effort = !zone ? '' : zone <= 2 ? (w.minutes >= 90 ? 'Long' : 'Easy') : zone === 3 ? 'Steady' : zone === 4 ? 'Tempo' : 'Hard';
  return effort ? `${effort} ${noun}` : cap(noun);
}

// How one sport's planned loads are scaled, as a phrase: "runs ×0.82 for heart rate
// and ×0.90 for pace", "strength sessions from your average of 32 load an hour".
function scaling(key, workouts, cal) {
  const noun = nounOf(key)[1];
  if (!hasTargets(key)) {
    return cal.perHour.calibrated
      ? `${noun} from your average of ${fmt(cal.perHour.value)} load an hour`
      : `${noun} not yet, until you've done three`;
  }
  const kinds = new Set(workouts.filter((w) => w.target).map((w) => (w.target.type === 'pace' ? 'pace' : 'hr')));
  if (!kinds.size) kinds.add('hr');
  const one = (k) => (cal[k].calibrated ? `×${cal[k].factor.toFixed(2)}` : 'unscaled') + (kinds.size > 1 ? ` for ${k === 'hr' ? 'heart rate' : 'pace'}` : '');
  return `${noun} ${[...kinds].map(one).join(' and ')}`;
}

// How planned loads are scaled, in one or two sentences.
export function calibrationText(m) {
  if (m.all) {
    const keys = [...new Set(m.plan.workouts.map((w) => w.sport))];
    const parts = keys.map((k) => scaling(k, m.plan.workouts.filter((w) => w.sport === k), m.ctx.sports[k].calibration));
    const rough = keys.includes('paddling') ? ' Paddling load from heart rate is rough, so treat it as ballpark.' : '';
    return `Planned loads are scaled to match intervals.icu's load for your past sessions: ${parts.join('; ')}.${rough}`;
  }
  if (!hasTargets(m.view)) return `Planned loads are ${scaling(m.view, m.plan.workouts, m.calibration)}.`;
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
  if (m.view === 'paddling') out.push('Paddling load from heart rate is rough to begin with, so treat these as ballpark.');
  return out.join(' ');
}

// Planned workouts whose load can't be estimated, and why.
function missingSettingNotes(m) {
  const counts = {};
  for (const w of m.plan.workouts) {
    if (w.estimate.missing) {
      const k = `${w.sport}|${w.estimate.missing}`;
      counts[k] = (counts[k] || 0) + 1;
    }
  }
  return Object.entries(counts).flatMap(([k, n]) => {
    const [sport, missing] = k.split('|');
    const name = sportName(sport);
    if (missing === 'history') {
      return [`${plural(n, [`planned ${nounOf(sport)[0]} has`, `planned ${nounOf(sport)[1]} have`])} no load estimate yet: it comes from your own past sessions, and there are fewer than three.`];
    }
    const what = { lthr: `a threshold heart rate for ${name}`, hrZones: `heart-rate zones for ${name}`, thresholdPace: `a threshold pace for ${name}` }[missing];
    return what ? [`${plural(n, ['planned workout has', 'planned workouts have'])} no load estimate because intervals.icu has no ${what}.`] : [];
  });
}

// How planned loads are estimated, and any that can't be. Empty without a plan.
export function planNotes(m) {
  return m.plan.workouts.length ? [calibrationText(m), ...missingSettingNotes(m)] : [];
}

// Plain sentences, for places without formatting (the JSON export).
export function summarySentences(m) {
  const { lead, lines } = summary(m);
  return [lead, ...lines.map((l) => l.text.replace(/\*\*/g, ''))];
}

// Notes about data quality, shown on the dashboard and repeated in the report. The
// page shows the plan's notes (plan: false here) in the plan view instead.
export function dataNotes(m, { plan = true } = {}) {
  const notes = [];
  if (m.all) {
    // Zones across sports are explained on the zones chart and in the report's table.
  } else if (!m.zones.settingsFound) {
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
    notes.push(`Not shown here, but counted in All sports: ${other.map(([type, n]) => `${n} ${type}`).join(', ')}.`);
  }
  if (plan) notes.push(...planNotes(m));
  return notes;
}

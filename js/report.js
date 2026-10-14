// The export: a Markdown report that mirrors the dashboard, and the raw JSON behind it.

import { COACHING_PROMPT } from './config.js';
import { addDays, daysBetween, longDay, rangeLabel, shortDate, startOfWeek, today } from './dates.js';
import {
  EXPLAIN, change, countdown, dataNotes, fmt, formState, periodName, planNotes, previousName, signed, summary,
  summarySentences, thisWeekSentence, weekSentence, workoutText, zoneLabel,
} from './text.js';

const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');
const hm = (secs) => {
  if (!secs) return '–';
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`;
};

function table(head, rows) {
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n');
}

// threshold_pace is a speed in m/s; pace zones are % of that speed.
function paceAt(speed, units) {
  const metres = units === 'MINS_MILE' ? 1609.344 : 1000;
  const secs = Math.round(metres / speed);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}/${units === 'MINS_MILE' ? 'mi' : 'km'}`;
}

function hrZoneLines(z) {
  return z.bounds.map((upper, i) => {
    const lower = i === 0 ? null : z.bounds[i - 1] + 1;
    const range = i === 0 ? `up to ${upper} bpm` : i === z.bounds.length - 1 ? `${lower} bpm and up` : `${lower}–${upper} bpm`;
    return `- ${zoneLabel(z, i)}: ${range}`;
  });
}

function paceZoneLines(z) {
  const tp = z.thresholdPace;
  const plausible = tp > 1 && tp < 10;
  return z.pcts.map((upper, i) => {
    const lower = z.pcts[i - 1];
    // The last zone's upper bound is a large sentinel (e.g. 999) meaning "no limit".
    let text = i === 0 ? `below ${upper}% of threshold speed` : upper >= 200 ? `above ${lower}%` : `${lower}–${upper}%`;
    if (plausible) {
      if (i === 0) text += ` (slower than ${paceAt((tp * upper) / 100, z.units)})`;
      else if (upper >= 200) text += ` (faster than ${paceAt((tp * lower) / 100, z.units)})`;
      else text += ` (${paceAt((tp * lower) / 100, z.units)} to ${paceAt((tp * upper) / 100, z.units)})`;
    }
    return `- ${zoneLabel(z, i)}: ${text}`;
  });
}

const cell = (text) => String(text).replace(/\|/g, '/').replace(/\s*\n\s*/g, ' / ');
const stripBold = (text) => text.replace(/\*\*/g, '');

// Weeks the report's plan section covers: this week and next, or on to the race
// week when this sport's A race is within the forecast.
function planWeeks(m) {
  const ctx = m.planContext;
  const raceA = m.plan.races.find((r) => r.priority === 'A' && r.date > ctx.now && r.date <= ctx.forecast.to);
  const last = raceA ? startOfWeek(raceA.date, m.weekStart) : addDays(ctx.currentStart, 7);
  const weeks = [];
  for (let from = ctx.currentStart; from <= last; from = addDays(from, 7)) weeks.push(ctx.week(from));
  return weeks;
}

function planSection(m) {
  const ctx = m.planContext;
  const ahead = m.plan.workouts.filter((w) => w.date >= ctx.now);
  const races = m.planContext.allRaces.filter((r) => r.date >= ctx.now);
  if (!ahead.length && !races.length) return [];
  const out = ['## Plan for the coming weeks', ''];
  const cd = countdown(m);
  if (cd) out.push(stripBold(cd), '');
  if (races.length) {
    const sport = (r) => (r.sport === m.sportKey ? '' : `, ${r.sport}`);
    out.push(`Races: ${races.map((r) => `${r.name} (${r.priority} race${sport(r)}) on ${longDay(r.date)}, in ${fmt(daysBetween(ctx.now, r.date))} days`).join('; ')}.`, '');
  }
  if (!ahead.length) return out;
  out.push('Planned time and load are estimates from the planned duration and target effort.', '');

  planWeeks(m).forEach((w, k) => {
    const name = k === 0 ? 'This week' : k === 1 ? 'Next week' : `Week of ${shortDate(w.from)}`;
    const heading = k < 2 ? `${name}, ${rangeLabel(w.from, w.to)}` : `Week of ${rangeLabel(w.from, w.to)}`;
    out.push(`### ${heading}${w.phase ? ` (phase: ${w.phase})` : ''}`, '');
    const list = m.plan.workouts.filter((x) => x.date >= w.from && x.date <= w.to);
    const dayRaces = races.filter((r) => r.date >= w.from && r.date <= w.to);
    if (list.length || dayRaces.length) {
      const head = ['Date', 'Workout', 'Details', 'Time', 'Est. load'];
      if (w.current) head.push('Status');
      const rows = [
        ...list.map((x) => {
          const row = [
            longDay(x.date),
            cell(x.title || 'Workout') + (x.key ? ' (key session)' : ''),
            cell(workoutText(x, ctx.zones)),
            x.kind === 'rest' ? '–' : hm(x.estimate.minutes * 60),
            x.kind === 'rest' || x.estimate.load == null ? '–' : fmt(x.estimate.load),
          ];
          if (w.current) {
            row.push(x.kind === 'rest' ? '–' : x.done.length ? 'Done' : ctx.ahead(x.date) ? 'To come' : 'Missed');
          }
          return { date: x.date, row };
        }),
        ...dayRaces.map((r) => ({ date: r.date, row: [longDay(r.date), cell(r.name), `${r.priority} race`, '–', '–', ...(w.current ? ['–'] : [])] })),
      ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      out.push(table(head, rows.map((r) => r.row)), '');
    }
    out.push(stripBold(k === 0 ? thisWeekSentence(m) : weekSentence(m, w, name)), '');
    if (k === 0 && w.formEnd != null) {
      out.push(`Forecast at the end of this week: fitness ${fmt(w.fitnessEnd)}, form ${signed(w.formEnd)} (${formState(w.formEnd)}).`, '');
    }
    const notes = list.filter((x) => x.notes?.trim());
    if (notes.length) {
      out.push(...notes.map((x) => `- ${shortDate(x.date)}, ${x.title}: ${x.notes.trim().replace(/\s*\n\s*/g, ' / ')}`), '');
    }
  });
  const pn = planNotes(m);
  if (pn.length) out.push(pn.join(' '), '');
  return out;
}

export function buildMarkdown(m, athleteName) {
  const { sport, range, prev, totals: t, prevTotals: p } = m;
  const dates = rangeLabel(range.from, range.to);
  const name = periodName(range);
  const rangeText =
    name === dates ? dates : range.calendar ? `${name.toLowerCase()} (${dates})` : `the ${name.toLowerCase()} (${dates})`;
  const out = [];

  const hasPlan = m.plan.workouts.some((w) => w.date >= m.today);
  out.push(COACHING_PROMPT(sport.label, rangeText, hasPlan), '', '---', '');
  out.push(`# ${sport.label} training: ${dates}`, '');
  out.push(
    [athleteName && `Athlete: ${athleteName}`, `Exported ${shortDate(today())} ${today().slice(0, 4)} from intervals.icu`, `Compared with ${rangeLabel(prev.from, prev.to)}`]
      .filter(Boolean)
      .join(' · '),
    '',
  );

  const s = summary(m);
  out.push('## Summary', '', s.lead, '', ...s.lines.map((l) => `- **${l.label}:** ${l.text}`), '');

  const lastFit = m.fitness[m.fitness.length - 1];
  const prevFit = m.fitnessAtPrevEnd;
  const rows = [
    [sport.noun[1][0].toUpperCase() + sport.noun[1].slice(1), fmt(t.sessions), fmt(p.sessions), signed(t.sessions - p.sessions)],
    ['Distance', `${fmt(t.distanceKm, 1)} km`, `${fmt(p.distanceKm, 1)} km`, change(t.distanceKm, p.distanceKm) || '–'],
    ['Time', `${fmt(t.hours, 1)} h`, `${fmt(p.hours, 1)} h`, change(t.hours, p.hours) || '–'],
    ['Time, all sports', `${fmt(t.allHours, 1)} h`, `${fmt(p.allHours, 1)} h`, change(t.allHours, p.allHours) || '–'],
    ['Load', fmt(t.load), fmt(p.load), change(t.load, p.load) || '–'],
  ];
  if (t.easyShare != null || p.easyShare != null) {
    const e = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
    const diff = t.easyShare != null && p.easyShare != null ? `${signed(Math.round((t.easyShare - p.easyShare) * 100))} pts` : '–';
    rows.push(['Time in Z1–Z2', e(t.easyShare), e(p.easyShare), diff]);
  }
  if (lastFit && prevFit) {
    rows.push(['Fitness (end of period)', fmt(lastFit.fitness), fmt(prevFit.fitness), signed(lastFit.fitness - prevFit.fitness)]);
    rows.push(['Form (end of period)', signed(lastFit.form), signed(prevFit.form), signed(lastFit.form - prevFit.form)]);
  }
  out.push(`## This period vs ${previousName(range)}`, '', table(['', 'This period', 'Previous', 'Change'], rows), '');

  const hr = m.zones.hr;
  const zoneHead = hr.count ? Array.from({ length: hr.count }, (_, i) => `Z${i + 1}`) : [];
  // Rows are weeks, or days for short ranges.
  const daily = m.grain === 'day';
  const bars = m.weeks.filter((w) => !w.future); // a calendar week's days still to come
  const rowHead = daily ? 'Day' : 'Week starting';
  const rowLabel = (w) => (daily ? longDay(w.from) : shortDate(w.from) + (w.partial ? ` (${w.days} days)` : ''));
  out.push(daily ? '## Day by day' : '## Week by week', '');
  out.push(
    table(
      [rowHead, sport.noun[1][0].toUpperCase() + sport.noun[1].slice(1), 'Distance (km)', 'Time (h)', 'All sports (h)', 'Load', ...zoneHead],
      bars.map((w) => [
        rowLabel(w),
        fmt(w.sessions),
        fmt(w.distanceKm, 1),
        fmt(w.hours, 1),
        fmt(w.allHours, 1),
        fmt(w.load),
        ...zoneHead.map((_, i) => pct(w.hrSecs[i] || 0, w.hrTotalSecs)),
      ]),
    ),
  );
  if (hr.count) out.push('', `Zone columns are the share of heart-rate time in each zone that ${daily ? 'day' : 'week'}.`);
  out.push('');

  if (hr.ok) {
    out.push('## Heart-rate zones', '', ...hrZoneLines(hr));
    const extra = [hr.lthr && `Threshold HR ${hr.lthr} bpm`, hr.maxHr && `max HR ${hr.maxHr} bpm`].filter(Boolean);
    if (extra.length) out.push('', extra.join(', ') + '.');
    out.push('');
  }

  const pz = m.zones.pace;
  if (sport.hasPaceZones && pz.ok && t.paceTotalSecs) {
    out.push('## Pace zones', '', EXPLAIN.paceZones, '');
    out.push(
      table(
        [rowHead, ...Array.from({ length: pz.count }, (_, i) => `Z${i + 1}`)],
        bars.map((w) => [rowLabel(w), ...Array.from({ length: pz.count }, (_, i) => pct(w.paceSecs[i] || 0, w.paceTotalSecs))]),
      ),
      '',
      ...paceZoneLines(pz),
      '',
    );
  }

  if (m.fitness.length) {
    out.push('## Fitness, fatigue and form', '');
    out.push(`- Fitness: ${EXPLAIN.fitness}`, `- Fatigue: ${EXPLAIN.fatigue}`, `- Form: ${EXPLAIN.form}`, '');
    out.push(
      `These are calculated from ${sport.label.toLowerCase()} sessions only, using intervals.icu's load for each session.`,
      '',
    );
    out.push(
      table(
        [daily ? 'Day' : 'End of week', 'Fitness', 'Fatigue', 'Form'],
        bars.map((w) => {
          const f = m.fitness.find((x) => x.date === w.to);
          return [daily ? longDay(w.to) : shortDate(w.to), fmt(f.fitness), fmt(f.fatigue), `${signed(f.form)} (${formState(f.form)})`];
        }),
      ),
      '',
    );
    if (m.allSports) {
      const a = m.allSports;
      out.push(
        `All sports combined, as intervals.icu reports it on ${shortDate(a.date)}: fitness ${fmt(a.fitness)}, fatigue ${fmt(a.fatigue)}, form ${signed(a.form)}.`,
        '',
      );
    }
  }

  if (m.planned.length) {
    out.push('## Planned vs actual', '');
    out.push('From my own plan. Planned time and load are estimates from the planned duration and target effort.', '');
    out.push(
      table(
        ['Date', 'Planned', 'Details', 'Planned time', 'Planned load (est.)', 'What happened'],
        m.planned.map((e) => {
          const day = e.start_date_local.slice(0, 10);
          const still = day === m.today && !e.done.length;
          return [
            shortDate(day),
            cell(e.name || 'Workout'),
            cell(workoutText(e.workout, m.planContext.zones)),
            hm(e.moving_time),
            e.icu_training_load != null ? fmt(e.icu_training_load) : '–',
            e.done.length
              ? e.done.map((a) => `${cell(a.name || 'Session')}: ${hm(a.moving_time)}, ${fmt((a.distance || 0) / 1000, 1)} km, load ${fmt(a.icu_training_load)}`).join('; ')
              : still ? 'Planned for today' : 'Nothing recorded that day',
          ];
        }),
      ),
      '',
    );
    const notes = m.planned.filter((e) => e.description?.trim());
    if (notes.length) {
      out.push('Planned workout descriptions:', '');
      for (const e of notes) out.push(`- ${shortDate(e.start_date_local.slice(0, 10))}, ${e.name || 'Workout'}: ${e.description.trim().replace(/\s*\n\s*/g, ' / ')}`);
      out.push('');
    }
  }

  out.push(...planSection(m));

  if (m.activities.length) {
    out.push('## Sessions', '');
    out.push(
      table(
        ['Date', 'Session', 'Distance (km)', 'Time', 'Avg HR', 'Load', 'Z1–Z2'],
        m.activities.map((a) => {
          const z = a.icu_hr_zone_times || [];
          const total = z.reduce((s, x) => s + x, 0);
          return [
            shortDate(a.start_date_local.slice(0, 10)),
            (a.name || a.type).replace(/\|/g, '/'),
            fmt((a.distance || 0) / 1000, 1),
            hm(a.moving_time),
            a.average_heartrate ? fmt(a.average_heartrate) : '–',
            fmt(a.icu_training_load),
            pct((z[0] || 0) + (z[1] || 0), total),
          ];
        }),
      ),
      '',
    );
  }

  const notes = dataNotes(m, { plan: false }); // the plan's notes close its own section
  if (notes.length) out.push('## Data notes', '', ...notes.map((n) => `- ${n}`), '');

  return out.join('\n');
}

export function buildJson(m) {
  const strip = ({ hoursWithHr, ...rest }) => rest;
  return JSON.stringify(
    {
      sport: m.sportKey,
      range: { from: m.range.from, to: m.range.to },
      grain: m.grain, // 'week' or 'day': what each entry in weeks covers
      previous: m.prev,
      exported: today(),
      source: 'intervals.icu',
      units: { distance: 'km', time: 'hours', zoneTimes: 'seconds', load: 'intervals.icu training load' },
      summary: summarySentences(m),
      notes: dataNotes(m),
      totals: strip(m.totals),
      previousTotals: strip(m.prevTotals),
      weeks: m.weeks.map(strip),
      previousWeeks: m.prevWeeks.map(strip),
      fitness: m.fitness,
      allSportsFitness: m.allSports,
      zones: m.zones,
      planned: m.planned.map(({ done, workout, ...e }) => ({ ...e, completedActivityIds: done.map((a) => a.id) })),
      activities: m.activities,
      // The plan for this sport, with the app's estimates (load is intervals.icu-style training load).
      plan: {
        workouts: m.plan.workouts.map(({ done, ...w }) => ({ ...w, completedActivityIds: done.map((a) => a.id) })),
        races: m.planContext.allRaces,
        weekPhases: m.planContext.weekPhases,
      },
      calibration: m.calibration,
      nextRace: m.nextRace,
      forecast: m.forecast,
      thisWeek: m.thisWeek,
      nextWeek: m.nextWeek,
    },
    null,
    2,
  );
}

export const fileName = (m, ext) => `${m.sportKey}-${m.range.from}-to-${m.range.to}.${ext}`;

// Blob plus a temporary anchor: saves correctly on iOS and Android as well as desktop.
export function download(text, name, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

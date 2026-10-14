// The export: a Markdown report that mirrors the dashboard, and the raw JSON behind it.
// It covers the selected tab: one sport, or all sports together.

import { COACHING_PROMPT, SPORTS } from './config.js';
import { addDays, daysBetween, longDay, rangeLabel, shortDate, startOfWeek, today } from './dates.js';
import { sportOf } from './data.js';
import {
  EXPLAIN, change, countdown, dataNotes, fmt, formState, periodName, planNotes, previousName, signed, sportCounts,
  sportName, sportsByTime, summary, summarySentences, thisWeekSentence, weekSentence, workoutText, zoneLabel,
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
const capWord = (s) => s[0].toUpperCase() + s.slice(1);
const sportLabel = (k) => SPORTS[k]?.label || 'Other';
const zonesFor = (m, w) => m.ctx.sports[w.sport].zones;

// Weeks the report's plan section covers: this week and next, or on to the race
// week when the A race the forecast reaches is within it.
function planWeeks(m) {
  const { ctx } = m;
  const raceA = m.plan.races.find((r) => r.priority === 'A' && r.date > ctx.now && r.date <= m.forecast.to);
  const last = raceA ? startOfWeek(raceA.date, m.weekStart) : addDays(ctx.currentStart, 7);
  const weeks = [];
  for (let from = ctx.currentStart; from <= last; from = addDays(from, 7)) weeks.push(ctx.week(from, m.view));
  return weeks;
}

function planSection(m) {
  const { ctx } = m;
  const ahead = m.plan.workouts.filter((w) => w.date >= ctx.now);
  const races = ctx.races.filter((r) => r.date >= ctx.now);
  if (!ahead.length && !races.length) return [];
  const out = ['## Plan for the coming weeks', ''];
  const cd = countdown(m);
  if (cd) out.push(stripBold(cd), '');
  if (races.length) {
    const sport = (r) => (r.sport === m.view ? '' : `, ${sportName(r.sport)}`);
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
    if (list.length || dayRaces.length || w.restDays.length) {
      const head = ['Date', ...(m.all ? ['Sport'] : []), 'Workout', 'Details', 'Time', 'Est. load'];
      if (w.current) head.push('Status');
      const pad = (cells) => [...cells, ...(w.current ? ['–'] : [])];
      const rows = [
        ...list.map((x) => {
          const row = [
            longDay(x.date),
            ...(m.all ? [sportLabel(x.sport)] : []),
            cell(x.title || 'Workout') + (x.key ? ' (key session)' : ''),
            cell(workoutText(x, zonesFor(m, x))),
            hm(x.estimate.minutes * 60),
            x.estimate.load == null ? '–' : fmt(x.estimate.load),
          ];
          if (w.current) row.push(x.done.length ? 'Done' : ctx.ahead(x) ? 'To come' : 'Missed');
          return { date: x.date, row };
        }),
        ...dayRaces.map((r) => ({ date: r.date, row: pad([longDay(r.date), ...(m.all ? [sportLabel(r.sport)] : []), cell(r.name), `${r.priority} race`, '–', '–']) })),
        ...w.restDays.map((d) => ({ date: d, row: pad([longDay(d), ...(m.all ? ['–'] : []), 'Rest day', '–', '–', '–']) })),
      ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      out.push(table(head, rows.map((r) => r.row)), '');
    }
    out.push(stripBold(k === 0 ? thisWeekSentence(m) : weekSentence(m, w, name)), '');
    if (k === 0 && w.formEnd != null) {
      out.push(`Forecast at the end of this week: fitness ${fmt(w.fitnessEnd)}, ${m.all ? 'form' : 'overall form'} ${signed(w.formEnd)} (${formState(w.formEnd)}).`, '');
    }
    // A sport report still mentions the other sports, since they add to fatigue.
    if (!m.all && Object.keys(w.others).length) {
      const hours = Object.values(w.others).reduce((t, s) => t + s.hours, 0);
      out.push(`Other sports planned this week: ${sportCounts(w.others)}, ${fmt(hours, 1)} h.`, '');
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
  const subject = m.all ? 'training across all sports' : `${sport.label.toLowerCase()} training`;
  out.push(COACHING_PROMPT(subject, rangeText, hasPlan), '', '---', '');
  out.push(`# ${m.all ? 'Training, all sports' : `${sport.label} training`}: ${dates}`, '');
  out.push(
    [athleteName && `Athlete: ${athleteName}`, `Exported ${shortDate(today())} ${today().slice(0, 4)} from intervals.icu`, `Compared with ${rangeLabel(prev.from, prev.to)}`]
      .filter(Boolean)
      .join(' · '),
    '',
  );

  const s = summary(m);
  out.push('## Summary', '', s.lead, '', ...s.lines.map((l) => `- **${l.label}:** ${l.text}`), '');

  // Fitness here is the tab's own; form is all sports.
  const lastFit = m.fitness[m.fitness.length - 1];
  const prevFit = m.fitnessAtPrevEnd;
  const rows = [[capWord(sport.noun[1]), fmt(t.sessions), fmt(p.sessions), signed(t.sessions - p.sessions)]];
  if (m.hasDistance) rows.push(['Distance', `${fmt(t.distanceKm, 1)} km`, `${fmt(p.distanceKm, 1)} km`, change(t.distanceKm, p.distanceKm) || '–']);
  rows.push(['Time', `${fmt(t.hours, 1)} h`, `${fmt(p.hours, 1)} h`, change(t.hours, p.hours) || '–']);
  if (!m.all) rows.push(['Time, all sports', `${fmt(t.allHours, 1)} h`, `${fmt(p.allHours, 1)} h`, change(t.allHours, p.allHours) || '–']);
  rows.push(['Load', fmt(t.load), fmt(p.load), change(t.load, p.load) || '–']);
  if (t.easyShare != null || p.easyShare != null) {
    const e = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
    const diff = t.easyShare != null && p.easyShare != null ? `${signed(Math.round((t.easyShare - p.easyShare) * 100))} pts` : '–';
    rows.push(['Time in Z1–Z2', e(t.easyShare), e(p.easyShare), diff]);
  }
  if (lastFit && prevFit) {
    rows.push([m.all ? 'Fitness (end of period)' : `${sport.label} fitness (end of period)`, fmt(lastFit.fitness), fmt(prevFit.fitness), signed(lastFit.fitness - prevFit.fitness)]);
    rows.push([m.all ? 'Form (end of period)' : `${sport.label} form (end of period)`, signed(lastFit.form), signed(prevFit.form), signed(lastFit.form - prevFit.form)]);
  }
  out.push(`## This period vs ${previousName(range)}`, '', table(['', 'This period', 'Previous', 'Change'], rows), '');

  if (m.all) {
    const keys = [...new Set([...Object.keys(t.bySport), ...Object.keys(p.bySport)])];
    const ordered = [...sportsByTime(t.bySport).map(([k]) => k), ...keys.filter((k) => !t.bySport[k])];
    out.push('## By sport', '');
    out.push(
      table(
        ['Sport', 'Sessions', 'Time (h)', 'Load', 'Time before (h)', 'Time change'],
        ordered.map((k) => {
          const a = t.bySport[k] || { sessions: 0, hours: 0, load: 0 };
          const b = p.bySport[k] || { sessions: 0, hours: 0, load: 0 };
          return [sportLabel(k), fmt(a.sessions), fmt(a.hours, 1), fmt(a.load), fmt(b.hours, 1), change(a.hours, b.hours) || '–'];
        }),
      ),
      '',
    );
  }

  const hr = m.zones.hr;
  const zoneHead = hr.count ? Array.from({ length: hr.count }, (_, i) => `Z${i + 1}`) : [];
  // Rows are weeks, or days for short ranges.
  const daily = m.grain === 'day';
  const bars = m.weeks.filter((w) => !w.future); // a calendar week's days still to come
  const rowHead = daily ? 'Day' : 'Week starting';
  const rowLabel = (w) => (daily ? longDay(w.from) : shortDate(w.from) + (w.partial ? ` (${w.days} days)` : ''));
  const weekKeys = m.all ? [...Object.keys(SPORTS), 'other'].filter((k) => bars.some((w) => w.bySport[k])) : [];
  out.push(daily ? '## Day by day' : '## Week by week', '');
  out.push(
    table(
      [
        rowHead,
        capWord(sport.noun[1]),
        ...(m.hasDistance ? ['Distance (km)'] : []),
        'Time (h)',
        ...(m.all ? weekKeys.map((k) => `${sportLabel(k)} (h)`) : ['All sports (h)']),
        'Load',
        ...zoneHead,
      ],
      bars.map((w) => [
        rowLabel(w),
        fmt(w.sessions),
        ...(m.hasDistance ? [fmt(w.distanceKm, 1)] : []),
        fmt(w.hours, 1),
        ...(m.all ? weekKeys.map((k) => fmt(w.bySport[k]?.hours || 0, 1)) : [fmt(w.allHours, 1)]),
        fmt(w.load),
        ...zoneHead.map((_, i) => pct(w.hrSecs[i] || 0, w.hrTotalSecs)),
      ]),
    ),
  );
  if (hr.count) out.push('', `Zone columns are the share of heart-rate time in each zone that ${daily ? 'day' : 'week'}.${m.all ? ` ${EXPLAIN.mixedZones}` : ''}`);
  out.push('');

  if (!m.all && hr.ok) {
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
    out.push(m.all ? '## Fitness, fatigue and form, all sports' : `## ${sport.label} fitness, fatigue and form`, '');
    out.push(`- Fitness: ${EXPLAIN.fitness}`, `- Fatigue: ${EXPLAIN.fatigue}`, `- Form: ${EXPLAIN.form}`, '');
    out.push(
      m.all
        ? "These are intervals.icu's own all-sports values, from every session's load."
        : `These are calculated from ${sport.label.toLowerCase()} sessions only, using intervals.icu's load for each session.`,
      '',
    );
    out.push(
      table(
        [daily ? 'Day' : 'End of week', 'Fitness', 'Fatigue', 'Form'],
        bars.map((w) => {
          const f = m.fitness.find((x) => x.date === w.to);
          return [daily ? longDay(w.to) : shortDate(w.to), fmt(f?.fitness), fmt(f?.fatigue), f ? `${signed(f.form)} (${formState(f.form)})` : '–'];
        }),
      ),
      '',
    );
    const o = m.overallEnd;
    if (!m.all && o) {
      out.push(
        `Overall, all sports combined as intervals.icu reports it: fitness ${fmt(o.fitness)}, fatigue ${fmt(o.fatigue)}, form ${signed(o.form)} (${formState(o.form)}). Fatigue carries across sports, so this form is the one to watch.`,
        '',
      );
    }
  }

  if (m.planned.length) {
    out.push('## Planned vs actual', '');
    out.push('From my own plan. Planned time and load are estimates from the planned duration and target effort.', '');
    out.push(
      table(
        ['Date', ...(m.all ? ['Sport'] : []), 'Planned', 'Details', 'Planned time', 'Planned load (est.)', 'What happened'],
        m.planned.map((e) => {
          const day = e.start_date_local.slice(0, 10);
          const still = day === m.today && !e.done.length;
          return [
            shortDate(day),
            ...(m.all ? [sportLabel(e.sport)] : []),
            cell(e.name || 'Workout'),
            cell(workoutText(e.workout, zonesFor(m, e.workout))),
            hm(e.moving_time),
            e.icu_training_load != null ? fmt(e.icu_training_load) : '–',
            e.done.length
              ? e.done.map((a) => `${cell(a.name || 'Session')}: ${hm(a.moving_time)}${a.distance ? `, ${fmt(a.distance / 1000, 1)} km` : ''}, load ${fmt(a.icu_training_load)}`).join('; ')
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
        ['Date', ...(m.all ? ['Sport'] : []), 'Session', 'Distance (km)', 'Time', 'Avg HR', 'Load', 'Z1–Z2'],
        m.activities.map((a) => {
          const z = a.icu_hr_zone_times || [];
          const total = z.reduce((s, x) => s + x, 0);
          return [
            shortDate(a.start_date_local.slice(0, 10)),
            ...(m.all ? [SPORTS[sportOf(a)]?.label || a.type] : []),
            (a.name || a.type).replace(/\|/g, '/'),
            a.distance ? fmt(a.distance / 1000, 1) : '–',
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
  const week = ({ others, ...w }) => w;
  return JSON.stringify(
    {
      sport: m.view, // a sport, or 'all'
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
      allSportsFitness: m.overallEnd,
      zones: m.zones,
      planned: m.planned.map(({ done, workout, ...e }) => ({ ...e, completedActivityIds: done.map((a) => a.id) })),
      activities: m.activities,
      // The plan, with the app's estimates (load is intervals.icu-style training load).
      plan: {
        workouts: m.plan.workouts.map(({ done, ...w }) => ({ ...w, completedActivityIds: done.map((a) => a.id) })),
        races: m.ctx.races,
        restDays: [...m.ctx.restDays].sort(),
        weekPhases: m.ctx.weekPhases,
      },
      calibration: m.all ? Object.fromEntries(Object.entries(m.ctx.sports).map(([k, s]) => [k, s.calibration])) : m.calibration,
      nextRace: m.nextRace,
      forecast: m.forecast,
      thisWeek: week(m.thisWeek),
      nextWeek: week(m.nextWeek),
    },
    null,
    2,
  );
}

export const fileName = (m, ext) => `${m.view === 'all' ? 'all-sports' : m.view}-${m.range.from}-to-${m.range.to}.${ext}`;

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

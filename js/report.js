// The export: a Markdown report that mirrors the dashboard, and the raw JSON behind it.

import { COACHING_PROMPT } from './config.js';
import { rangeLabel, shortDate, today } from './dates.js';
import {
  EXPLAIN, change, dataNotes, fmt, formState, periodName, previousName, signed, summary, summarySentences, zoneLabel,
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

const plannedTime = (e) => e.moving_time || e.time_target;
const plannedDist = (e) => e.distance || e.distance_target;
const plannedLoad = (e) => e.icu_training_load ?? e.load_target;

export function buildMarkdown(m, athleteName) {
  const { sport, range, prev, totals: t, prevTotals: p } = m;
  const dates = rangeLabel(range.from, range.to);
  const name = periodName(range);
  const rangeText = name === dates ? dates : `the ${name.toLowerCase()} (${dates})`;
  const out = [];

  out.push(COACHING_PROMPT(sport.label, rangeText), '', '---', '');
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
  out.push('## Week by week', '');
  out.push(
    table(
      ['Week starting', sport.noun[1][0].toUpperCase() + sport.noun[1].slice(1), 'Distance (km)', 'Time (h)', 'Load', ...zoneHead],
      m.weeks.map((w) => [
        shortDate(w.from) + (w.partial ? ` (${w.days} days)` : ''),
        fmt(w.sessions),
        fmt(w.distanceKm, 1),
        fmt(w.hours, 1),
        fmt(w.load),
        ...zoneHead.map((_, i) => pct(w.hrSecs[i] || 0, w.hrTotalSecs)),
      ]),
    ),
  );
  if (hr.count) out.push('', 'Zone columns are the share of heart-rate time in each zone that week.');
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
        ['Week starting', ...Array.from({ length: pz.count }, (_, i) => `Z${i + 1}`)],
        m.weeks.map((w) => [shortDate(w.from), ...Array.from({ length: pz.count }, (_, i) => pct(w.paceSecs[i] || 0, w.paceTotalSecs))]),
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
        ['End of week', 'Fitness', 'Fatigue', 'Form'],
        m.weeks.map((w) => {
          const f = m.fitness.find((x) => x.date === w.to);
          return [shortDate(w.to), fmt(f.fitness), fmt(f.fatigue), `${signed(f.form)} (${formState(f.form)})`];
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
    out.push(
      table(
        ['Date', 'Planned', 'Planned time', 'Planned km', 'Planned load', 'What happened'],
        m.planned.map((e) => [
          shortDate(e.start_date_local.slice(0, 10)),
          e.name || 'Workout',
          hm(plannedTime(e)),
          plannedDist(e) ? fmt(plannedDist(e) / 1000, 1) : '–',
          plannedLoad(e) != null ? fmt(plannedLoad(e)) : '–',
          e.done.length
            ? e.done.map((a) => `${a.name || 'Session'}: ${hm(a.moving_time)}, ${fmt((a.distance || 0) / 1000, 1)} km, load ${fmt(a.icu_training_load)}`).join('; ')
            : 'Nothing recorded that day',
        ]),
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

  const notes = dataNotes(m);
  if (notes.length) out.push('## Data notes', '', ...notes.map((n) => `- ${n}`), '');

  return out.join('\n');
}

export function buildJson(m) {
  const strip = ({ hoursWithHr, ...rest }) => rest;
  return JSON.stringify(
    {
      sport: m.sportKey,
      range: { from: m.range.from, to: m.range.to },
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
      planned: m.planned.map(({ done, ...e }) => ({ ...e, completedActivityIds: done.map((a) => a.id) })),
      activities: m.activities,
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

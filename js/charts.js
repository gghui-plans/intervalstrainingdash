// The four charts. Chart.js is loaded globally from index.html.

import { SPORTS } from './config.js';
import { dayLabel, longDay, shortDate } from './dates.js';
import { EXPLAIN, about, fmt, signed, zoneLabel } from './text.js';

const instances = {};

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function theme() {
  return {
    surface: css('--surface'),
    text: css('--text-2'),
    muted: css('--text-3'),
    grid: css('--grid'),
    s1: css('--series-1'),
    s2: css('--series-2'),
    s3: css('--series-3'),
    prev: css('--series-prev'),
    other: css('--series-other'),
    zone: (i, n) => css(`--zone-${zoneStep(i, n)}`),
    sport: sportColor,
  };
}

// Each sport has a colour token (--sport-running, …); anything else is "other".
export const sportColor = (key) => css(`--sport-${key}`) || css('--sport-other');

// The sports present in a list of bars, in the order SPORTS lists them, then other.
const sportKeys = (bars) => {
  const seen = new Set(bars.flatMap((w) => Object.keys(w.bySport || {})));
  return [...Object.keys(SPORTS), 'other'].filter((k) => seen.has(k));
};
const sportLabel = (k) => SPORTS[k]?.label || 'Other';

// Zones use one blue ramp, easy to hard, spread over however many zones exist.
function zoneStep(i, n) {
  return n <= 1 ? 1 : Math.round(1 + (i * 6) / (n - 1));
}

// Bars are weeks, or days for short ranges (m.grain).
const barLabel = (m) => (w) => (m.grain === 'day' ? dayLabel(w.from) : shortDate(w.from) + (w.partial ? '*' : ''));
const barTitle = (m, w) =>
  w.label ? `${w.label}, ${shortDate(w.from)} – ${shortDate(w.to)}` : m.grain === 'day' ? longDay(w.from) : `Week of ${shortDate(w.from)}`;

// Diagonal lines in the colour on a transparent background: planned, not done.
export function hatch(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const g = c.getContext('2d');
  g.strokeStyle = withAlpha(color, 0.7);
  g.lineWidth = 2;
  g.beginPath();
  for (const k of [-8, 0, 8]) {
    g.moveTo(k, 8);
    g.lineTo(k + 8, 0);
  }
  g.stroke();
  return g.createPattern(c, 'repeat');
}

// "Planned: about 95 (2 runs)"
const plannedText = (m, w) =>
  `Planned: about ${about(w.plannedLoad)}${w.plannedSessions ? ` (${w.plannedSessions} ${m.sport.noun[w.plannedSessions === 1 ? 0 : 1]})` : ''}`;

const plannedBars = (t) => ({
  ...bar(hatch(t.s1)),
  borderColor: withAlpha(t.s1, 0.55),
  borderWidth: 1.5,
});

function base(t, { stacked = false, yTitle = '' } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: css('--tooltip-bg'),
        titleColor: css('--text-1'),
        bodyColor: css('--text-2'),
        footerColor: css('--text-3'),
        borderColor: css('--border'),
        borderWidth: 1,
        padding: 10,
        boxPadding: 4,
        usePointStyle: true,
      },
    },
    scales: {
      x: {
        stacked,
        grid: { display: false },
        border: { color: t.grid },
        ticks: { color: t.muted, maxRotation: 0, autoSkipPadding: 12 },
      },
      y: {
        stacked,
        beginAtZero: true,
        grid: { color: t.grid },
        border: { display: false },
        ticks: { color: t.muted, maxTicksLimit: 5, precision: 0 },
        title: { display: !!yTitle, text: yTitle, color: t.muted },
      },
    },
  };
}

const bar = (color, extra = {}) => ({
  backgroundColor: color,
  hoverBackgroundColor: color,
  borderRadius: 4,
  borderSkipped: 'start',
  maxBarThickness: 24,
  categoryPercentage: 0.7,
  barPercentage: 0.9,
  ...extra,
});

function draw(id, config) {
  instances[id]?.destroy();
  const canvas = document.getElementById(id);
  instances[id] = new Chart(canvas, config);
}

// Planned load stacks on this period's bars: the 1-week tab's days still to come,
// and on weekly charts up to two weeks of plan appended after the range. In All
// sports this period's bars stack by sport. Returns what the legend needs.
export function drawLoad(m) {
  const t = theme();
  const bars = [...m.weeks, ...m.plannedWeeks];
  const planned = bars.map((w) => (w.plannedLoad ? Math.round(w.plannedLoad) : null));
  const actual = (f) => bars.map((w) => (w.future || w.label ? null : Math.round(f(w))));
  const keys = m.all ? sportKeys(m.weeks) : [];
  const thisPeriod = m.all
    ? keys.map((k, i) => ({
        label: sportLabel(k),
        stack: 'this',
        data: actual((w) => w.bySport[k]?.load || 0),
        ...bar(t.sport(k), { borderRadius: i === keys.length - 1 ? 4 : 0, borderColor: t.surface, borderWidth: { top: i === keys.length - 1 ? 0 : 1.5 } }),
      }))
    : [{ label: 'This period', stack: 'this', data: actual((w) => w.load), ...bar(t.s1) }];
  draw('chart-load', {
    type: 'bar',
    data: {
      labels: bars.map((w) => w.label || barLabel(m)(w)),
      datasets: [
        { label: 'Previous period', stack: 'prev', data: bars.map((w, i) => (m.prevWeeks[i] ? Math.round(m.prevWeeks[i].load) : null)), ...bar(t.prev) },
        ...thisPeriod,
        { label: 'Planned', stack: 'this', planned: true, data: planned, ...plannedBars(t) },
      ],
    },
    options: {
      ...base(t, { stacked: true }),
      plugins: {
        ...base(t).plugins,
        tooltip: {
          ...base(t).plugins.tooltip,
          filter: (c) => c.raw != null && (c.raw > 0 || !m.all || c.datasetIndex === 0),
          itemSort: (a, b) => (a.datasetIndex === 0 ? -1 : b.datasetIndex === 0 ? 1 : b.datasetIndex - a.datasetIndex),
          callbacks: {
            title: (items) => barTitle(m, bars[items[0].dataIndex]),
            label: (c) => {
              if (c.dataset.planned) return ` ${plannedText(m, bars[c.dataIndex])}`;
              if (c.datasetIndex > 0 && m.all) return ` ${c.dataset.label}: ${fmt(c.raw)}`;
              const w = (c.datasetIndex === 0 ? m.prevWeeks : bars)[c.dataIndex];
              const when = c.datasetIndex === 0 ? ` (${m.grain === 'day' ? longDay(w.from) : `week of ${shortDate(w.from)}`})` : '';
              return ` ${c.dataset.label}${when}: ${fmt(w.load)}`;
            },
            footer: (items) => {
              const w = bars[items[0].dataIndex];
              return m.all && !w.future && !w.label ? `All sports: ${fmt(w.load)}` : '';
            },
          },
        },
      },
    },
  });
  return { planned: planned.some((v) => v != null), sports: keys.map((k) => ({ label: sportLabel(k), color: t.sport(k) })) };
}

// Distance is per sport only. Time stacks the selected sport on the other sports,
// so the full bar is total training time.
export function drawVolume(m, measure) {
  if (m.all) return drawHoursBySport(m);
  const t = theme();
  const isKm = measure === 'distance';
  const sportName = m.sport.label;
  const other = (w) => Math.max(0, w.allHours - w.hours);
  const datasets = isKm
    ? [{ label: 'Distance', data: m.weeks.map((w) => +w.distanceKm.toFixed(1)), ...bar(t.s1) }]
    : [
        {
          label: sportName,
          data: m.weeks.map((w) => +w.hours.toFixed(2)),
          ...bar(t.s1, { borderRadius: 0, borderColor: t.surface, borderWidth: { top: 2 } }),
        },
        { label: 'Other sports', data: m.weeks.map((w) => +other(w).toFixed(2)), ...bar(t.other) },
      ];
  draw('chart-volume', {
    type: 'bar',
    data: { labels: m.weeks.map(barLabel(m)), datasets },
    options: {
      ...base(t, { stacked: !isKm, yTitle: isKm ? 'km' : 'hours' }),
      plugins: {
        ...base(t).plugins,
        tooltip: {
          ...base(t).plugins.tooltip,
          itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
          callbacks: {
            title: (items) => barTitle(m, m.weeks[items[0].dataIndex]),
            label: (c) => {
              const w = m.weeks[c.dataIndex];
              if (isKm) return ` ${fmt(w.distanceKm, 1)} km · ${w.sessions} ${m.sport.noun[w.sessions === 1 ? 0 : 1]}`;
              return c.datasetIndex === 0 ? ` ${sportName}: ${fmt(w.hours, 1)} h` : ` Other sports: ${fmt(other(w), 1)} h`;
            },
            footer: (items) => (isKm ? '' : `All sports: ${fmt(m.weeks[items[0].dataIndex].allHours, 1)} h`),
          },
        },
      },
    },
  });
  return isKm ? [] : [{ label: sportName, color: t.s1 }, { label: 'Other sports', color: t.other }];
}

// All sports: training time stacked by sport. Distance doesn't add up across sports.
function drawHoursBySport(m) {
  const t = theme();
  const keys = sportKeys(m.weeks);
  draw('chart-volume', {
    type: 'bar',
    data: {
      labels: m.weeks.map(barLabel(m)),
      datasets: keys.map((k, i) => ({
        label: sportLabel(k),
        data: m.weeks.map((w) => +(w.bySport[k]?.hours || 0).toFixed(2)),
        ...bar(t.sport(k), { borderRadius: i === keys.length - 1 ? 4 : 0, borderColor: t.surface, borderWidth: { top: i === keys.length - 1 ? 0 : 1.5 } }),
      })),
    },
    options: {
      ...base(t, { stacked: true, yTitle: 'hours' }),
      plugins: {
        ...base(t).plugins,
        tooltip: {
          ...base(t).plugins.tooltip,
          itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
          filter: (c) => c.raw > 0,
          callbacks: {
            title: (items) => barTitle(m, m.weeks[items[0].dataIndex]),
            label: (c) => {
              const s = m.weeks[c.dataIndex].bySport[keys[c.datasetIndex]];
              return ` ${c.dataset.label}: ${fmt(c.raw, 1)} h (${s.sessions})`;
            },
            footer: (items) => `All sports: ${fmt(m.weeks[items[0].dataIndex].hours, 1)} h`,
          },
        },
      },
    },
  });
  return keys.map((k) => ({ label: sportLabel(k), color: t.sport(k) }));
}

export function drawZones(m, kind) {
  const t = theme();
  const zones = kind === 'pace' ? m.zones.pace : m.zones.hr;
  const key = kind === 'pace' ? 'paceSecs' : 'hrSecs';
  const n = zones.count;
  draw('chart-zones', {
    type: 'bar',
    data: {
      labels: m.weeks.map(barLabel(m)),
      datasets: Array.from({ length: n }, (_, i) => ({
        label: zoneLabel(zones, i),
        data: m.weeks.map((w) => +((w[key][i] || 0) / 3600).toFixed(2)),
        ...bar(t.zone(i, n), {
          borderRadius: i === n - 1 ? 4 : 0,
          borderColor: t.surface,
          borderWidth: { top: i === n - 1 ? 0 : 2 },
          pointStyle: 'rectRounded',
        }),
      })),
    },
    options: {
      ...base(t, { stacked: true, yTitle: 'hours' }),
      plugins: {
        ...base(t).plugins,
        tooltip: {
          ...base(t).plugins.tooltip,
          itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
          filter: (c) => c.raw > 0,
          callbacks: {
            title: (items) => barTitle(m, m.weeks[items[0].dataIndex]),
            label: (c) => {
              const w = m.weeks[c.dataIndex];
              const total = kind === 'pace' ? w.paceTotalSecs : w.hrTotalSecs;
              const pct = total ? Math.round(((w[key][c.datasetIndex] || 0) / total) * 100) : 0;
              return ` ${c.dataset.label}: ${fmt(c.raw, 1)} h (${pct}%)`;
            },
          },
        },
      },
    },
  });
  return Array.from({ length: n }, (_, i) => ({ label: zoneLabel(zones, i), color: t.zone(i, n) }));
}

function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Shades form between −10 and −30, where training is productive, behind the lines.
function formBand(t) {
  return {
    id: 'formBand',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea: a, scales: { y } } = chart;
      const top = Math.max(a.top, y.getPixelForValue(-10));
      const bottom = Math.min(a.bottom, y.getPixelForValue(-30));
      if (bottom <= top) return;
      ctx.save();
      ctx.fillStyle = withAlpha(css('--state-productive'), 0.09);
      ctx.fillRect(a.left, top, a.right - a.left, bottom - top);
      ctx.fillStyle = t.muted;
      ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText('Productive form', a.left + 6, top + 5);
      ctx.restore();
    },
  };
}

// ---------- Line mode (comparison off) ----------

// Follows a finger or pointer along a line chart: draws a marker at the nearest day
// and reports its index (null when the pointer leaves or the finger lifts).
const SCRUB_EVENTS = ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove', 'touchend'];

function scrubber(onScrub) {
  return {
    id: 'scrubber',
    afterEvent(chart, args) {
      const e = args.event;
      let i = null;
      if (e.type !== 'mouseout' && e.type !== 'touchend') {
        const hits = chart.getElementsAtEventForMode(e, 'index', { intersect: false }, false);
        if (!hits.length) return;
        i = hits[0].index;
      }
      if (i === chart.$scrub) return;
      chart.$scrub = i;
      onScrub(i);
      args.changed = true;
    },
    afterDatasetsDraw(chart) {
      const i = chart.$scrub;
      const anchor = i == null ? null : chart.getDatasetMeta(0).data[i];
      if (!anchor) return;
      const { ctx, chartArea: a } = chart;
      ctx.save();
      ctx.strokeStyle = css('--text-3');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(anchor.x, a.top);
      ctx.lineTo(anchor.x, a.bottom);
      ctx.stroke();
      chart.data.datasets.forEach((ds, k) => {
        const p = chart.getDatasetMeta(k).data[i];
        if (!p || ds.data[i] == null || ds.type === 'bar' || chart.getDatasetMeta(k).hidden) return;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = ds.borderColor;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = css('--surface');
        ctx.stroke();
      });
      ctx.restore();
    },
  };
}

function lineSet(label, data, color, extra = {}) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    pointRadius: 4, // one dot per week (or day) so the points are easy to find
    pointBackgroundColor: color,
    pointBorderColor: css('--surface'),
    pointBorderWidth: 2,
    pointHoverRadius: 0, // the scrubber draws the marker
    cubicInterpolationMode: 'monotone', // smooth without dipping below zero on rest days
    borderCapStyle: 'round',
    borderJoinStyle: 'round',
    ...extra,
  };
}

function lineOptions(t, yTitle = '') {
  const b = base(t, { yTitle });
  return {
    ...b,
    events: SCRUB_EVENTS,
    scales: { ...b.scales, x: { ...b.scales.x, ticks: { ...b.scales.x.ticks, maxTicksLimit: 6 } } },
    plugins: { ...b.plugins, tooltip: { enabled: false } }, // the headline above the chart shows the value
  };
}

// The lines plot a list of points: m.weeks (the same points as the bars) or m.days.
// Days still to come in a calendar week are left off the line. Long daily lines
// drop the per-point dots, which would crowd together.
const values = (list, key, dp = 1) => list.map((w) => (w.future ? null : +w[key].toFixed(dp)));
const lineLabels = (m, list) =>
  list.map((w) => w.label || (w.days === 1 && m.grain === 'week' ? shortDate(w.from) : barLabel(m)(w)));
const dots = (list) => ({ pointRadius: list.length > 16 ? 0 : 4 });

// Planned points (days still to come, or weeks and days after the range) carry
// plannedLoad and draw as hatched bars under the line. Returns whether any do.
export function drawLoadLine(m, list, onScrub) {
  const t = theme();
  const planned = list.map((w) => (w.plannedLoad ? Math.round(w.plannedLoad) : null));
  const anyPlanned = planned.some((v) => v != null);
  const options = lineOptions(t);
  if (anyPlanned) options.scales.x.offset = true; // keeps the end bars whole
  draw('chart-load', {
    type: 'line',
    data: {
      labels: lineLabels(m, list),
      datasets: [
        lineSet('Load', values(list, 'load', 0), t.s1, { fill: 'origin', backgroundColor: withAlpha(t.s1, 0.1), ...dots(list) }),
        ...(anyPlanned ? [{ type: 'bar', label: 'Planned', data: planned, ...plannedBars(t) }] : []),
      ],
    },
    plugins: [scrubber(onScrub)],
    options,
  });
  return anyPlanned;
}

export function drawVolumeLine(m, list, measure, onScrub) {
  const t = theme();
  const isKm = measure === 'distance';
  const fill = { fill: 'origin', backgroundColor: withAlpha(t.s1, 0.1), ...dots(list) };
  const datasets = isKm
    ? [lineSet('Distance', values(list, 'distanceKm'), t.s1, fill)]
    : m.all
      ? [lineSet('All sports', values(list, 'hours', 2), t.s1, fill)]
      : [
          lineSet(m.sport.label, values(list, 'hours', 2), t.s1, fill),
          lineSet('All sports', values(list, 'allHours', 2), t.text, dots(list)),
        ];
  draw('chart-volume', {
    type: 'line',
    data: { labels: lineLabels(m, list), datasets },
    plugins: [scrubber(onScrub)],
    options: lineOptions(t, isKm ? 'km' : 'hours'),
  });
  return isKm || m.all ? [] : [{ label: m.sport.label, color: t.s1, line: true }, { label: 'All sports', color: t.text, line: true }];
}

// A dashed vertical line and the race name at each of this sport's races in view.
function raceMarker(m, points) {
  return {
    id: 'raceMarker',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea: a, scales: { x } } = chart;
      for (const r of m.plan.races) {
        const i = points.findIndex((p) => p.date === r.date);
        if (i < 0) continue;
        const px = x.getPixelForValue(i);
        ctx.save();
        ctx.strokeStyle = css('--text-2');
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(px, a.top);
        ctx.lineTo(px, a.bottom);
        ctx.stroke();
        ctx.fillStyle = css('--text-1');
        ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
        ctx.textBaseline = 'top';
        const right = px > (a.left + a.right) / 2;
        ctx.textAlign = right ? 'right' : 'left';
        ctx.fillText(r.name, px + (right ? -5 : 5), a.top + 4);
        ctx.restore();
      }
    },
  };
}

// The points the fitness chart plots: the range, then the forecast when it is shown.
export const fitnessPoints = (m) => [...m.fitness, ...m.forecastShown.map((p) => ({ ...p, forecast: true }))];

// onScrub is passed when comparison is off, so fitness reads out like the other lines.
// Forecast days continue each line dashed.
export function drawFitness(m, onScrub = null) {
  const t = theme();
  const points = fitnessPoints(m);
  const first = m.fitness.length; // index of the first forecast point
  const line = (label, key, color, extra = {}) => ({
    label,
    data: points.map((p) => +p[key].toFixed(1)),
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: onScrub ? 0 : (c) => (c.dataIndex >= first ? 0 : 5), // the scrubber draws its own marker
    pointHoverBorderColor: t.surface,
    pointHoverBorderWidth: 2,
    tension: 0.25,
    borderCapStyle: 'round',
    borderJoinStyle: 'round',
    segment: { borderDash: (c) => (c.p1DataIndex >= first ? [5, 4] : undefined) },
    ...extra,
  });
  const series = [
    { label: 'Fitness', key: 'fitness', color: t.s1, explain: EXPLAIN.fitness },
    { label: 'Fatigue', key: 'fatigue', color: t.s2, explain: EXPLAIN.fatigue },
    { label: 'Form', key: 'form', color: t.s3, explain: EXPLAIN.form },
  ];
  draw('chart-fitness', {
    type: 'line',
    data: {
      labels: points.map((p) => shortDate(p.date)),
      datasets: series.map((s, i) =>
        line(s.label, s.key, s.color, i === 0 ? { fill: 'origin', backgroundColor: withAlpha(s.color, 0.1) } : {}),
      ),
    },
    plugins: [formBand(t), raceMarker(m, points), ...(onScrub ? [scrubber(onScrub)] : [])],
    options: {
      ...base(t),
      ...(onScrub ? { events: SCRUB_EVENTS } : {}),
      scales: {
        ...base(t).scales,
        x: { ...base(t).scales.x, ticks: { ...base(t).scales.x.ticks, maxTicksLimit: 6 } },
        y: {
          ...base(t).scales.y,
          beginAtZero: false,
          suggestedMin: -30, // keep the productive band in view
          grid: { color: (c) => (c.tick.value === 0 ? css('--baseline') : t.grid) },
        },
      },
      plugins: {
        ...base(t).plugins,
        tooltip: onScrub
          ? { enabled: false }
          : {
              ...base(t).plugins.tooltip,
              callbacks: {
                title: (items) => longDay(points[items[0].dataIndex].date) + (items[0].dataIndex >= first ? ' (forecast)' : ''),
                label: (c) => ` ${c.dataset.label}: ${c.datasetIndex === 2 ? signed(c.raw) : fmt(c.raw)}`,
              },
            },
      },
    },
  });
  return series;
}

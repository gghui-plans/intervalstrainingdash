// The four charts. Chart.js is loaded globally from index.html.

import { dayLabel, longDay, shortDate } from './dates.js';
import { EXPLAIN, fmt, signed, zoneLabel } from './text.js';

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
  };
}

// Zones use one blue ramp, easy to hard, spread over however many zones exist.
function zoneStep(i, n) {
  return n <= 1 ? 1 : Math.round(1 + (i * 6) / (n - 1));
}

// Bars are weeks, or days for short ranges (m.grain).
const barLabel = (m) => (w) => (m.grain === 'day' ? dayLabel(w.from) : shortDate(w.from) + (w.partial ? '*' : ''));
const barTitle = (m, w) => (m.grain === 'day' ? longDay(w.from) : `Week of ${shortDate(w.from)}`);

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

export function drawLoad(m) {
  const t = theme();
  const weeks = m.weeks;
  draw('chart-load', {
    type: 'bar',
    data: {
      labels: weeks.map(barLabel(m)),
      datasets: [
        { label: 'Previous period', data: m.prevWeeks.map((w) => Math.round(w.load)), ...bar(t.prev) },
        { label: 'This period', data: weeks.map((w) => Math.round(w.load)), ...bar(t.s1) },
      ],
    },
    options: {
      ...base(t),
      plugins: {
        ...base(t).plugins,
        tooltip: {
          ...base(t).plugins.tooltip,
          callbacks: {
            title: (items) => barTitle(m, weeks[items[0].dataIndex]),
            label: (c) => {
              const w = (c.datasetIndex === 0 ? m.prevWeeks : weeks)[c.dataIndex];
              const when = c.datasetIndex === 0 ? ` (${m.grain === 'day' ? longDay(w.from) : `week of ${shortDate(w.from)}`})` : '';
              return ` ${c.dataset.label}${when}: ${fmt(w.load)}`;
            },
          },
        },
      },
    },
  });
}

// Distance is per sport only. Time stacks the selected sport on the other sports,
// so the full bar is total training time.
export function drawVolume(m, measure) {
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

export function drawFitness(m) {
  const t = theme();
  const line = (label, key, color, extra = {}) => ({
    label,
    data: m.fitness.map((p) => +p[key].toFixed(1)),
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 5,
    pointHoverBorderColor: t.surface,
    pointHoverBorderWidth: 2,
    tension: 0.25,
    borderCapStyle: 'round',
    borderJoinStyle: 'round',
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
      labels: m.fitness.map((p) => shortDate(p.date)),
      datasets: series.map((s, i) =>
        line(s.label, s.key, s.color, i === 0 ? { fill: 'origin', backgroundColor: withAlpha(s.color, 0.1) } : {}),
      ),
    },
    plugins: [formBand(t)],
    options: {
      ...base(t),
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
        tooltip: {
          ...base(t).plugins.tooltip,
          callbacks: {
            label: (c) => ` ${c.dataset.label}: ${c.datasetIndex === 2 ? signed(c.raw) : fmt(c.raw)}`,
          },
        },
      },
    },
  });
  return series;
}

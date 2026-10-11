// Date-only helpers. Dates are 'YYYY-MM-DD' strings in the athlete's local calendar;
// arithmetic happens in UTC so daylight-saving changes never shift a day.

const DAY = 86400000;

const toMs = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);

export function today() {
  const now = new Date();
  return fromMs(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export const addDays = (d, n) => fromMs(toMs(d) + n * DAY);
export const daysBetween = (a, b) => Math.round((toMs(b) - toMs(a)) / DAY); // b − a

export function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const shortDate = (d) => `${MONTHS[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;

export function rangeLabel(from, to) {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${shortDate(from)}${sameYear ? '' : ' ' + from.slice(0, 4)} – ${shortDate(to)} ${to.slice(0, 4)}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const weekday = (d) => WEEKDAYS[new Date(toMs(d)).getUTCDay()];
export const dayLabel = (d) => `${weekday(d)} ${+d.slice(8, 10)}`; // "Mon 5"
export const longDay = (d) => `${weekday(d)} ${shortDate(d)}`; // "Mon Oct 5"

// The first day of the calendar week containing d. startDow: 0 Sunday, 1 Monday.
export function startOfWeek(d, startDow) {
  const dow = new Date(toMs(d)).getUTCDay();
  return addDays(d, -((dow - startDow + 7) % 7));
}

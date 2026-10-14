// Small sport icons for the sport toggles and plan chips. They draw in currentColor.
// A sport added to SPORTS without an icon here gets a plain dot.

const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const stroke = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const ICONS = {
  all: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>'),
  running: svg(`<circle cx="14.5" cy="4.5" r="2"/><path d="M8 21l3-6 3 2.5V22M6 12l2.5-4 4.5-.5 2.5 4 3.5 1.5M13 7.5L11 15" ${stroke}/>`),
  paddling: svg(`<path d="M5 19L19 5" ${stroke}/><path d="M17 3.5c1.6-1 3.8.9 3 2.8l-1.6 1.6c-1 .8-2.4.5-3-.4l-.9-.9c-.9-.6-1.1-2-.4-3ZM7 20.5c-1.6 1-3.8-.9-3-2.8l1.6-1.6c1-.8 2.4-.5 3 .4l.9.9c.9.6 1.1 2 .4 3Z"/>`),
  biking: svg(`<g ${stroke}><circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9 9h6.5l3 7.5M9 9l3.5 7.5H5.5M15.5 9l-1-3H17"/></g>`),
  strength: svg(`<path d="M7 7v10M4 9.5v5M17 7v10M20 9.5v5M7 12h10" ${stroke}/>`),
};

export const icon = (key) => ICONS[key] || svg('<circle cx="12" cy="12" r="4"/>');

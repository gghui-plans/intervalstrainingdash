// Small DOM helpers shared by the dashboard and the plan view.

export const $ = (id) => document.getElementById(id);

export const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

// Text can include names from the user's intervals.icu settings or plan, so escape it
// before turning **emphasis** into bold.
export const emphasis = (text) => esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

// action is one { label, onClick } or a list of them.
export function showNotice(text, action) {
  const el = $('notice');
  el.replaceChildren(text);
  for (const a of [action || []].flat()) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: a.label });
    b.addEventListener('click', a.onClick);
    el.append(b);
  }
  el.hidden = false;
}

export const hideNotice = () => ($('notice').hidden = true);

// A short message at the bottom of the screen. With undo, it carries an Undo button
// and stays a little longer.
let toastTimer;
export function toast(text, { undo } = {}) {
  const el = $('toast');
  el.replaceChildren(text);
  if (undo) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'toast-undo', textContent: 'Undo' });
    b.addEventListener('click', () => {
      el.hidden = true;
      undo();
    });
    el.append(b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), undo ? 7000 : 3000);
}

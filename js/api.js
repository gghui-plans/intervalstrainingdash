// Thin wrapper over the intervals.icu REST API. The key goes only to API_BASE.

import { API_BASE } from './config.js';

export class ApiError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind; // 'auth' | 'network' | 'http'
  }
}

async function get(path, { apiKey, athleteId }, params = {}) {
  const url = new URL(`${API_BASE}/athlete/${encodeURIComponent(athleteId || '0')}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: 'Basic ' + btoa('API_KEY:' + apiKey) },
    });
  } catch {
    // fetch only throws on network failure, which includes a CORS rejection.
    throw new ApiError(
      'Could not reach intervals.icu. Check your connection. If this keeps happening, ' +
        'the browser may be blocking the request (CORS); open spike.html to diagnose.',
      'network',
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new ApiError('intervals.icu rejected the API key or athlete ID. Check them in Settings.', 'auth');
  }
  if (!res.ok) {
    throw new ApiError(`intervals.icu returned ${res.status} for ${path}.`, 'http');
  }
  return res.json();
}

export const fetchAthlete = (creds) => get('', creds);

export const fetchActivities = (creds, oldest, newest) =>
  get('/activities', creds, { oldest, newest });

export const fetchWellness = (creds, oldest, newest) =>
  get('/wellness', creds, { oldest, newest });

/* Where a block goes, and who it belongs to.
 *
 * Signed out, this page is what the script is without an account: the record
 * lives in the browser and nothing touches the network. Signed in, the record
 * is the same toolkit database the CLI writes to, reached with the shared
 * bl_session cookie every *.bang-labs.eu site already carries — so a block run
 * here shows up in `focus --history` on the desktop, and the other way round.
 */

import { addDays, today } from "./util.js";

export const CONFIG = Object.assign({
  api: "https://toolkit.bang-labs.eu",
  accounts: "https://accounts.bang-labs.eu",
}, window.FOCUS_CONFIG || {});

// Query overrides, so a dev server can be pointed at local services without
// editing anything: ?api=http://localhost:8014&accounts=http://localhost:8010
const params = new URLSearchParams(location.search);
for (const key of ["api", "accounts"]) {
  if (params.get(key)) CONFIG[key] = params.get(key);
}

const SESSIONS = "focus.sessions";
const PENDING = "focus.pending";
const PROFILE = "focus.profile";
const ACCOUNT = "focus.account";           // a hint only; the cookie is the truth
const BATCH = 500;                         // blocks per upload, so a long history pages

// Fixed, and the same constant the CLI uses, so one block derives one id
// wherever it is uploaded from.
const CSV_NAMESPACE = "c6db9b12-8780-4784-bd5a-6f9677fb3218";

/** Something the person needs to hear about a request, in their words. */
export class ApiError extends Error {}

/* --- the browser's own shelf ------------------------------------------------ */

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;                       // private window, or something older
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    /* nothing to be done about a full or blocked store, and losing the write
       is better than losing the block that is being written around it */
  }
}

export function loadProfile() {
  return read(PROFILE, {});
}

export function saveProfile(profile) {
  write(PROFILE, profile);
}

/* --- time, written the way the CSV writes it -------------------------------- */

/** Local wall clock as the rows carry it: 2026-09-16T14:05:00, no offset. */
export function localISO(moment) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}`
    + `T${pad(moment.getHours())}:${pad(moment.getMinutes())}:${pad(moment.getSeconds())}`;
}

/** A row's `started` back as a Date — naive text, read as local, as Python does. */
export function started(row) {
  return new Date(row.started);
}

/* --- talking to the services ------------------------------------------------- */

async function call(method, url, body) {
  let response;
  try {
    response = await fetch(url, {
      method,
      credentials: "include",              // the shared .bang-labs.eu session
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const host = new URL(url).host;
    throw new ApiError(`${host} is unreachable.`);
  }
  let data = {};
  try {
    data = await response.json();
  } catch (error) {
    data = {};
  }
  if (!response.ok) {
    // Every Bang Labs service answers an error with a `detail`, and its
    // wording beats anything invented here.
    let detail = data.detail;
    if (Array.isArray(detail) && detail.length) detail = detail[0].msg;
    if (response.status === 401) {
      signedOutNow();
      throw new ApiError(detail ? `${detail} Type: login` : "Not signed in. Type: login");
    }
    throw new ApiError(detail || `${new URL(url).host} said no (HTTP ${response.status}).`);
  }
  return data;
}

function api(method, path, body, params) {
  let url = CONFIG.api + path;
  if (params) {
    const query = new URLSearchParams(params).toString();
    if (query) url += "?" + query;
  }
  return call(method, url, body);
}

let account = read(ACCOUNT, null);         // username, or null when signed out

export function signedIn() {
  return account !== null;
}

export function accountName() {
  return account;
}

function signedOutNow() {
  account = null;
  write(ACCOUNT, null);
}

/** Ask accounts who this browser is, and remember the answer for the session. */
export async function whoami() {
  try {
    const answer = await call("GET", CONFIG.accounts + "/me");
    account = answer.username || null;
  } catch (error) {
    account = null;                        // signed out, or accounts is down
  }
  write(ACCOUNT, account);
  return account;
}

/** Where to send someone to sign in, and where they land afterwards. */
export function loginUrl(next = location.href) {
  return `${CONFIG.accounts}/login?next=${encodeURIComponent(next)}`;
}

export async function logout() {
  try {
    await call("POST", CONFIG.accounts + "/logout", {});
  } catch (error) {
    /* the cookie goes either way */
  }
  signedOutNow();
}

/* --- ids -------------------------------------------------------------------- */

function uuid4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return hexUuid(bytes);
}

function hexUuid(bytes) {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-`
    + `${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** A stable id for a block logged before there was an account to put it in.
 *
 * uuid5 over the block itself, with the namespace the CLI uses, so the same
 * block uploaded twice lands on the same row and the server's idempotency
 * does the rest.
 */
async function csvId(row) {
  const key = `${row.started}|${row.goal}|${row.actual_minutes}`;
  const namespace = CSV_NAMESPACE.replace(/-/g, "").match(/../g)
    .map((pair) => parseInt(pair, 16));
  const name = new TextEncoder().encode(key);
  const input = new Uint8Array(namespace.length + name.length);
  input.set(namespace, 0);
  input.set(name, namespace.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", input));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;     // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return hexUuid(bytes);
}

/* --- rows in, rows out ------------------------------------------------------- */

/** A block from the API in the shape the rest of the page reads: the CSV's. */
function asRow(session) {
  return {
    started: localISO(new Date(session.started_at)),
    goal: session.goal,
    planned_minutes: String(session.planned_minutes),
    actual_minutes: session.actual_minutes.toFixed(1),
    completed: session.completed ? "yes" : "no",
  };
}

/** A stored row in the shape the API takes. */
async function asSession(row) {
  return {
    client_id: await csvId(row),
    started_at: new Date(row.started).toISOString(),
    goal: row.goal,
    planned_minutes: parseFloat(row.planned_minutes),
    actual_minutes: parseFloat(row.actual_minutes),
    completed: row.completed === "yes",
  };
}

function device() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  return platform ? `web (${platform})`.slice(0, 64) : "web";
}

/* --- the local record -------------------------------------------------------- */

export function localLog({ since = null, until = null, limit = null } = {}) {
  let rows = read(SESSIONS, []);
  if (since !== null || until !== null) {
    rows = rows.filter((row) => {
      const when = started(row);
      if (since !== null && when < since) return false;
      if (until !== null && when >= until) return false;
      return true;
    });
  }
  return limit ? rows.slice(-limit) : rows;
}

function recordLocally(row) {
  const rows = read(SESSIONS, []);
  rows.push(row);
  write(SESSIONS, rows);
}

/* --- what is waiting to go up ------------------------------------------------- */

function pending() {
  return read(PENDING, []);
}

function hold(sessions) {
  write(PENDING, sessions);
}

export function waiting() {
  return pending().length;
}

/** Send whatever is waiting, in pages. Returns how many blocks landed. */
export async function flush(loud = false) {
  const queue = pending();
  if (!queue.length) return 0;
  let sent = 0;
  for (let start = 0; start < queue.length; start += BATCH) {
    const page = queue.slice(start, start + BATCH);
    try {
      const answer = await api("POST", "/focus/sessions/import", { sessions: page });
      sent += answer.created;
    } catch (error) {
      // Keep only what has not gone up, so a flush that fails halfway still
      // made progress instead of resending from the top forever.
      hold(queue.slice(start));
      if (loud) throw error;
      return sent;
    }
  }
  hold([]);
  return sent;
}

/* --- the two ways a block is kept --------------------------------------------- */

/** Keep the block: in the account when there is one, in the browser when there
 *  is not, and never nowhere. Returns a note to print, or nothing. */
export async function record(startedAt, goal, planned, actual, completed, theme) {
  const row = {
    started: localISO(startedAt),
    goal,
    planned_minutes: String(planned),
    actual_minutes: actual.toFixed(1),
    completed: completed ? "yes" : "no",
  };
  if (!signedIn()) {
    recordLocally(row);
    return null;
  }

  const session = {
    client_id: uuid4(),
    started_at: startedAt.toISOString(),
    goal,
    planned_minutes: Number(planned),
    actual_minutes: Math.round(actual * 10) / 10,
    completed,
    theme: theme || null,
    device: device(),
  };
  try {
    await api("POST", "/focus/sessions", session);
  } catch (error) {
    hold([...pending(), session]);
    return `Kept in this browser for now — ${error.message}`;
  }
  await flush();                           // anything an earlier block left
  return null;
}

/** Blocks, oldest first, in the CSV's shape whatever the source. */
export async function readLog({ since = null, until = null, limit = null } = {}) {
  if (!signedIn()) return localLog({ since, until, limit });
  const params = {};
  if (since !== null) params.since = since.toISOString();
  if (until !== null) params.until = until.toISOString();
  if (limit !== null) params.limit = Math.min(limit, 1000);
  const answer = await api("GET", "/focus/sessions", undefined, params);
  return answer.sessions.map(asRow);
}

/** Minutes today, minutes over the last seven days, blocks ever.
 *
 * Both window edges are worked out here, from this browser's clock, because
 * "today" is a local question and the server has no business guessing it.
 */
export async function summary() {
  const midnight = today();
  const week = addDays(midnight, -6);
  if (signedIn()) {
    const answer = await api("GET", "/focus/sessions/summary", undefined, {
      day_since: midnight.toISOString(),
      week_since: week.toISOString(),
    });
    return [answer.today_minutes, answer.week_minutes, answer.total_sessions];
  }
  const rows = localLog();
  let todayMin = 0.0, weekMin = 0.0;
  for (const row of rows) {
    const when = started(row);
    const minutes = parseFloat(row.actual_minutes);
    if (when >= midnight) todayMin += minutes;
    if (when >= week) weekMin += minutes;
  }
  return [todayMin, weekMin, rows.length];
}

/** Send the blocks this browser logged before there was an account for them. */
export async function uploadLocal() {
  const rows = localLog();
  if (!rows.length) return { created: 0, already: 0 };
  const sessions = [];
  for (const row of rows) sessions.push(await asSession(row));
  let created = 0;
  for (let start = 0; start < sessions.length; start += BATCH) {
    const answer = await api("POST", "/focus/sessions/import",
                             { sessions: sessions.slice(start, start + BATCH) });
    created += answer.created;
  }
  return { created, already: sessions.length - created };
}

export function countLocal() {
  return localLog().length;
}

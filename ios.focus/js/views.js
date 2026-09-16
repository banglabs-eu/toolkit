/* --log and --history, printed into the scrollback the way they print into a
 * terminal: the same columns, the same strip of hours, the same words. */

import {
  ACCENT, AMBER, BOLD, DIM, GREEN, addDays, cut, dayName, hhmm, longDate,
  monthName, padEnd, padStart, sameDay, spell, today, width,
} from "./util.js";
import { ApiError, readLog, started, summary } from "./store.js";

/** 23:50-00:15 is one block, not a span running backwards, so an end that
 *  falls on the next day says so. */
function stamp(moment, day, room = 5) {
  const clock = hhmm(moment);
  if (sameDay(moment, day) || clock === "00:00") return padEnd(clock, room);
  return padEnd(clock + "+1", room);
}

/** A day, written as it comes to mind.
 *
 * today, yesterday, a weekday name for the most recent one, a bare number for
 * that day of this month, or a date — day first: 14-9, 14/09/2026, or ISO.
 * Returns null if it cannot be read.
 */
export function parseWhen(text) {
  const now = today();
  let word = (text || "").trim().toLowerCase();
  if (word === "" || word === "today") return now;
  if (word === "yesterday" || word === "yday") return addDays(now, -1);
  if (word.length >= 3 && /^[a-z]+$/.test(word)) {
    for (let back = 0; back < 7; back++) {          // the most recent Tuesday, etc.
      const day = addDays(now, -back);
      if (dayName(day).toLowerCase().startsWith(word)) return day;
    }
    return null;
  }

  for (const separator of ["-", "/", ".", ","]) word = word.split(separator).join(" ");
  const parts = word.split(/\s+/).filter((part) => /^\d+$/.test(part)).map(Number);
  const make = (y, m, d) => {
    const day = new Date(y, m - 1, d);
    return (day.getFullYear() === y && day.getMonth() === m - 1 && day.getDate() === d)
      ? day : null;
  };
  if (parts.length === 3 && String(parts[0]).length === 4) return make(parts[0], parts[1], parts[2]);
  if (parts.length === 3) {
    const year = parts[2];
    return make(year < 100 ? year + 2000 : year, parts[1], parts[0]);
  }
  // A day with no year, or no month, means the most recent one that has already
  // happened — nobody asks what they did next Thursday.
  if (parts.length === 2) {
    const day = make(now.getFullYear(), parts[1], parts[0]);
    if (!day) return null;
    return day <= now ? day : make(now.getFullYear() - 1, parts[1], parts[0]);
  }
  if (parts.length === 1) {
    let day = make(now.getFullYear(), now.getMonth() + 1, parts[0]);
    if (day && day > now) {
      const month = now.getMonth() === 0 ? 12 : now.getMonth();
      day = make(now.getFullYear() - (now.getMonth() === 0 ? 1 : 0), month, parts[0]);
    }
    return day;
  }
  return null;
}

/** Every session that started on that day, in the order it happened. */
export function blocksOn(rows, day) {
  const blocks = [];
  for (const row of rows) {
    const when = started(row);
    if (!sameDay(when, day)) continue;
    const minutes = parseFloat(row.actual_minutes);
    blocks.push([when, new Date(when.getTime() + minutes * 60000), minutes,
                 row.goal, row.completed === "yes"]);
  }
  return blocks.sort((a, b) => a[0] - b[0]);
}

/** The day as one row of cells, from the hour the first block started to the
 *  hour the last one ended: filled where you were working, dots between. */
export function strip(blocks, room) {
  const first = new Date(blocks[0][0]);
  first.setMinutes(0, 0, 0);
  const last = new Date(Math.max(...blocks.map((block) => block[1].getTime())));
  const ceiling = new Date(last);
  ceiling.setMinutes(0, 0, 0);
  if (ceiling < last) ceiling.setHours(ceiling.getHours() + 1);
  const span = Math.max((ceiling - first) / 1000, 3600.0);
  const cells = new Array(room).fill("·");
  for (const [from, to, , , completed] of blocks) {
    const start = Math.trunc(((from - first) / 1000 / span) * room);
    const stop = Math.ceil(((to - first) / 1000 / span) * room);
    for (let cell = Math.max(0, start); cell < Math.min(room, Math.max(stop, start + 1)); cell++) {
      cells[cell] = completed ? "█" : "▒";
    }
  }
  return [first, ceiling, cells.join("")];
}

/** One day: what each block was for, when it started, when it stopped. */
export function showDay(term, rows, day, cols) {
  let title = longDate(day);
  if (day.getFullYear() !== today().getFullYear()) title += ` ${day.getFullYear()}`;
  const blocks = blocksOn(rows, day);
  if (!blocks.length) {
    term.write([[title, BOLD], [" — nothing logged.", ""]]);
    return 0.0;
  }

  const focused = blocks.reduce((sum, block) => sum + block[2], 0);
  // Wider columns only on a day that needs them: most days end before midnight.
  const room = blocks.some((block) => !sameDay(block[1], day)) ? 7 : 5;
  const last = new Date(Math.max(...blocks.map((block) => block[1].getTime())));
  const line = `${blocks.length} block${blocks.length === 1 ? "" : "s"} · `
    + `${spell(focused)} focused · ${hhmm(blocks[0][0])} to ${stamp(last, day).trim()}`;
  if (width(title) + width(line) + 3 <= cols) {
    term.write([[title, BOLD + ACCENT], [` — ${line}`, ""]]);
  } else {                                      // too narrow for one line
    term.write([[title, BOLD + ACCENT]]);
    term.write([["  " + line, DIM]]);
  }
  term.write();

  const goalRoom = Math.max(20, cols - 38);
  for (let index = 0; index < blocks.length; index++) {
    const [from, to, minutes, goal, completed] = blocks[index];
    if (index) {
      const gap = (from - blocks[index - 1][1]) / 60000;
      if (gap >= 5) term.write([[`    ⋯  ${spell(gap)} away`, DIM]]);
    }
    const short = width(goal) > goalRoom - (room - 5)
      ? cut(goal, goalRoom - 1) + "…" : goal;
    term.write([
      [`  ${hhmm(from)}–${stamp(to, day, room)}  ${padStart(minutes.toFixed(1), 6)} min  `, ""],
      [padEnd(completed ? "done" : "stopped", 7), completed ? GREEN : AMBER],
      ["  " + short, ""],
    ]);
  }

  term.write();
  const [from, to, cells] = strip(blocks, Math.max(12, Math.min(cols - 16, 60)));
  term.write([["  " + hhmm(from), DIM], [" " + cells + " ", ACCENT],
              [stamp(to, day).trim(), DIM]]);
  return focused;
}

/** history: a day at a time, or the last seven days at once. */
export async function showHistory(term, when, cols) {
  const now = today();
  const word = (when || "today").trim().toLowerCase();
  const aWeek = ["week", "7", "7d"].includes(word);
  let days;
  if (aWeek) {
    days = [];
    for (let back = 6; back >= 0; back--) days.push(addDays(now, -back));
  } else {
    const day = parseWhen(word);
    if (day === null) {
      term.write([[`I could not read "${when}" as a day. Try today, yesterday, `
        + "monday, 14-9 or 2026-09-14.", AMBER]]);
      return 1;
    }
    days = [day];
  }

  // One read for the whole span however many days it covers: the account is a
  // network hop away, and seven of them to draw one week would be silly.
  const start = days[0];
  const end = addDays(days[days.length - 1], 1);
  try {
    const rows = await readLog({ since: start, until: end });
    if (!rows.length && !(await summary())[2]) {
      term.write("No sessions yet. Type a goal and press enter.");
      return 0;
    }

    if (aWeek) {
      days = days.filter((day) => blocksOn(rows, day).length);
      if (!days.length) {
        term.write("Nothing logged in the last seven days.");
        return 0;
      }
    }

    let total = 0.0;
    for (let index = 0; index < days.length; index++) {
      if (index) term.write();
      total += showDay(term, rows, days[index], cols);
    }

    if (days.length > 1) {
      term.write();
      term.write([[spell(total), BOLD], [` across ${days.length} days.`, ""]]);
    } else if (!total) {
      const earlier = await readLog({ until: start, limit: 1 });
      if (earlier.length) {
        const seen = started(earlier[0]);
        term.write(`The last block before that was ${longDate(seen)}.`);
      }
    }
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    term.write([[error.message, AMBER]]);
    return 1;
  }
  return 0;
}

export async function showLog(term, limit) {
  let todayMin, weekMin, total, rows;
  try {
    [todayMin, weekMin, total] = await summary();
    rows = await readLog({ limit });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    term.write([[error.message, AMBER]]);
    return 1;
  }
  if (!rows.length) {
    term.write("No sessions yet. Type a goal and press enter.");
    return 0;
  }

  term.write(`Today ${Math.trunc(todayMin)} min · last 7 days `
    + `${Math.trunc(weekMin)} min · ${total} sessions logged`);
  term.write();

  const goalWidth = Math.max(20, Math.min(50, Math.max(...rows.map((r) => width(r.goal)))));
  const short = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (const row of rows) {
    const when = started(row);
    let goal = row.goal;
    if (width(goal) > goalWidth) goal = cut(goal, goalWidth - 1) + "…";
    const stampText = `${short[when.getDay()]} ${String(when.getDate()).padStart(2, "0")} `
      + `${monthName(when).slice(0, 3)} ${hhmm(when)}`;
    term.write(`${stampText}  ${padEnd(goal, goalWidth)}  `
      + `${padStart(row.actual_minutes, 5)} min  `
      + `${row.completed === "yes" ? "done" : "stopped"}`);
  }
  return 0;
}

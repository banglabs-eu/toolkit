/* The small pieces focus is built out of, carried over from the script.
 *
 * A tint is a string, exactly as it is in the terminal: there it is an ANSI
 * escape, here it is a colour with optional markers, so that `DIM + tint` and
 * `BOLD + ACCENT` still mean what they mean in Python.
 */

// Markers rather than printable text: a tint carries them the way an ANSI
// escape carries bold and dim in the terminal, so `DIM + tint` composes.
export const BOLD = String.fromCharCode(1);
export const DIM = String.fromCharCode(2);
export const RESET = "";
export const ESC = String.fromCharCode(27);   // what Escape sends
export const ETX = String.fromCharCode(3);    // what Ctrl-C sends
export const VS16 = String.fromCodePoint(0xFE0F);   // makes an emoji an emoji
const MARKERS = new RegExp(`[${BOLD}${DIM}]`, "g");

export function rgb(r, g, b) {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export const ACCENT = rgb(99, 102, 241);       // Bang Labs indigo
export const AMBER = rgb(245, 158, 11);
export const GREEN = rgb(34, 197, 94);

/** Split a tint into what the renderer needs: colour, bold, dim. */
export function readTint(tint) {
  if (!tint) return { colour: "", bold: false, dim: false };
  return {
    colour: tint.replace(MARKERS, ""),
    bold: tint.includes(BOLD),
    dim: tint.includes(DIM),
  };
}

/* --- numbers, the way Python does them ------------------------------------ */

/** Python's %, which never comes out negative — every use here indexes. */
export function mod(a, b) {
  return ((a % b) + b) % b;
}

/** Python's int(): towards zero. Canvas uses floor deliberately, so it says so. */
export const trunc = Math.trunc;

export function uniform(a, b) {
  return a + Math.random() * (b - a);
}

export function randint(a, b) {                // inclusive, as in Python
  return a + Math.floor(Math.random() * (b - a + 1));
}

export function randrange(n) {
  return Math.floor(Math.random() * n);
}

export function choice(seq) {
  return seq[Math.floor(Math.random() * seq.length)];
}

export function chance(p) {
  return Math.random() < p;
}

export function range(a, b, step = 1) {
  const out = [];
  if (b === undefined) { b = a; a = 0; }
  if (step > 0) for (let i = a; i < b; i += step) out.push(i);
  else for (let i = a; i > b; i += step) out.push(i);
  return out;
}

/* --- text ------------------------------------------------------------------ */

/** Characters, not UTF-16 units, so an emoji in a goal stays one cell. */
export function chars(text) {
  return Array.from(text);
}

export function width(text) {
  return chars(text).length;
}

/** Cut a string to n characters, as Python's text[:n] does. */
export function cut(text, n) {
  return chars(text).slice(0, n).join("");
}

export function padEnd(text, n) {
  const short = n - width(text);
  return short > 0 ? text + " ".repeat(short) : text;
}

export function padStart(text, n) {
  const short = n - width(text);
  return short > 0 ? " ".repeat(short) + text : text;
}

export function repeat(text, n) {
  return n > 0 ? text.repeat(Math.floor(n)) : "";
}

// Turning a sprite round: reverse each line, then swap the characters that
// have a handedness. Every sprite is drawn facing right.
const FLIP = {
  "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{",
  "<": ">", ">": "<", "/": "\\", "\\": "/", d: "b", b: "d",
};

export function mirror(art) {
  const span = Math.max(...art.map((line) => width(line)));
  return art.map((line) =>
    chars(padEnd(line, span)).reverse().map((c) => FLIP[c] || c).join(""));
}

/* --- the clock face -------------------------------------------------------- */

// 3x5 bitmaps, one string per row, drawn two columns wide so the digits come
// out roughly square on a cell grid.
const GLYPHS = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  ":": ["0", "1", "0", "1", "0"],
  // Letters are four wide: three cannot hold a diagonal, so N came out solid.
  D: ["1110", "1001", "1001", "1001", "1110"],
  O: ["0110", "1001", "1001", "1001", "0110"],
  N: ["1001", "1101", "1011", "1001", "1001"],
  E: ["1111", "1000", "1110", "1000", "1111"],
};
export const GLYPH_ROWS = 5;

/** Render a clock string as a list of GLYPH_ROWS wide lines. */
export function big(text) {
  const lines = [];
  for (let row = 0; row < GLYPH_ROWS; row++) {
    const parts = [];
    for (const ch of chars(text)) {
      const bits = (GLYPHS[ch] || ["000", "000", "000", "000", "000"])[row];
      parts.push(chars(bits).map((b) => (b === "1" ? "██" : "  ")).join(""));
    }
    lines.push(parts.join("  "));
  }
  return lines;
}

export function clock(seconds) {
  seconds = Math.max(0, Math.floor(seconds + 0.5));
  const pad = (n) => String(n).padStart(2, "0");
  if (seconds >= 3600) {
    return `${Math.floor(seconds / 3600)}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  }
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

/** Bresenham, so a dendrite between two cells is a run of adjacent cells. */
export function line(x0, y0, x1, y1) {
  const points = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    points.push([x0, y0]);
    if (x0 === x1 && y0 === y1) return points;
    const twice = 2 * err;
    if (twice >= dy) { err += dy; x0 += sx; }
    if (twice <= dx) { err += dx; y0 += sy; }
  }
}

/* --- the calendar ---------------------------------------------------------- */

/** Easter moves, so it has to be computed: Meeus's Gregorian algorithm. */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const moon = (32 + 2 * e + 2 * i - h - k) % 7;
  const correction = Math.floor((a + 11 * h + 22 * moon) / 451);
  const month = Math.floor((h + moon - 7 * correction + 114) / 31);
  const day = ((h + moon - 7 * correction + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

export function today() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function addDays(day, n) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + n);
}

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/* --- GlyphClock ------------------------------------------------------------ */

// The 1440 minutes from UTC midnight cut into 16 blocks of 90, a glyph to
// each, and each block into three turns of 30 shown as one, two or three
// copies of it. Same reading everywhere, no timezone.
export const GLYPH_EMOJI = ["\u{1F950}", "\u{1F98B}", "\u{1F337}", "☂️",
                            "\u{1F335}", "\u{1F388}", "\u{1F453}", "⚓",
                            "\u{1F99A}", "\u{1F916}", "⭐", "☁️",
                            "\u{1F332}", "\u{1FA81}", "\u{1FA91}", "♻"];
export const GLYPH_NAMES = ["croissant", "butterfly", "tulip", "umbrella",
                            "cactus", "balloon", "glasses", "anchor",
                            "peacock", "robot", "star", "cloud",
                            "tree", "kite", "chair", "recycle"];

/** The GlyphClock reading now: the block's glyph, how many, and its name. */
export function glyphclock(moment = new Date()) {
  const minute = moment.getUTCHours() * 60 + moment.getUTCMinutes();
  const block = Math.min(Math.floor(minute / 90), 15);
  const turn = Math.min(Math.floor((minute % 90) / 30), 2);
  return { emoji: GLYPH_EMOJI[block], count: turn + 1, name: GLYPH_NAMES[block] };
}

/* --- saying it in words ---------------------------------------------------- */

/** 95 minutes reads better as 1 h 35 min. */
export function spell(minutes) {
  minutes = Math.round(minutes);
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** %g, near enough: 25 stays 25, 12.5 stays 12.5. */
export function number(value) {
  return String(Math.round(value * 1e6) / 1e6);
}

export function hhmm(moment) {
  return String(moment.getHours()).padStart(2, "0") + ":"
    + String(moment.getMinutes()).padStart(2, "0");
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];

export function dayName(day) {
  return DAYS[day.getDay()];
}

export function monthName(day) {
  return MONTHS[day.getMonth()];
}

/** Monday 15 September, and the year too when it is not this one. */
export function longDate(day, withYear = false) {
  const stamp = `${dayName(day)} ${day.getDate()} ${monthName(day)}`;
  return withYear ? `${stamp} ${day.getFullYear()}` : stamp;
}

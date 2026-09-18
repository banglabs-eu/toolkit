/* What is drawn over the scene: the clock itself, and the six seconds after it.
 *
 * Every line blanks what is behind it, so a scene never intrudes into the
 * text: a plane crossing the hint is cut by it rather than mixed into it.
 */

import {
  ACCENT, AMBER, BOLD, DIM, GREEN, big, choice, clock, cut, glyphclock,
  hhmm, mod, number, rgb, trunc, uniform, width,
} from "./util.js";
import { THEMES } from "./themes.js";

export const FRAME = 0.1;                   // seconds between redraws
export const FINALE = 6.0;                  // seconds of celebration when a block lands
export const FINALES = ["fireworks", "shockwave", "confetti"];

export const SPARKS = [rgb(255, 215, 95), rgb(255, 125, 90), rgb(120, 220, 255),
                       rgb(195, 145, 255), rgb(140, 250, 150), rgb(255, 255, 255)];

/** The focus, the clock, the bar and the hint, centred over whatever scene. */
export function compose(canvas, goal, remaining, total, paused, startedAt,
                        choosing = null, standing = null) {
  const cols = canvas.cols, rows = canvas.rows;
  const tint = (paused || remaining <= 60) ? AMBER : ACCENT;

  const text = clock(remaining);
  let digits = big(text);
  if (width(digits[0]) > cols - 2) digits = [text];         // too narrow for block digits

  const goalLine = width(goal) <= cols - 4 ? goal : cut(goal, cols - 5) + "…";

  const barWidth = Math.min(44, Math.max(10, cols - 10));
  const filled = Math.round((total ? 1 - remaining / total : 1) * barWidth);

  const length = total % 60 ? `${number(total / 60)} min` : `${Math.floor(total / 60)} min`;
  const state = paused ? "paused" : "started " + hhmm(startedAt);
  let keys = `space ${paused ? "resume" : "pause"} · t theme · q stop`;
  let short = "space · t · q";
  if (choosing !== null) {                    // the picker says how to leave it
    keys = "← → scene · d default · t, enter or esc to go back";
    short = "← → · d · enter";
  }
  let hint = keys;
  for (const option of [`${length} · ${state} · ${keys}`, `${length} · ${keys}`,
                        keys, short]) {       // the last one fits anything
    hint = option;
    if (width(option) <= cols - 2) break;
  }

  const lines = [[[" " + goalLine + " ", BOLD]], []];
  for (const row of digits) lines.push([[row, tint]]);
  lines.push([], [["━".repeat(filled), tint], ["━".repeat(barWidth - filled), DIM]], []);
  lines.push([[" " + hint + " ", DIM]]);

  const top = Math.max(0, Math.floor((rows - lines.length) / 2));
  for (let i = 0; i < lines.length; i++) {
    const segments = lines[i];
    let x = Math.max(0, Math.floor(
      (cols - segments.reduce((sum, [s]) => sum + width(s), 0)) / 2));
    for (const [segment, segTint] of segments) {
      canvas.put(x, top + i, segment, segTint, true);
      x += width(segment);
    }
  }

  const below = top + lines.length;
  const taken = corner(canvas, below);
  if (choosing !== null) picker(canvas, choosing, below, cols - 4 - taken, standing);
}

/** The GlyphClock reading, dim in the bottom right, out of the clock's way.
 *
 * The glyph on its own: the picture is the reading, and a name beside it would
 * only be the picture spelled out. A glyph is one cell here but two on the
 * screen, so each is padded out to the width it will take and nothing
 * downstream of it shifts.
 *
 * Returns the columns it took, which is what the corner opposite has left.
 */
export function corner(canvas, below) {
  const row = canvas.rows - 2;
  if (row < below) return 0;                    // a short window: the clock first
  const { emoji, count } = glyphclock();
  const text = " " + (emoji + " ".repeat(Math.max(0, 2 - width(emoji)))).repeat(count);
  if (width(text) + 2 > canvas.cols) return 0;
  canvas.put(canvas.cols - 2 - width(text), row, text, DIM, true);
  return width(text) + 2;
}

/** The scene rota along the bottom, with the one on screen picked out.
 *
 * Only as much of it as fits: the list is windowed around the choice and grown
 * outwards until the room runs out, with a chevron on whichever side still has
 * names behind it. The scene itself is the preview — this is only the label
 * for what is already being drawn. The default, if there is one, is the name
 * in green.
 */
export function picker(canvas, at, below, room, standing = null) {
  let row = canvas.rows - 2;
  if (room < 12) {                            // the GlyphClock has that row
    row = canvas.rows - 1;
    room = canvas.cols - 2;
  }
  if (row < below || room < 12) return;
  const rota = [...THEMES.keys()];
  const marked = rota.map((name, i) => (i === at ? `[${name}]` : ` ${name} `));
  let left = at, right = at;
  let taken = width(marked[at]) + 2;          // the chevrons' own room
  for (;;) {
    let grew = false;
    if (left > 0 && taken + width(marked[left - 1]) <= room) {
      left--;
      taken += width(marked[left]);
      grew = true;
    }
    if (right < rota.length - 1 && taken + width(marked[right + 1]) <= room) {
      right++;
      taken += width(marked[right]);
      grew = true;
    }
    if (!grew) break;
  }

  const segments = [[left > 0 ? "‹" : " ", DIM]];
  for (let i = left; i <= right; i++) {
    const kept = rota[i] === standing;
    segments.push([marked[i], (i === at ? BOLD : "")
      + (kept ? GREEN : i === at ? ACCENT : DIM)]);
  }
  segments.push([right < rota.length - 1 ? "›" : " ", DIM]);

  let x = 1;
  for (const [text, tint] of segments) {
    canvas.put(x, row, text, tint, true);
    x += width(text);
  }
}

/** DONE across the middle, with what it was for underneath. */
export function banner(canvas, goal, minutes, now) {
  const cols = canvas.cols, rows = canvas.rows;
  const flash = Math.sin(now * 7.0) > 0 ? GREEN : rgb(205, 255, 215);
  let word = big("DONE");
  if (width(word[0]) > cols - 2) word = ["DONE"];
  let caption = `${number(minutes)} minutes · ${goal}`;
  if (width(caption) > cols - 4) caption = cut(caption, cols - 5) + "…";

  const lines = word.map((row) => [[row, BOLD + flash]]);
  lines.push([], [[" " + caption + " ", BOLD]], [["any key to close", DIM]]);
  const top = Math.max(0, Math.floor((rows - lines.length) / 2));
  for (let i = 0; i < lines.length; i++) {
    const segments = lines[i];
    let x = Math.max(0, Math.floor(
      (cols - segments.reduce((sum, [s]) => sum + width(s), 0)) / 2));
    for (const [text, tint] of segments) {
      canvas.put(x, top + i, text, tint, true);
      x += width(text);
    }
  }
}

/** The last seconds of a block: loud enough to see from across the room. */
export class Finale {
  constructor(style) {
    this.style = style;
    this.rockets = [];
    this.sparks = [];
    this.rings = [];
    this.bits = [];
    this.nextRocket = 0.0;
    this.nextRing = 0.0;
    this.last = null;
  }

  burst(x, y, now, tint) {
    for (let i = 0; i < 30; i++) {
      const angle = (i / 30) * Math.PI * 2 + uniform(-0.06, 0.06);
      const speed = uniform(5.0, 13.0);
      this.sparks.push([x, y, Math.cos(angle) * speed * 2.0, Math.sin(angle) * speed,
                        now, tint]);
    }
  }

  fireworks(canvas, dt, now, t, cols, rows) {
    if (t < FINALE - 2.0 && now >= this.nextRocket) {
      this.rockets.push([uniform(cols * 0.08, cols * 0.92), rows - 1,
                         -uniform(13.0, 19.0), uniform(1.0, rows * 0.45), choice(SPARKS)]);
      this.nextRocket = now + uniform(0.18, 0.5);
    }
    for (const rocket of [...this.rockets]) {
      rocket[1] += rocket[2] * dt;
      if (rocket[1] <= rocket[3]) {                  // apogee, and it lets go
        this.burst(rocket[0], rocket[1], now, rocket[4]);
        this.rockets.splice(this.rockets.indexOf(rocket), 1);
        continue;
      }
      canvas.put(rocket[0], rocket[1], "|", rocket[4]);
      canvas.put(rocket[0], rocket[1] + 1, ".", DIM + rocket[4]);
    }

    for (const spark of [...this.sparks]) {
      const age = now - spark[4];
      if (age > 1.9) {
        this.sparks.splice(this.sparks.indexOf(spark), 1);
        continue;
      }
      spark[0] += spark[2] * dt;
      spark[1] += spark[3] * dt;
      spark[3] += 11.0 * dt;                         // they fall as they fade
      spark[2] *= 0.985;
      canvas.put(spark[0], spark[1],
                 age < 0.3 ? "*" : age < 0.7 ? "+" : age < 1.2 ? "·" : ".",
                 age < 1.0 ? spark[5] : DIM + spark[5]);
    }
  }

  shockwave(canvas, dt, now, t, cols, rows) {
    if (now >= this.nextRing && t < FINALE - 1.2) {
      this.rings.push([now, choice(SPARKS)]);
      this.nextRing = now + 0.5;
    }
    const cx = cols / 2.0, cy = rows / 2.0;
    for (const ring of [...this.rings]) {
      const age = now - ring[0];
      const radius = age * 15.0;
      if (radius * 2 > cols + 10) {
        this.rings.splice(this.rings.indexOf(ring), 1);
        continue;
      }
      const char = age < 0.25 ? "O" : age < 0.6 ? "o" : age < 1.1 ? "·" : ".";
      const steps = Math.max(16, trunc(radius * 7));
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        canvas.put(cx + Math.cos(angle) * radius * 2.0, cy + Math.sin(angle) * radius,
                   char, age < 0.8 ? ring[1] : DIM + ring[1]);
      }
    }
  }

  confetti(canvas, dt, now, t, cols, rows) {
    while (this.bits.length < cols * 2 && t < FINALE - 1.5) {
      this.bits.push([uniform(0, cols), uniform(-rows, 0), uniform(-1.5, 1.5),
                      uniform(6.0, 15.0), choice(SPARKS), uniform(0, 6.3)]);
    }
    for (const bit of this.bits) {
      bit[0] += (bit[2] + Math.sin(now * 4.0 + bit[5]) * 2.0) * dt;
      bit[1] += bit[3] * dt;
      if (bit[1] > rows) {                           // round again, until it stops
        bit[1] = -1.0;
        bit[0] = uniform(0, cols);
      }
      canvas.put(bit[0], bit[1], "/\\|-o*v"[mod(trunc(bit[5] * 7), 7)], bit[4]);
    }
  }

  draw(canvas, now, t) {
    const dt = this.last === null ? 0.0 : Math.min(0.25, now - this.last);
    this.last = now;
    const painter = this.style === "fireworks" ? this.fireworks
      : this.style === "shockwave" ? this.shockwave : this.confetti;
    painter.call(this, canvas, dt, now, t, canvas.cols, canvas.rows);
  }
}

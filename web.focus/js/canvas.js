/* The grid everything is drawn on, and the base a theme is built on.
 *
 * Straight from the script: a canvas is characters and tints, one per cell,
 * and a sprite is a little art block that moves across it. Spaces are
 * transparent, so a fish passes behind the clock rather than punching a hole
 * through the scene.
 */

import { chars, mirror, width } from "./util.js";

export class Canvas {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.chars = [];
    this.tints = [];
    for (let y = 0; y < rows; y++) {
      this.chars.push(new Array(cols).fill(" "));
      this.tints.push(new Array(cols).fill(""));
    }
  }

  put(x, y, text, tint = "", opaque = false) {
    // floor, not trunc: a sprite drawn at y and a mark put at y + 1 have to
    // agree about which row that is, and truncation does not for y < 0.
    x = Math.floor(x);
    y = Math.floor(y);
    if (!(y >= 0 && y < this.rows)) return;
    const row = this.chars[y], tints = this.tints[y];
    const glyphs = chars(text);
    for (let i = 0; i < glyphs.length; i++) {
      const col = x + i;
      const ch = glyphs[i];
      if (col < 0 || col >= this.cols || (ch === " " && !opaque)) continue;
      row[col] = ch;
      tints[col] = tint;
    }
  }

  sprite(x, y, art, tint = "", opaque = false) {
    for (let dy = 0; dy < art.length; dy++) {
      this.put(x, Math.floor(y) + dy, art[dy], tint, opaque);
    }
  }

  /** Each row as runs of one tint, which is what the screen paints. */
  lines() {
    const out = [];
    for (let y = 0; y < this.rows; y++) {
      const row = this.chars[y], tints = this.tints[y];
      let end = this.cols;
      while (end && row[end - 1] === " ") end--;
      const runs = [];
      let text = "", tint = null;
      for (let x = 0; x < end; x++) {
        if (tints[x] !== tint) {
          if (text) runs.push([text, tint]);
          tint = tints[x];
          text = "";
        }
        text += row[x];
      }
      if (text) runs.push([text, tint]);
      out.push(runs);
    }
    return out;
  }
}

export class Sprite {
  constructor(art, tint, x, y, vx = 0.0, vy = 0.0, kind = "", flip = false) {
    this.art = art;
    this.tint = tint;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.born = 0.0;
    this.kind = kind;
    this.phase = "";                   // for anything that runs a little routine
    this.timer = 0.0;
    this.flip = flip;                  // art was mirrored, so new frames must be too
  }

  move(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  get width() {
    return Math.max(...this.art.map((line) => width(line)));
  }
}

/** The default: an empty stage, nothing behind the clock. */
export class Theme {
  static themeName = "plain";
  static blurb = "just the focus, the clock and the bar";
  static seasonal = false;             // see inSeason: some themes keep to a date

  static inSeason() {
    return true;
  }

  constructor() {
    this.last = null;
    this.total = 1500.0;               // length of the block, set by countdown()
  }

  /** Seconds since the previous frame, clamped so a stall cannot jump. */
  tick(now) {
    const dt = this.last === null ? 0.0 : Math.min(0.3, now - this.last);
    this.last = now;
    return dt;
  }

  draw(canvas, now) {}

  /** Move a pool of crossing sprites, drop what has left, draw the rest. */
  advance(canvas, sprites, dt, cols, rows = null) {
    for (const sprite of [...sprites]) {
      sprite.move(dt);
      let off = (sprite.vx >= 0 && sprite.x > cols + 2)
        || (sprite.vx < 0 && sprite.x + sprite.width < 0);
      if (rows !== null && !off) {
        off = sprite.y + sprite.art.length < 0 || sprite.y > rows;
      }
      if (off) {
        sprites.splice(sprites.indexOf(sprite), 1);
        continue;
      }
      canvas.sprite(sprite.x, sprite.y, sprite.art, sprite.tint);
    }
  }
}

export { mirror };

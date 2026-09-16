/* The terminal this page is pretending to be.
 *
 * Two surfaces, as in a real one: a scrollback that commands and their output
 * are printed into, and an alternate screen that a running block takes over
 * and hands back when it ends, leaving the scrollback as it was.
 */

import { DIM, ESC, ETX, VS16, readTint } from "./util.js";

const EMOJI = /\p{Extended_Pictographic}/u;

function escape(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** One run of text in one tint, as HTML.
 *
 * An emoji is one cell to the drawing code and two on the screen, so it is
 * boxed into exactly two columns and the pad cell the drawing code left after
 * it — a space, or the variation selector that is part of the emoji — is
 * swallowed by that box.
 */
function paint(text, tint) {
  const { colour, bold, dim } = readTint(tint);
  const glyphs = Array.from(text);
  let html = "";
  for (let i = 0; i < glyphs.length; i++) {
    const ch = glyphs[i];
    if (EMOJI.test(ch)) {
      let emoji = ch;
      const next = glyphs[i + 1];
      if (next === VS16) { emoji += next; i++; }
      else if (next === " ") { i++; }
      html += `<i class="g">${escape(emoji)}</i>`;
    } else {
      html += escape(ch);
    }
  }
  const classes = (bold ? " b" : "") + (dim ? " d" : "");
  if (!colour && !classes) return html;
  const style = colour ? ` style="color:${colour}"` : "";
  return `<span class="${classes.trim()}"${style}>${html}</span>`;
}

/** A line is a string, or a list of [text, tint] the way the script paints. */
function lineHtml(line) {
  if (typeof line === "string") return escape(line) || "&nbsp;";
  const html = line.map(([text, tint]) => paint(text, tint)).join("");
  return html || "&nbsp;";
}

export class Term {
  constructor(root) {
    this.root = root;
    this.scrollback = root.querySelector("#scrollback");
    this.alt = root.querySelector("#alt");
    this.probe = document.getElementById("probe");
    this.input = document.getElementById("keys");   // both live outside the screen

    this.cols = 80;
    this.rows = 24;
    this.cell = { w: 8, h: 17 };
    this.mode = "idle";                  // idle | line | key | block
    this.pending = null;                 // whatever is waiting on a keypress
    this.history = [];
    this.at = 0;
    this.prompt = "";
    this.live = null;                    // the element the typed line is drawn in

    this.measure();
    let timer = null;
    const resized = () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.measure(), 80);
    };
    window.addEventListener("resize", resized);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", resized);

    this.input.addEventListener("keydown", (event) => this.keydown(event));
    this.input.addEventListener("input", () => {
      if (this.mode === "line") this.drawLine();
      else this.input.value = "";        // nothing is being typed into a block
    });
    root.addEventListener("mousedown", (event) => {
      if (window.getSelection().toString()) return;     // let a copy finish
      event.preventDefault();
      this.focus();
    });
    root.addEventListener("touchend", (event) => {
      if (this.mode === "block" || this.mode === "key") {
        event.preventDefault();
        this.press(this.mode === "key" ? "\r" : " ");   // a tap is the space bar
      }
      this.focus();
    }, { passive: false });
  }

  focus() {
    this.input.focus({ preventScroll: true });
  }

  /* --- how big the window is, in cells --- */

  measure() {
    const box = this.probe.getBoundingClientRect();
    this.cell = { w: box.width / 10, h: box.height };
    // The gutter is not screen, so the grid is measured inside it: a row that
    // does not fit is a row the bottom of a scene is cut off in.
    const style = getComputedStyle(this.root);
    const gap = (side) => parseFloat(style.getPropertyValue("padding-" + side)) || 0;
    const across = this.root.clientWidth - gap("left") - gap("right");
    const down = this.root.clientHeight - gap("top") - gap("bottom");
    this.cols = Math.max(20, Math.floor(across / this.cell.w));
    this.rows = Math.max(8, Math.floor(down / this.cell.h));
    if (this.onresize) this.onresize();
  }

  /* --- the scrollback --- */

  write(line = "") {
    const row = document.createElement("div");
    row.className = "line";
    row.innerHTML = lineHtml(line);
    this.scrollback.appendChild(row);
    this.toBottom();
    return row;
  }

  writeAll(lines) {
    for (const line of lines) this.write(line);
  }

  clear() {
    this.scrollback.textContent = "";
  }

  toBottom() {
    this.root.scrollTop = this.root.scrollHeight;
  }

  /* --- the alternate screen --- */

  enterAlt() {
    this.root.classList.add("alt-on");
    this.mode = "block";
    this.focus();
  }

  leaveAlt() {
    this.root.classList.remove("alt-on");
    this.alt.innerHTML = "";
    this.mode = "idle";
    this.toBottom();
  }

  /** One frame of a canvas, painted over the whole screen. */
  frame(canvas) {
    const html = canvas.lines()
      .map((runs) => runs.map(([text, tint]) => paint(text, tint)).join(""))
      .join("\n");
    this.alt.innerHTML = html;
  }

  /* --- keys --- */

  keydown(event) {
    if (event.ctrlKey && event.key === "c") {
      event.preventDefault();
      if (this.mode === "line") {                   // ^C abandons what was typed
        this.input.value = "";
        this.submit();
        return;
      }
      this.press(ETX);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;   // let a copy through

    if (this.mode === "line") {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submit();
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        this.recall(event.key === "ArrowUp" ? -1 : 1);
      } else {
        setTimeout(() => this.drawLine(), 0);            // after the field updates
      }
      return;
    }

    if (this.mode === "key" || this.mode === "block") {
      if (event.key.length === 1 || ["Escape", "Enter", "Backspace"].includes(event.key)) {
        event.preventDefault();
        this.press(event.key === "Escape" ? ESC
          : event.key === "Enter" ? "\r" : event.key);
      }
    }
  }

  press(key) {
    this.input.value = "";
    if (this.pending) this.pending(key);
    else if (this.onkey) this.onkey(key);
  }

  /** One keypress, out of the ones offered. Ctrl-C and Esc always mean q. */
  readKey(allowed = null) {
    this.mode = "key";
    this.focus();
    return new Promise((resolve) => {
      this.pending = (key) => {
        if (key === ETX || key === ESC) key = "q";
        if (allowed && !allowed.includes(key.toLowerCase())) return;
        this.pending = null;
        this.mode = "idle";
        resolve(allowed ? key.toLowerCase() : key);
      };
    });
  }

  /** Any key at all — what closes the finish animation. */
  anyKey() {
    return this.readKey(null);
  }

  /* --- a typed line --- */

  readLine(prompt = "", { history = false } = {}) {
    this.prompt = prompt;
    this.mode = "line";
    this.input.value = "";
    this.at = this.history.length;
    this.live = this.write("");
    this.drawLine();
    this.focus();
    return new Promise((resolve) => {
      this.resolveLine = (text) => {
        if (history && text.trim()) this.history.push(text);
        resolve(text);
      };
    });
  }

  drawLine() {
    if (this.mode !== "line" || !this.live) return;
    const text = this.input.value;
    const caret = this.input.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const under = text.slice(caret, caret + 1) || " ";
    const after = text.slice(caret + 1);
    this.live.innerHTML = lineHtml([[this.prompt, DIM]])
      + escape(before) + `<span class="caret">${escape(under)}</span>` + escape(after);
    this.toBottom();
  }

  submit() {
    const text = this.input.value;
    this.live.innerHTML = lineHtml([[this.prompt, DIM]]) + escape(text);
    this.input.value = "";
    this.mode = "idle";
    this.live = null;
    const done = this.resolveLine;
    this.resolveLine = null;
    if (done) done(text);
  }

  recall(step) {
    if (!this.history.length) return;
    this.at = Math.min(this.history.length, Math.max(0, this.at + step));
    this.input.value = this.at === this.history.length ? "" : this.history[this.at];
    this.drawLine();
  }
}

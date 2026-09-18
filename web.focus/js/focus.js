/* A block: the countdown, the finish, and the question that follows it. */

import { Canvas } from "./canvas.js";
import { THEMES, pick } from "./themes.js";
import {
  FINALE, FINALES, FRAME, Finale, banner, compose,
} from "./overlay.js";
import { DIM, ESC, ETX, GREEN, choice, hhmm, mod, number } from "./util.js";
import { defaultScene, keepDefault, record } from "./store.js";

/** The clock the animation runs on: seconds, monotonic, never jumping back. */
function ticking() {
  return performance.now() / 1000;
}

/* --- the noise a finished block makes ---------------------------------------- */

let audio = null;

function bell() {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    const at = audio.currentTime;
    const tone = audio.createOscillator();
    const level = audio.createGain();
    tone.type = "sine";
    tone.frequency.setValueAtTime(880, at);
    level.gain.setValueAtTime(0.0001, at);
    level.gain.exponentialRampToValueAtTime(0.25, at + 0.01);
    level.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    tone.connect(level).connect(audio.destination);
    tone.start(at);
    tone.stop(at + 0.4);
  } catch (error) {
    /* a browser that will not make a sound is not a reason to lose the block */
  }
}

/** Notification and chime — the half of it that reaches another room. */
function alarm(goal, minutes) {
  const message = `${number(minutes)} minutes done — ${goal}`;
  try {
    if (window.Notification && Notification.permission === "granted") {
      new Notification("focus", { body: message, tag: "focus" });
    }
  } catch (error) {
    /* notifications are a nicety */
  }
  bell();
  return message;
}

/** Ask once, while a keypress is still fresh, so the block can ring later. */
export function mayNotify() {
  try {
    if (window.Notification && Notification.permission === "default") {
      Notification.requestPermission();
    }
  } catch (error) {
    /* older browsers want a callback; not worth the branch */
  }
}

/* --- the six seconds after a block lands -------------------------------------- */

/** Run the finish animation until it is done or a key says enough.
 *
 * Paced at FRAME, exactly as the block itself is and as the script's
 * `select(…, FRAME)` is: an animation frame on a phone is 60 or 120 a second,
 * and repainting the whole screen that often is six to twelve times the work
 * the block was doing a moment earlier — at the one moment the finale is also
 * the busiest thing on the canvas.
 */
function celebrate(term, theme, goal, minutes) {
  const show = new Finale(choice(FINALES));
  const start = ticking();
  let rung = 0;
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      term.onkey = null;
      resolve();
    };
    term.onkey = finish;
    let painted = 0;
    const paint = () => {
      if (done) return;
      const now = ticking();
      const elapsed = now - start;
      if (elapsed >= FINALE) return finish();
      if (rung < 3 && elapsed >= rung * 0.5) {
        rung++;
        bell();
      }
      // The whole frame is gated, not just the write: a theme and the finale
      // both step on their own dt, so drawing between paints would run the
      // particles at the screen's rate and paint every sixth position of them.
      if (now - painted >= FRAME) {
        painted = now;
        const canvas = new Canvas(term.cols, term.rows);
        theme.draw(canvas, now);
        show.draw(canvas, now, elapsed);
        banner(canvas, goal, minutes, now);
        term.frame(canvas);
      }
      requestAnimationFrame(paint);
    };
    paint();
  });
}

/* --- the block itself ---------------------------------------------------------- */

export async function countdown(term, goal, minutes, themeName,
                                { preview = false, finale = true } = {}) {
  themeName = pick(themeName);
  const total = minutes * 60.0;
  const startedAt = new Date();
  let theme = new (THEMES.get(themeName))();
  // A preview compresses whatever a theme saves for once a block, so that the
  // rare things are actually watchable instead of arriving in ten minutes.
  theme.total = preview ? 45.0 : total;

  let remaining = total;
  let paused = false;
  let resumedAt = ticking();
  const rota = [...THEMES.keys()];             // what the picker walks, plain included
  let at = rota.indexOf(themeName);
  let picking = false;                         // is the rota on screen?
  let standing = defaultScene();               // marked green in the strip
  let completed = false;
  let stopped = false;

  /** The theme at that place in the rota, ready to draw. */
  const scene = (index) => {
    const chosen = new (THEMES.get(rota[index]))();
    chosen.total = preview ? 45.0 : total;
    return chosen;
  };

  term.enterAlt();
  term.onkey = (key) => {
    if (picking) {                             // the rota is up; the block runs on
      if (key === "left" || key === "up" || key === "right" || key === "down") {
        at = mod(at + (key === "right" || key === "down" ? 1 : -1), rota.length);
        themeName = rota[at];
        theme = scene(at);
      } else if (key === "d" || key === "D") {   // this one, from now on
        standing = keepDefault(rota[at]);
      } else if (["t", "T", "\r", ESC, ETX, "q", "Q"].includes(key)) {
        picking = false;                       // q closes the rota, it does not stop
      } else if (key === " ") {
        paused = !paused;
      }
      return;
    }
    if (key === "q" || key === "Q" || key === ESC || key === ETX) {
      stopped = true;
    } else if (key === " ") {
      paused = !paused;
    } else if (key === "t" || key === "T") {
      picking = true;
    }
  };

  await new Promise((resolve) => {
    let painted = 0;
    const step = () => {
      const now = ticking();
      if (!paused) remaining = Math.max(0.0, remaining - (now - resumedAt));
      resumedAt = now;

      if (now - painted >= FRAME) {
        painted = now;
        const canvas = new Canvas(term.cols, term.rows);
        theme.draw(canvas, now);
        compose(canvas, goal, remaining, total, paused, startedAt,
                picking ? at : null, standing);
        term.frame(canvas);
      }
      if (remaining <= 0) {
        completed = true;
        return resolve();
      }
      if (stopped) return resolve();
      requestAnimationFrame(step);
    };
    step();
  });

  term.onkey = null;
  let message = null;
  if (completed && !preview) {
    message = alarm(goal, minutes);
    if (finale) await celebrate(term, theme, goal, minutes);
  }
  term.leaveAlt();

  const actual = (total - remaining) / 60.0;
  if (preview) {
    term.write(`Preview of the ${themeName} theme — ${THEMES.get(themeName).blurb}`);
    return 0;
  }

  const note = await record(startedAt, goal, minutes, actual, completed, themeName);
  if (note) term.write([[note, DIM]]);
  if (completed) {
    if (!finale) bell();
    term.write([["✓", GREEN], [` ${message} — ${hhmm(new Date())}`, ""]]);
  } else {
    term.write(`Stopped after ${actual.toFixed(1)} min of ${number(minutes)} — ${goal}`);
  }
  return completed ? 0 : 1;
}

/** What follows a block that landed: a new goal, the same one, or nothing.
 *
 * Returns the goal of the next block, or null to stop here.
 */
export async function again(term, goal, minutes) {
  const short = goal.length <= 40 ? goal : goal.slice(0, 39) + "…";
  term.write();
  term.write([["  [f]", GREEN], [" new session   ", ""], ["[r]", GREEN],
              [` repeat “${short}”   `, ""], ["[q]", GREEN], [" quit", ""]]);
  const choiceKey = await term.readKey("frq");
  if (choiceKey === "q") return null;
  if (choiceKey === "r") {
    term.write(`  Again: ${goal} — ${number(minutes)} minutes`);
    return goal;
  }
  const next = await term.readLine(`  New goal (${number(minutes)} min): `);
  return next.trim() || null;
}

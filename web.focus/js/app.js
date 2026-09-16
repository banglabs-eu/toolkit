/* The shell around the clock.
 *
 * `focus` is a command with one argument that matters — what the block is for
 * — and a handful of flags. This page keeps that: one prompt, the same flags,
 * the same output, and the block itself drawn over the whole window.
 */

import { Term } from "./screen.js";
import { THEMES, RANDOM } from "./themes.js";
import { countdown, again, mayNotify } from "./focus.js";
import { showHistory, showLog } from "./views.js";
import {
  ACCENT, AMBER, BOLD, DIM, padEnd,
} from "./util.js";
import {
  ApiError, CONFIG, accountName, countLocal, defaultScene, flush, keepDefault,
  loadProfile, loginUrl, logout, saveProfile, signedIn, uploadLocal, waiting,
  whoami,
} from "./store.js";

const DEFAULT_MINUTES = 25;
const SIGNING_IN = "focus.signingin";

/* --- the command line -------------------------------------------------------- */

/** Split a typed line the way a shell would, quotes and all. */
function tokens(text) {
  const out = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    out.push(match[1] ?? match[2] ?? match[3]);
  }
  return out;
}

class Usage extends Error {}

/** The flags `focus` takes, read off a typed line. */
function parse(text) {
  const args = tokens(text);
  if (args.length && args[0] === "focus") args.shift();      // typed out of habit

  const plan = {
    goal: [], minutes: DEFAULT_MINUTES, theme: defaultTheme(), finale: true,
    limit: 15, command: null, when: null, preview: null,
  };

  const value = (flag, rest) => {
    if (!rest.length) throw new Usage(`${flag} needs a value.`);
    return rest.shift();
  };

  while (args.length) {
    const arg = args.shift();
    switch (arg) {
      case "-m": case "--minutes": {
        const raw = Number(value(arg, args));
        if (!(raw > 0)) throw new Usage("--minutes must be a number greater than zero.");
        plan.minutes = raw;
        break;
      }
      case "-t": case "--theme": {
        const name = value(arg, args);
        if (name !== RANDOM && !THEMES.has(name)) throw new Usage(unknownTheme(name));
        plan.theme = name;
        break;
      }
      case "-p": case "--preview": {
        plan.command = "preview";
        plan.preview = args.length && !args[0].startsWith("-") ? args.shift() : plan.theme;
        if (plan.preview !== RANDOM && !THEMES.has(plan.preview)) {
          throw new Usage(unknownTheme(plan.preview));
        }
        break;
      }
      case "-n": case "--limit":
        plan.limit = Math.max(1, Number(value(arg, args)) || 15);
        break;
      case "-l": case "--log": plan.command = "log"; break;
      case "-H": case "--history":
        plan.command = "history";
        plan.when = args.length && !args[0].startsWith("-") ? args.shift() : "today";
        break;
      case "--no-finale": plan.finale = false; break;
      case "--me": plan.command = "me"; break;
      case "--login": case "login": plan.command = "login"; break;
      case "--logout": case "logout": plan.command = "logout"; break;
      case "--whoami": case "whoami": plan.command = "whoami"; break;
      case "--sync": plan.command = "sync"; break;
      case "--upload": plan.command = "upload"; break;
      case "-h": case "--help": case "help": plan.command = "help"; break;
      case "clear": plan.command = "clear"; break;
      case "--default-theme": {
        plan.command = "default-theme";
        plan.when = value(arg, args);
        break;
      }
      default:
        if (arg.startsWith("-") && arg.length > 1) throw new Usage(`No such flag: ${arg}`);
        plan.goal.push(arg);
    }
  }
  return plan;
}

function unknownTheme(name) {
  return `No theme called ${name}. There are: `
    + [...THEMES.keys(), RANDOM].join(", ") + ".";
}

/** What d in the picker last kept, as long as it is still a scene. */
function defaultTheme() {
  const kept = defaultScene();
  return kept && (kept === RANDOM || THEMES.has(kept)) ? kept : RANDOM;
}

/* --- what it prints before you type anything ---------------------------------- */

function greet(term) {
  term.write([["focus", BOLD + ACCENT],
              [" — name a goal, then count 25 minutes down against it.", ""]]);
  term.write([["Type what the block is for and press enter. Enter on its own gives the", DIM]]);
  term.write([["command line, where --help lists the rest.", DIM]]);
  term.write();
}

function help(term) {
  const lines = [
    ["rewrite the intro", "the goal on its own, and 25 minutes against it"],
    ["-m 50 deep work", "a different length"],
    ["-t aquarium read", "pick the scene instead of taking pot luck"],
    ["--preview airport", "watch a theme without starting a block"],
    ["--log", "the sessions so far, today's total on top"],
    ["--history", "what you did today, block by block"],
    ["--history yesterday", "the same for yesterday, a weekday or a date"],
    ["--no-finale quiet", "land the block without the celebration"],
    ["--me", "set the name and birthday it greets you by"],
    ["--login", "keep the history in your Bang Labs account"],
    ["--whoami", "which account this browser logs to"],
    ["--default-theme matrix", "stop the lottery; d in the picker does it too"],
    ["clear", "empty the scrollback"],
  ];
  for (const [command, what] of lines) {
    term.write([["  " + padEnd(command, 24), ACCENT], [what, ""]]);
  }
  term.write();
  term.write([["themes:", BOLD]]);
  for (const [name, theme] of THEMES) {
    term.write([["  " + padEnd(name, 10), ""], [theme.blurb, DIM]]);
  }
  term.write([["  " + padEnd(RANDOM, 10), ""],
              ["one of the above, drawn fresh for each block", DIM]]);
  term.write();
  term.write([["While a block runs: space pauses, q stops early, and t opens the scene", DIM]]);
  term.write([["picker: the arrows walk it, d keeps the one you are on as the default,", DIM]]);
  term.write([["and t, enter or escape go back to the block.", DIM]]);
  term.write([["A finished block asks what comes next: f new session, r again, q quit.", DIM]]);
  term.write([["The bottom right corner carries the GlyphClock reading — "
    + "glyphclock.bang-labs.eu.", DIM]]);
}

/* --- who you are -------------------------------------------------------------- */

/** Day first, as it is written here: 7-3, 07/03, 7.3.1985, or an ISO date. */
function parseBirthday(text) {
  for (const separator of ["-", "/", ".", ","]) text = text.split(separator).join(" ");
  const parts = text.split(/\s+/).filter(Boolean);
  let day, month, year = null;
  if (parts.length === 3 && parts[0].length === 4) {
    [year, month, day] = parts.map(Number);
  } else if (parts.length === 3) {
    [day, month, year] = parts.map(Number);
  } else if (parts.length === 2) {
    [day, month] = parts.map(Number);
  } else {
    return null;
  }
  if (!month || !day || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(year || 2000, month - 1, day);   // a leap year, so 29 Feb stands
  if (check.getMonth() !== month - 1 || check.getDate() !== day) return null;
  return { month, day, year: year || null };
}

/** Ask once for a name and a birthday, so the day itself gets its own scene. */
async function askProfile(term, force = false) {
  const profile = loadProfile();
  if (profile.asked && !force) return profile;
  term.write("focus can throw you a party on your birthday. Both answers are");
  term.write("optional — press enter to skip, or type --me to change them later.");
  const name = (await term.readLine("  Your name: ")).trim();
  const born = (await term.readLine("  Your birthday (day-month, e.g. 7-3): ")).trim();

  const next = { asked: true, name };
  const when = born ? parseBirthday(born) : null;
  if (born && when === null) {
    term.write("  Sorry, I could not read that date. Type --me to try again.");
  } else if (when) {
    Object.assign(next, when);
    const months = ["January", "February", "March", "April", "May", "June", "July",
                    "August", "September", "October", "November", "December"];
    term.write(`  Noted: ${when.day} ${months[when.month - 1]}`
      + `${when.year ? " " + when.year : ""}.`);
  }
  saveProfile(next);
  term.write();
  return next;
}

/* --- the account --------------------------------------------------------------- */

function whereBlocksGo(term) {
  if (signedIn()) {
    term.write([[`Signed in as ${accountName()}.`, ""],
                [" Blocks are kept in your Bang Labs account.", DIM]]);
  } else {
    term.write([["Blocks are kept in this browser.", DIM],
                [" Type --login to keep them in your account instead.", DIM]]);
  }
  const queued = waiting();
  if (queued) {
    term.write([[`${queued} block${queued === 1 ? "" : "s"} waiting to upload. `
      + "Type --sync.", AMBER]]);
  }
}

/** Ask once, at sign-in, about the history already in this browser. */
async function offerUpload(term) {
  const count = countLocal();
  if (!count) return;
  const answer = (await term.readLine(
    `  Upload the ${count} block${count === 1 ? "" : "s"} already logged in this browser? [Y/n] `
  )).trim().toLowerCase();
  if (answer.startsWith("n")) {
    term.write("  Left where they are. --upload sends them later.");
    return;
  }
  await sendLocal(term);
}

async function sendLocal(term) {
  try {
    const { created, already } = await uploadLocal();
    if (!created && !already) {
      term.write("  Nothing in this browser to send.");
      return;
    }
    term.write(`  Uploaded ${created} block${created === 1 ? "" : "s"}`
      + `${already ? `, ${already} already there` : ""}.`);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    term.write([[error.message, AMBER]]);
  }
}

/* --- running a block ------------------------------------------------------------ */

async function block(term, plan) {
  let goal = plan.goal.join(" ").trim();
  if (!goal) {
    goal = (await term.readLine("Goal: ")).trim();
    if (!goal) {
      term.write([["A block needs a goal. Nothing started.", AMBER]]);
      return 1;
    }
  }
  mayNotify();
  for (;;) {
    const status = await countdown(term, goal, plan.minutes, plan.theme,
                                   { finale: plan.finale });
    if (status !== 0 || !plan.finale) return status;
    goal = await again(term, goal, plan.minutes);
    if (!goal) return status;
  }
}

/* --- one typed line ------------------------------------------------------------- */

async function run(term, text) {
  if (!text.trim()) return;
  let plan;
  try {
    plan = parse(text);
  } catch (error) {
    if (!(error instanceof Usage)) throw error;
    term.write([[error.message, AMBER]]);
    return;
  }

  switch (plan.command) {
    case "help":
      return help(term);

    case "clear":
      return term.clear();

    case "log":
      return void await showLog(term, plan.limit);

    case "history":
      return void await showHistory(term, plan.when, term.cols);

    case "preview":
      return void await countdown(term, plan.goal.join(" ").trim() || "theme preview",
                                  plan.minutes, plan.preview, { preview: true });

    case "me":
      return void await askProfile(term, true);

    case "default-theme": {
      const name = plan.when;
      if (name !== RANDOM && !THEMES.has(name)) {
        term.write([[unknownTheme(name), AMBER]]);
        return;
      }
      if (name === RANDOM) {
        if (defaultScene()) keepDefault(defaultScene());   // clears it
        term.write("Back to a fresh scene every block.");
      } else {
        if (defaultScene() !== name) keepDefault(name);
        term.write(`Every block draws ${name} from now on. `
          + "d in the picker, or --default-theme random, puts the lottery back.");
      }
      return;
    }

    case "login": {
      if (signedIn()) {
        term.write(`Already signed in as ${accountName()}. Type --logout to change account.`);
        return;
      }
      term.write("Sign in with your Bang Labs account — the same one as every");
      term.write("other bang-labs.eu site. Taking you there now…");
      sessionStorage.setItem(SIGNING_IN, "1");
      location.href = loginUrl();
      return;
    }

    case "logout": {
      if (!signedIn()) {
        term.write("Not signed in.");
        return;
      }
      if (waiting()) await flush().catch(() => {});
      if (waiting()) {
        term.write([[`${waiting()} block(s) could not be sent, and stay in this `
          + "browser until the next sign-in.", AMBER]]);
      }
      await logout();
      term.write("Signed out. Blocks are kept in this browser again.");
      return;
    }

    case "whoami": {
      await whoami();
      whereBlocksGo(term);
      if (signedIn()) term.write([["Blocks are kept at " + CONFIG.api + ".", DIM]]);
      return;
    }

    case "sync": {
      if (!signedIn()) {
        term.write([["Not signed in. Type --login.", AMBER]]);
        return;
      }
      const queued = waiting();
      if (!queued) {
        term.write("Nothing waiting.");
        return;
      }
      try {
        const sent = await flush(true);
        term.write(`Sent ${sent} of ${queued} waiting block${queued === 1 ? "" : "s"}.`);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        term.write([[error.message, AMBER]]);
      }
      return;
    }

    case "upload": {
      if (!signedIn()) {
        term.write([["Not signed in. Type --login.", AMBER]]);
        return;
      }
      return void await sendLocal(term);
    }

    default:
      return void await block(term, plan);
  }
}

/* --- boot ----------------------------------------------------------------------- */

async function main() {
  const term = new Term(document.getElementById("terminal"));
  window.term = term;                       // a hand-hold for the console
  greet(term);

  const coming = sessionStorage.getItem(SIGNING_IN);
  sessionStorage.removeItem(SIGNING_IN);
  await whoami();
  whereBlocksGo(term);
  term.write();
  if (coming && signedIn()) {
    await offerUpload(term);
    term.write();
  }
  if (signedIn() && waiting()) await flush().catch(() => {});

  await askProfile(term);

  // `focus` with no arguments asks for the goal before anything else, and so
  // does this: the command line is what enter on its own gives you.
  const first = (await term.readLine("Goal: ")).trim();
  if (first && !first.startsWith("-")) {
    const plan = parse("");                 // the defaults, as `focus` with no flags
    plan.goal = [first];                    // the goal prompt takes the line as it is
    await block(term, plan);
    term.write();
  } else if (first) {
    await run(term, first);                 // a flag typed at the goal prompt
    term.write();
  } else {
    term.write([["A block needs a goal. Nothing started.", AMBER]]);
    term.write();
  }

  for (;;) {
    const text = await term.readLine("$ focus ", { history: true });
    try {
      await run(term, text);
    } catch (error) {
      term.write([[String(error && error.message || error), AMBER]]);
      if (!(error instanceof ApiError)) console.error(error);
    }
    term.write();
  }
}

main();

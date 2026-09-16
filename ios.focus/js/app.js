/* The iOS application bootstrap and shell.
 * Integrates terminal CLI capabilities, scene rendering, local storage/sync,
 * and native iOS touch controls, widget simulators, & responsive layout.
 */

import { Term } from "./screen.js";
import { THEMES, RANDOM } from "./themes.js";
import { countdown, again, mayNotify } from "./focus.js";
import { showHistory, showLog } from "./views.js";
import { ACCENT, AMBER, BOLD, DIM, padEnd, clock } from "./util.js";
import {
  ApiError, CONFIG, accountName, countLocal, defaultScene, flush, keepDefault,
  loadProfile, loginUrl, logout, saveProfile, signedIn, uploadLocal, waiting, whoami,
} from "./store.js";
import { iosController } from "./ios.js";

const DEFAULT_MINUTES = 25;
const SIGNING_IN = "focus.signingin";

/* --- CLI parser ------------------------------------------------------------- */

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

function parse(text) {
  const args = tokens(text);
  if (args.length && args[0] === "focus") args.shift();

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
  return `No theme called ${name}. There are: ` + [...THEMES.keys(), RANDOM].join(", ") + ".";
}

function defaultTheme() {
  const kept = defaultScene();
  return kept && (kept === RANDOM || THEMES.has(kept)) ? kept : RANDOM;
}

/* --- Terminal greetings & help ---------------------------------------------- */

function greet(term) {
  term.write([["focus", BOLD + ACCENT], [" — iOS pomodoro clock & widget runner.", ""]]);
  term.write([["Type what the block is for or use touch chips below. Enter gives prompt.", DIM]]);
  term.write([["Type --help to view commands.", DIM]]);
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
    ["--no-finale quiet", "land the block without the celebration"],
    ["--me", "set the name and birthday it greets you by"],
    ["--login", "keep history in your Bang Labs account"],
    ["--whoami", "which account this browser logs to"],
    ["--default-theme matrix", "stop the lottery; d in picker does it too"],
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
  term.write([["  " + padEnd(RANDOM, 10), ""], ["one of the above, drawn fresh for each block", DIM]]);
  term.write();
}

/* --- Profile & Accounts ----------------------------------------------------- */

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
  const check = new Date(year || 2000, month - 1, day);
  if (check.getMonth() !== month - 1 || check.getDate() !== day) return null;
  return { month, day, year: year || null };
}

async function askProfile(term, force = false) {
  const profile = loadProfile();
  if (profile.asked && !force) return profile;
  term.write("focus can throw you a party on your birthday. Both answers are optional.");
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
    term.write(`  Noted: ${when.day} ${months[when.month - 1]}${when.year ? " " + when.year : ""}.`);
  }
  saveProfile(next);
  term.write();
  return next;
}

function whereBlocksGo(term) {
  if (signedIn()) {
    term.write([[`Signed in as ${accountName()}.`, ""], [" Blocks stored in Bang Labs account.", DIM]]);
  } else {
    term.write([["Blocks kept in local storage.", DIM], [" Type --login to sync across devices.", DIM]]);
  }
}

/* --- Block Execution -------------------------------------------------------- */

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
  iosController.updateState({ goal, total: plan.minutes * 60, remaining: plan.minutes * 60, running: true });
  
  for (;;) {
    const status = await countdown(term, goal, plan.minutes, plan.theme, { finale: plan.finale });
    if (status !== 0 || !plan.finale) {
      iosController.updateState({ running: false });
      return status;
    }
    goal = await again(term, goal, plan.minutes);
    if (!goal) {
      iosController.updateState({ running: false });
      return status;
    }
  }
}

/* --- CLI Command execution -------------------------------------------------- */

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
    case "help": return help(term);
    case "clear": return term.clear();
    case "log": return void await showLog(term, plan.limit);
    case "history": return void await showHistory(term, plan.when, term.cols);
    case "preview":
      return void await countdown(term, plan.goal.join(" ").trim() || "theme preview",
                                  plan.minutes, plan.preview, { preview: true });
    case "me": return void await askProfile(term, true);
    case "default-theme": {
      const name = plan.when;
      if (name !== RANDOM && !THEMES.has(name)) {
        term.write([[unknownTheme(name), AMBER]]);
        return;
      }
      if (name === RANDOM) {
        if (defaultScene()) keepDefault(defaultScene());
        term.write("Back to a fresh scene every block.");
      } else {
        if (defaultScene() !== name) keepDefault(name);
        term.write(`Default theme set to ${name}.`);
      }
      return;
    }
    case "login":
      if (signedIn()) {
        term.write(`Already signed in as ${accountName()}.`);
        return;
      }
      sessionStorage.setItem(SIGNING_IN, "1");
      location.href = loginUrl();
      return;
    case "logout":
      if (!signedIn()) { term.write("Not signed in."); return; }
      await logout();
      term.write("Signed out.");
      return;
    case "whoami":
      await whoami();
      whereBlocksGo(term);
      return;
    default:
      return void await block(term, plan);
  }
}

/* --- iOS UI Wireup ---------------------------------------------------------- */

function setupIOSControls(term) {
  iosController.init();

  // Update status bar clock
  const updateClock = () => {
    const now = new Date();
    const str = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const el = document.getElementById("ios-clock-time");
    if (el) el.textContent = str;
  };
  updateClock();
  setInterval(updateClock, 10000);

  // Mode Pills
  const pills = document.querySelectorAll(".mode-pill");
  pills.forEach((pill) => {
    pill.addEventListener("click", () => {
      pills.forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      const mode = pill.getAttribute("data-mode");
      iosController.setMode(mode);
    });
  });

  // Rotate button
  document.getElementById("btn-rotate")?.addEventListener("click", () => {
    iosController.playHaptic("medium");
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  });

  // Dynamic Island toggle
  document.getElementById("dynamic-island")?.addEventListener("click", () => {
    const di = document.getElementById("dynamic-island");
    di?.classList.toggle("expanded");
    iosController.playHaptic("light");
  });

  // Touch Toolbar Chips
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const cmd = chip.getAttribute("data-cmd");
      iosController.playHaptic("light");
      if (term.input) {
        term.input.value += cmd;
        term.input.focus();
      }
    });
  });

  // Action Bar Buttons
  document.getElementById("ab-play")?.addEventListener("click", () => {
    iosController.playHaptic("medium");
    if (term.onkey) term.onkey(" ");
  });

  document.getElementById("ab-theme")?.addEventListener("click", () => {
    iosController.playHaptic("medium");
    openSceneModal(term);
  });

  document.getElementById("ab-duration")?.addEventListener("click", async () => {
    iosController.playHaptic("light");
    term.clear();
    const g = await term.readLine("Goal: ");
    if (g) {
      const plan = parse("");
      plan.goal = [g];
      block(term, plan);
    }
  });

  document.getElementById("ab-view")?.addEventListener("click", () => {
    iosController.playHaptic("medium");
    const nextMode = iosController.mode === "fullscreen" ? "medium" : "fullscreen";
    iosController.setMode(nextMode);
    document.querySelectorAll(".mode-pill").forEach((p) => {
      p.classList.toggle("active", p.getAttribute("data-mode") === nextMode);
    });
  });

  document.getElementById("ab-sound")?.addEventListener("click", () => {
    iosController.isMuted = !iosController.isMuted;
    const icon = document.getElementById("sound-icon");
    if (icon) icon.textContent = iosController.isMuted ? "🔇" : "🔊";
    iosController.playHaptic("light");
  });

  // Widget Actions
  document.getElementById("w-btn-play")?.addEventListener("click", () => {
    if (term.onkey) term.onkey(" ");
    iosController.playHaptic("medium");
  });

  document.getElementById("w-lg-pause")?.addEventListener("click", () => {
    if (term.onkey) term.onkey(" ");
  });

  document.getElementById("w-lg-theme")?.addEventListener("click", () => {
    openSceneModal(term);
  });

  document.getElementById("w-lg-stop")?.addEventListener("click", () => {
    if (term.onkey) term.onkey("q");
  });
}

function openSceneModal(term) {
  const modal = document.getElementById("scene-modal");
  const grid = document.getElementById("scene-grid");
  if (!modal || !grid) return;

  grid.innerHTML = "";
  for (const [name, theme] of THEMES) {
    const card = document.createElement("div");
    card.className = "scene-card" + (name === iosController.currentTheme ? " selected" : "");
    card.innerHTML = `<div class="scene-title">${name}</div><div class="scene-blurb">${theme.blurb}</div>`;
    card.addEventListener("click", () => {
      iosController.playHaptic("light");
      iosController.currentTheme = name;
      if (term.onkey) {
        term.onkey("t"); // triggers scene picker in countdown
      }
      modal.classList.remove("open");
    });
    grid.appendChild(card);
  }

  document.getElementById("btn-set-default").onclick = () => {
    keepDefault(iosController.currentTheme);
    iosController.playHaptic("medium");
    modal.classList.remove("open");
  };

  document.getElementById("modal-close").onclick = () => {
    modal.classList.remove("open");
  };

  modal.classList.add("open");
}

/* --- Main Boot -------------------------------------------------------------- */

async function main() {
  const termContainer = document.getElementById("terminal");
  const term = new Term(termContainer);
  window.term = term;

  setupIOSControls(term);
  greet(term);

  await whoami();
  whereBlocksGo(term);
  term.write();

  await askProfile(term);

  const first = (await term.readLine("Goal: ")).trim();
  if (first && !first.startsWith("-")) {
    const plan = parse("");
    plan.goal = [first];
    await block(term, plan);
    term.write();
  } else if (first) {
    await run(term, first);
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
    }
    term.write();
  }
}

main();

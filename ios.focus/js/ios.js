/* iOS specific controller & ergonomic features for focus.
 * Handles iOS Widget view modes, Live Activity (Dynamic Island),
 * Adaptive Orientation / Auto-Rotation, Touch Controls, Scene Wheel Modal,
 * and Audio / Haptic feedback.
 */

import { THEMES } from "./themes.js";
import { defaultScene, keepDefault } from "./store.js";
import { clock, glyphclock } from "./util.js";

class IOSController {
  constructor() {
    this.mode = "fullscreen"; // "fullscreen" | "small" | "medium" | "large" | "lockscreen"
    this.isMuted = false;
    this.audioCtx = null;
    this.currentGoal = "Deep Work";
    this.currentTheme = defaultScene() || "matrix";
    this.remainingSeconds = 1500;
    this.totalSeconds = 1500;
    this.isPaused = true;
    this.isRunning = false;
    this.orientation = window.innerWidth > window.innerHeight ? "landscape" : "portrait";
    
    this.listeners = new Set();
  }

  init() {
    this.bindEvents();
    this.checkOrientation();
    this.initAudio();
  }

  bindEvents() {
    window.addEventListener("resize", () => this.handleResize());
    window.addEventListener("orientationchange", () => {
      setTimeout(() => this.handleResize(), 200);
    });
  }

  initAudio() {
    const initOnTouch = () => {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioCtx && this.audioCtx.state === "suspended") {
        this.audioCtx.resume();
      }
      window.removeEventListener("touchstart", initOnTouch);
      window.removeEventListener("click", initOnTouch);
    };
    window.addEventListener("touchstart", initOnTouch, { passive: true });
    window.addEventListener("click", initOnTouch, { passive: true });
  }

  playHaptic(type = "light") {
    if ("vibrate" in navigator) {
      try {
        if (type === "light") navigator.vibrate(10);
        else if (type === "medium") navigator.vibrate(25);
        else if (type === "heavy") navigator.vibrate([30, 50, 30]);
      } catch (e) {}
    }
  }

  playTickSound() {
    if (this.isMuted || !this.audioCtx) return;
    try {
      const at = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1200, at);
      gain.gain.setValueAtTime(0.01, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
      osc.connect(gain).connect(this.audioCtx.destination);
      osc.start(at);
      osc.stop(at + 0.05);
    } catch (e) {}
  }

  handleResize() {
    const newOrientation = window.innerWidth > window.innerHeight ? "landscape" : "portrait";
    if (newOrientation !== this.orientation) {
      this.orientation = newOrientation;
      this.playHaptic("light");
    }
    if (window.term) {
      window.term.resize();
    }
    this.updateWidgetPreviews();
  }

  setMode(newMode) {
    if (this.mode === newMode) return;
    this.mode = newMode;
    document.body.setAttribute("data-view-mode", newMode);
    this.playHaptic("medium");
    this.handleResize();
  }

  updateState({ goal, remaining, total, paused, theme, running }) {
    if (goal !== undefined) this.currentGoal = goal;
    if (remaining !== undefined) this.remainingSeconds = remaining;
    if (total !== undefined) this.totalSeconds = total;
    if (paused !== undefined) this.isPaused = paused;
    if (theme !== undefined) this.currentTheme = theme;
    if (running !== undefined) this.isRunning = running;

    this.updateLiveActivity();
    this.updateWidgetPreviews();
  }

  updateLiveActivity() {
    const timeStr = clock(this.remainingSeconds);
    const goalEl = document.getElementById("la-goal");
    const timerEl = document.getElementById("la-timer");
    const progressEl = document.getElementById("la-progress-bar");

    if (goalEl) goalEl.textContent = this.currentGoal || "Focus Session";
    if (timerEl) timerEl.textContent = timeStr;
    if (progressEl) {
      const pct = Math.max(0, Math.min(100, (1 - this.remainingSeconds / (this.totalSeconds || 1)) * 100));
      progressEl.style.width = `${pct}%`;
    }
  }

  updateWidgetPreviews() {
    const timeStr = clock(this.remainingSeconds);
    const { emoji } = glyphclock();
    const pct = Math.round((1 - this.remainingSeconds / (this.totalSeconds || 1)) * 100);

    // Small widget (2x2)
    const smTime = document.getElementById("widget-sm-time");
    const smGoal = document.getElementById("widget-sm-goal");
    const smGlyph = document.getElementById("widget-sm-glyph");
    if (smTime) smTime.textContent = timeStr;
    if (smGoal) smGoal.textContent = this.currentGoal;
    if (smGlyph) smGlyph.textContent = emoji;

    // Medium widget (4x2)
    const mdTime = document.getElementById("widget-md-time");
    const mdGoal = document.getElementById("widget-md-goal");
    const mdProgress = document.getElementById("widget-md-progress");
    const mdTheme = document.getElementById("widget-md-theme");
    if (mdTime) mdTime.textContent = timeStr;
    if (mdGoal) mdGoal.textContent = this.currentGoal;
    if (mdProgress) mdProgress.style.width = `${pct}%`;
    if (mdTheme) mdTheme.textContent = this.currentTheme;

    // Large widget (4x4)
    const lgTime = document.getElementById("widget-lg-time");
    const lgGoal = document.getElementById("widget-lg-goal");
    const lgProgress = document.getElementById("widget-lg-progress");
    const lgTheme = document.getElementById("widget-lg-theme");
    const lgPct = document.getElementById("widget-lg-pct");
    if (lgTime) lgTime.textContent = timeStr;
    if (lgGoal) lgGoal.textContent = this.currentGoal;
    if (lgProgress) lgProgress.style.width = `${pct}%`;
    if (lgTheme) lgTheme.textContent = `Theme: ${this.currentTheme}`;
    if (lgPct) lgPct.textContent = `${pct}% completed`;

    // Lockscreen widget
    const lsTime = document.getElementById("widget-ls-time");
    const lsGoal = document.getElementById("widget-ls-goal");
    if (lsTime) lsTime.textContent = timeStr;
    if (lsGoal) lsGoal.textContent = this.currentGoal;
  }
}

export const iosController = new IOSController();

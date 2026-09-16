# CLAUDE.md for ios.focus

Guidance for Claude Code when working in `toolkit/ios.focus`.

## What this is

An iOS-optimized port of the `focus` pomodoro tool, with:
1. **Full cell-for-cell feature parity** with `toolkit/web.focus` and `toolkit/focus`.
2. **iOS Widget View Modes**: Full Screen, Small Widget (2x2), Medium Widget (4x2), Large Widget (4x4), and Lock Screen Widget.
3. **Adaptive Rotation**: Instant re-layout on device rotation (portrait and landscape) without dropping session state or canvas accuracy.
4. **iOS Controls**: Dynamic Island / Live Activity status bar, floating touch action bar, iOS scene wheel modal, touch input chip toolbar, audio chimes, and haptic feedback simulation.

## Structure

- `index.html`: Shell container with iOS status bar, Dynamic Island, mode selector, full screen terminal canvas, widget views, action bar, and scene picker modal.
- `styles.css`: Complete iOS design system with glassmorphism, responsive grid layouts, widget sizing, and landscape/portrait orientation queries.
- `config.js`: Accounts and API service URL endpoints.
- `manifest.json`: Web App Manifest for standalone iOS Home Screen installation.
- `js/util.js`: Python integer & string helpers, RGB colors, 3x5 glyph clock face, and GlyphClock calculation.
- `js/canvas.js`: Cell grid canvas and sprite class.
- `js/themes.js`: All 12 cell-for-cell animated scenes (`aquarium`, `forest`, `matrix`, `rain`, `space`, `fire`, `city`, `mountains`, `sunset`, `cyberpunk`, `zen`, `airport`).
- `js/overlay.js`: Overlay clock, progress bar, corner glyphs, and celebration finale animations (fireworks, shockwave, confetti).
- `js/screen.js`: Terminal emulator with scrollback buffer and alternate screen mode.
- `js/store.js`: Local storage persistence and account sync.
- `js/views.js`: Log and history formatting.
- `js/focus.js`: Focus block countdown cycle, alarm, and celebration controller.
- `js/ios.js`: iOS-specific controller managing widget states, Dynamic Island, rotation handlers, audio synthesis, and haptics.
- `js/app.js`: CLI flag parser, prompt shell, touch control wireups, and bootstrap.

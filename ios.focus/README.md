# ios.focus

`focus` for iOS — behaving and looking like the terminal & web version, with native iOS widget modes, adaptive portrait/landscape rotation, and touch controls.

## Features

- **Full Feature Parity**: All 12 cell-for-cell themes (`aquarium`, `forest`, `matrix`, `rain`, `space`, `fire`, `city`, `mountains`, `sunset`, `cyberpunk`, `zen`, `airport`), pomodoro timer countdown, clock overlay with 3x5 font, progress bar, glyph corners, celebration finale animations (fireworks, shockwave, confetti), CLI flag parsing (`-m`, `-t`, `--log`, `--history`, `--me`, `--login`, `--sync`, `--default-theme`, `clear`), and account sync.
- **Widget & Fullscreen Modes**:
  - **Full Screen**: Full terminal & scene view framed in an iOS device container with dynamic safe areas.
  - **Small Widget (2x2)**: Compact countdown, goal, and GlyphClock readout.
  - **Medium Widget (4x2)**: Wide widget with animated scene, timer, goal, progress bar, and touch play/pause button.
  - **Large Widget (4x4)**: Comprehensive widget with complete scene canvas, progress percentage, and quick controls.
  - **Lock Screen Widget**: Sleek circular ring and rectangular iOS lock screen widget style.
  - **Dynamic Island / Live Activity**: Top pill bar displaying real-time session progress that expands on tap.
- **Adaptive Rotation**: Seamless automatic re-layout when rotating between Portrait and Landscape orientations without interrupting running blocks.
- **iOS Touch & Ergonomics**:
  - Floating Quick Action Bar (Pause/Play, Scene Picker Modal, Goal Prompt, Mode Switcher, Sound toggle).
  - Scene Wheel Picker Modal for instant theme selection and setting default scenes.
  - Touch Keyboard Toolbar with preset command chips (`focus`, `-m 25`, `-t aquarium`, `--log`, `--history`, `clear`).
  - Web Audio synthesized alarm tones & haptic vibration simulation (`navigator.vibrate`).
- **PWA Ready**: Web App Manifest (`manifest.json`) and iOS Home Screen standalone web app meta configuration.

## Running Locally

No build step required. Run using Python's static HTTP server:

```bash
cd ios.focus && python3 -m http.server 8085
```

Open `http://localhost:8085` in your desktop or mobile browser (or iOS Safari).

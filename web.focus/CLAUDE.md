# CLAUDE.md

Guidance for Claude Code when working in `toolkit/web.focus`.

## What this is

The `focus` pomodoro as a web page: a terminal emulator with one command in
it. Read `../focus` first — this is a port of that script, not a reimagining
of it, and the script is the source of truth for every behaviour here.

Vanilla ES modules, no build step, no dependencies. `python3 -m http.server`
is the dev server.

## The rule that matters

**Behaviour lives in `../focus`.** A scene, a key, a line of output or a
column width that differs from the script is a bug in this port, not a
variation. When the script changes, change this too, in the same commit where
it is practical.

The port deliberately keeps the script's names and shapes — `Canvas.put`,
`Sprite`, `Theme.advance`, `compose`, `corner`, `label`, `banner`, `Finale`,
`blocksOn`, `strip`, `parseWhen` — so the two files can be read side by side.
Do not "improve" a structure here that the script also has; change both or
neither.

Three places Python and JavaScript disagree, all handled in `js/util.js`:

- `%` on a negative number. Every modulo that indexes goes through `mod()`.
- `int()` truncates towards zero, `Math.floor` does not. `trunc()` is the
  Python one; `Canvas.put` floors deliberately, and says so.
- String length counts UTF-16 units. `width()`, `cut()` and `chars()` count
  characters, so an emoji in a goal stays one cell.

## There is no separate iOS port

An `ios.focus` directory existed briefly (a byte-for-byte copy of every file
here plus a widget/Dynamic Island layer simulated in CSS — not real
WidgetKit, since a web page cannot register one) and was folded back into
this page instead of kept as a fourth codebase to keep in sync. "The iOS
version" is this page, made installable: `manifest.json`,
`apple-mobile-web-app-*` meta tags in `index.html`, and safe-area padding in
`styles.css` for standalone mode's missing browser chrome. If a real native
app is ever wanted — actual Home Screen widgets, Live Activities — that is a
SwiftUI project calling `backend.toolkit` and `accounts` directly, the same
pattern as `Snippets/ios.snippets`, not another HTML/CSS/JS tree here.

## What the web version adds, and why

- **A shell.** The script is invoked with argv; the page has a prompt that
  parses the same flags off a typed line (`js/app.js`). `clear` and
  `--default-theme` are the only commands with no flag behind them —
  `--default-theme` is what `$FOCUS_THEME` is to the script.
- **Two surfaces.** `js/screen.js` is a terminal: a scrollback for printed
  output and an alternate screen for a running block, which is exactly what
  the script's `\033[?1049h` does.
- **A cell grid in the DOM.** One `<span>` per run of one tint. An emoji is
  one cell to the drawing code and two on screen, so the renderer boxes it
  into `2ch` and swallows the pad cell after it — the same trick `corner()`
  plays in the terminal.
- **The account over a cookie, not a token.** The CLI posts a password to
  `accounts/login` and keeps a bearer token in `~/focus/token`. A browser must
  not do that: `--login` hands over to the accounts service's own sign-in page
  and comes back with the shared `bl_session` cookie, and every call goes out
  with `credentials: "include"`. There is no token in `localStorage` and there
  should never be one.

## Things that will bite

- **Sign-in only works from a `*.bang-labs.eu` origin**, because the cookie is
  scoped to the parent domain. Both `accounts` and `backend.toolkit` must also
  list the origin in `ALLOWED_ORIGINS`. Locally, `?api=…&accounts=…` points
  the page at local services; cookies ignore ports, so that works.
- **`localStorage` can throw** (private windows, blocked site data). Every
  read and write in `js/store.js` is wrapped, and the page has to work with
  none of it.
- **The alternate screen is repainted whole, ten times a second.** Keep
  `frame()` cheap: build one string, set `innerHTML` once. Per-cell elements
  will not hold up on a maximised window.
- **Keys come from an off-screen `<input>`**, not the document, because a
  phone needs a focused field to raise a keyboard. Anything that swallows
  focus breaks every key at once.
- **A file the Dockerfile forgets does not 404** — `try_files $uri $uri/
  /index.html` answers with the page, as `text/html`, status 200. That is how
  `manifest.json` shipped for two days as a perfectly healthy-looking page
  that iOS silently declined to install. Anything `index.html` names has to be
  on a `COPY` line; `curl -I` a fresh deploy and read the *content type*, not
  the status.

## Testing

There is no test runner. Two things worth doing by hand after a change:

```bash
# Every theme, one frame each, next to the script's own output.
node --check js/*.js
```

`js/themes.js` can be imported in node with `localStorage`, `window`,
`location` and `navigator` stubbed, and a frame printed as plain text — that
is how the port was checked against `focus` scene by scene. Puppeteer (in
`@mermaid-js/mermaid-cli`'s `node_modules`) drives the page itself against a
stubbed accounts/toolkit pair for the signed-in path.

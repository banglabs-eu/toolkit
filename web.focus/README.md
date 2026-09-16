# web.focus

`focus` in a browser tab, behaving and looking like the terminal it came from.

The whole page is a terminal: a prompt you type `focus` arguments at, a
scrollback the output prints into, and an alternate screen a running block
takes over and hands back when it ends. The clock, the progress bar, the
twelve scenes, the finish animation and the GlyphClock corner are the ones
from `toolkit/focus`, ported cell for cell.

```
$ focus -m 50 -t aquarium rewrite the intro
```

## Running it

No build step, no dependencies. Any static server will do:

```bash
cd web.focus && python3 -m http.server 8080      # http://localhost:8080
```

It has to be served over http — the page is ES modules, which `file://`
refuses.

## What you can type

The prompt takes the flags the script takes, and the goal is whatever is left
over. `--help` prints the list.

| Typed | What happens |
|-------|--------------|
| `rewrite the intro` | 25 minutes against that goal |
| `-m 50 deep work` | a different length |
| `-t aquarium read` | pick the scene instead of taking pot luck |
| `--preview airport` | watch a theme, logging nothing |
| `--log` | the sessions so far, today's total on top |
| `--history` / `--history yesterday` / `--history week` | a day at a time |
| `--no-finale quiet` | land the block without the celebration |
| `--me` | the name and birthday the birthday scene uses |
| `--login` / `--logout` / `--whoami` | the account the blocks go to |
| `--sync` / `--upload` | send what is waiting, or what predates the account |
| `--default-theme matrix` | what `$FOCUS_THEME` is to the script |
| `clear` | empty the scrollback |

While a block runs: `space` pauses, `t` opens the scene picker — the arrow
keys walk the rota, each scene drawn behind the clock as you reach it, and
`t`, `enter` or `escape` goes back to the block — and `q` stops early. A block that reaches zero rings, draws six seconds of fireworks,
a shockwave or confetti, and then asks what comes next — `f` new session, `r`
the same goal again, `q` quit. Up and down walk back through what you typed.

On a phone the keyboard comes up on a tap, and a tap during a block is the
space bar.

## Where the blocks go

Signed out, the record is `localStorage` in this browser and the page never
touches the network — the same deal the script gives you without an account.

`--login` hands over to `accounts.bang-labs.eu`, which comes back with the
shared `bl_session` cookie, and from then on every block is written to
`toolkit.bang-labs.eu/focus/sessions` — the same rows `focus --history` reads
on the desktop. Nothing is stored here but a username to print and a queue of
blocks that could not be uploaded, which go up with the next one.

That only works while this page is served from a `*.bang-labs.eu` origin: the
cookie is scoped to the parent domain, and both services have to list the
origin in `ALLOWED_ORIGINS` (see `accounts/CLAUDE.md` and
`backend.toolkit/CLAUDE.md`). Deploying it anywhere else leaves the local
record working and sign-in failing, which is the right way round.

For development against local services, `config.js` holds both URLs and
`?api=…&accounts=…` overrides them for one load:

```
http://localhost:8080/?accounts=http://localhost:8010&api=http://localhost:8014
```

A cookie ignores ports, so a local accounts on `:8010` signs you in to a local
toolkit API on `:8014` with no further ceremony — as long as both list
`http://localhost:8080` in `ALLOWED_ORIGINS`.

## How it is put together

```
index.html      the terminal: a scrollback, an alternate screen, an off-screen input
styles.css      dark ground, JetBrains Mono, the cell box everything is measured against
config.js       which accounts and toolkit API to talk to
js/util.js      tints, random, the 3x5 clock font, Bresenham, Easter, the GlyphClock
js/canvas.js    the character grid, sprites, and the theme base class
js/themes.js    all twelve scenes
js/overlay.js   the clock, the bar, the two bottom corners, the finish animation
js/screen.js    the terminal itself: scrollback, alternate screen, keys, the typed line
js/store.js     profile, the local record, the account, uploads and the waiting queue
js/views.js     --log and --history, printed the way they print in a terminal
js/focus.js     one block: countdown, alarm, celebration, what comes next
js/app.js       the prompt, the flags, and the commands behind them
```

The port keeps the script's shapes on purpose — `Canvas.put`, `Sprite`,
`Theme.advance`, `compose`, `Finale` and the rest read the same in both, so a
change to a scene can be made twice without re-deriving it. Python's integer
division, `%` on negatives and `int()` truncation are the three places the two
languages disagree; `util.js` has `mod` and `trunc` for exactly that, and every
index that could go negative goes through them.

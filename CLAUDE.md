# CLAUDE.md

## What This Is

A polyglot collection of scripts and tools for Pop!_OS. Shell, Python, and whatever else fits. Personal repo by AdamBK, cloned inside the Bang Labs workspace.

## Structure

Scripts are organized by purpose. Each script should be self-contained or document its dependencies.

`web.focus/` is the exception: a directory, not a script — the `focus` pomodoro
ported to a web page that behaves and looks like the terminal one. It has its
own CLAUDE.md, and the rule there is that `focus` is the source of truth for
every behaviour, so the two change together.

## Conventions

- Scripts should have a usage comment or `--help` flag
- Shell scripts: Bash, use `set -euo pipefail`
- Python scripts: Python 3, use `#!/usr/bin/env python3`
- Keep dependencies minimal; prefer standard library where practical

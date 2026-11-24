# Project skills

Claude Code loads every folder here as a skill for anyone who works in this repo. They are plain
instructions (Markdown) plus a few small local Python helpers in the founder skills. No hooks, no
network calls, nothing runs on its own.

| Skill | What it does | Source | License |
| --- | --- | --- | --- |
| `napkin` | Keeps a short, curated runbook of lessons for this repo in `.claude/napkin.md`, read at the start of every session so the same mistake is not made twice. | github.com/blader/napkin @ 27fa60a | MIT |
| `founder-*` (11) | Business checks before launch: board, marketing, CFO, consumer panel, launch, pricing, offer, competitors, brand, ops, plan. Run them as `/founder-board`, `/founder-cfo` and so on. | github.com/Jakeschincariol/founder-skill @ fd9385b | MIT |
| `ponytail*` (6) | "Lazy senior developer": write the least code that solves the problem and reuse what exists. Also review, audit and tech-debt passes. | github.com/DietrichGebert/ponytail @ ebd8654 (skills only; its hooks and status line are not installed) | MIT |

Design: the repo's `DESIGN.md` follows the format of github.com/VoltAgent/awesome-design-md, written
from Field Pro's own design tokens.

Memory across sessions (claude-mem, github.com/thedotmack/claude-mem) is installed on a computer, not
in a repo. See "Memory between sessions" in `CLAUDE.md`.

To update a skill, copy the new version over its folder and change the commit in this table.

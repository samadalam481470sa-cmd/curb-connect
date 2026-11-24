# Instructions for Claude

These rules come from the repo owner, Samad Alam. They apply to every Claude session that works in
this repository.

## Git workflow

- The owner wants finished work on `main`.
- When a task is done, commit it and push it straight to `main`. Do not ask first.
- Do not create a feature branch or open a pull request unless the owner asks for one in the
  request.
- Commit in small, logical steps. Each commit message says what changed and why.
- Before each push, run `git pull --rebase origin main` so the push does not overwrite newer work.
- Never force-push to `main`.
- Never commit secrets. This includes `.env` files, API keys, tokens and passwords.

## Checks before pushing

- When dependencies are installed, run `npm run lint`, `npm run typecheck` and `npm run test:unit`
  before pushing.
- If a check fails, fix it and then push.
- If a check still fails and cannot be fixed, push the work to a branch named `wip/<topic>` and
  tell the owner what failed.
- CI runs on every push. If CI fails after a push to `main`, fix it in the next commit.

## Skills, notes and design

- Project skills live in `.claude/skills/` (see its README): `napkin`, the `founder-*` business
  skills and the `ponytail*` code-economy skills.
- Read `.claude/napkin.md` at the start of every session and keep it curated, as the napkin skill
  says. Add a line when you hit a mistake that could happen again.
- Use `DESIGN.md` for every UI change in `apps/web`. Use the existing CSS variables, not new colors.
- Prefer the smallest change that solves the problem and reuse existing code (ponytail skill).

## Memory between sessions

`claude-mem` keeps memory across Claude Code sessions on one computer. It installs on that computer,
not in this repo: run `npx claude-mem install` there. It asks you to sign in and offers a paid
observer trial; choose your own Anthropic plan or pass `--provider` to skip that. Turn off its
analytics with `npx claude-mem telemetry disable`.

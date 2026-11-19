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

# Napkin Runbook

## Curation Rules
- Re-prioritize on every read.
- Keep recurring, high-value notes only.
- Max 10 items per category.
- Each item includes date + "Do instead".

## Execution & Validation (Highest Priority)
1. **[2026-11-22] Render does not deploy pushes on its own**
   Do instead: after pushing to main, trigger deploys for curb-connect-api (srv-dbqh3etbedkc73djeejg) and curb-connect-web (srv-dbqh3etbedkc73djeek0), then confirm both are "live".
2. **[2026-11-22] Integration tests need PostGIS; CI runs them**
   Do instead: run lint, typecheck and `npm run test:unit` locally; after pushing, check `gh run list` and fix any "API integration" failure in the next commit.
3. **[2026-11-22] New API modules are counted in apps/api/src/app.test.ts**
   Do instead: add the module name to the list and raise the expected count in the same change.
4. **[2026-11-22] New primary nav routes are listed in two tests**
   Do instead: update packages/contracts/src/rbac.test.ts and apps/web/src/lib/navigation.test.ts with the new label and id.

## Shell & Command Reliability
1. **[2026-11-22] `prettier --write` on a whole folder reformats unrelated files**
   Do instead: run prettier only on the files you changed; `git checkout --` anything else it touched.
2. **[2026-11-22] Other sessions push to main often**
   Do instead: `git pull --rebase origin main` right before every push; never force-push.

## Domain Behavior Guardrails
1. **[2026-11-22] Never invent data, contacts or prices**
   Do instead: show only what a public record or the user provided; otherwise show "not listed" and a lookup link.
2. **[2026-11-22] Migrations are numbered in apps/api/drizzle with a journal entry**
   Do instead: take the next free number after `git pull`, add the journal entry, and enable tenant RLS for any org table.
3. **[2026-11-22] Lint forbids setState inside useEffect**
   Do instead: derive values during render or use a lazy useState initializer.

## User Directives
1. **[2026-11-22] Finished work goes straight to main**
   Do instead: small commits with clear messages, pushed to main without asking (see CLAUDE.md).
2. **[2026-11-22] Never remove existing features when adding new ones**
   Do instead: add alongside; link new screens from existing ones.

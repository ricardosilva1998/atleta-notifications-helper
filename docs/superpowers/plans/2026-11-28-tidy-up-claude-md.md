# Plan: Tidy up CLAUDE.md (Ticko TB-317)

Brief: `brief.md`

Every worker runs on `sonnet`. Tasks run one at a time. No task commits, pushes or deploys: the ship session does that after review.

**Base commit:** `3c4b4ff`. CLAUDE.md there is 145,435 bytes. Its sections (bytes): intro 1.3k, Tech Stack 3.8k, Commands 0.8k, **Project Structure 23k**, **Key Architecture 93k**, Environment Variables 4.4k, Operations 1.8k, Conventions 5.7k, Overlay Consistency Rule 4.4k, Team Activity Log 7.1k (10 entries). Target: under 40,000 characters. Moving the Project Structure tree and the Key Architecture body, each replaced by a short index, lands at about 37k.

**Rules for every task (from the brief):**
- **Move, never delete.** Every non-blank line taken out of CLAUDE.md must exist, character for character as a whole line, in a `docs/**/*.md` file. Cut and paste whole blocks; never reword a moved line. A nested bullet moves with its parent bullet.
- New lines (titles, headings, pointers, the short index) may be written freely; only removed lines are checked.
- Docs only: no file outside `CLAUDE.md` and `docs/` changes (the run folder under `.claude/relay/` is untracked and fine).
- **Never touch, add or delete the untracked iCloud duplicates** (files ending in ` 2.md`, ` 2.js`, ` 2.sql`, e.g. `docs/superpowers/plans/2026-11-18-deep-review-fixes 2.md`). They are not part of this run.
- Keep in CLAUDE.md unchanged: the intro, Tech Stack, Commands, Environment Variables, Operations, Conventions, Overlay Consistency Rule, and the Team Activity Log with its rule (last 10 entries; older ones to `docs/activity-log.md`).

## Shipping
- **Ship:** yes, as a pull request (the brief; this repo's `main` requires pull requests). Docs only, so nothing deploys.
- **Where:** new branch `docs/tidy-claude-md` from `main`; commit only `CLAUDE.md` and the new/changed files under `docs/` (stage them by name, never `git add -A`: the untracked ` 2.*` duplicates must stay out); normal push of the branch; `gh pr create --base main --head docs/tidy-claude-md --title "Tidy up CLAUDE.md: move long reference sections to docs/"` with a body giving the before/after sizes of CLAUDE.md, the files created, and the `check_moved.py` result. **Never push to `main` and never merge the PR** (Ricardo merges it).
- **Checks before push:** `python3 '.claude/relay/2026-11-28-tidy-up-claude-md/check_moved.py' 3c4b4ff` exits 0; `git diff --stat 3c4b4ff -- . ':!CLAUDE.md' ':!docs'` is empty; `git diff --cached --name-only` lists only `CLAUDE.md` and `docs/` paths; the unit suite passed in T5.
- **Verify live:** nothing deploys (a merge to `main` would deploy to Railway, but only Ricardo merges). Verify `gh pr view --json url,state,headRefName` shows the PR open on `docs/tidy-claude-md`, and that CI (`server-ci.yml`) starts on it. Then add the PR link to Ticko TB-317 (note + update; leave its status for the owner).

## Tasks

### T1: The move check script
- **What:** `check_moved.py` in the run folder that proves nothing was lost. Start from the copy used in the share-tv tidy-up, `~/projects/share-tv/.claude/relay/2026-11-28-tidy-up-claude-md/check_moved.py` (copy it, then make two changes):
  1. When collecting lines from `docs/**/*.md`, skip files whose name ends in ` 2.md` (untracked iCloud duplicates; a moved line must be in a file that will be committed).
  2. When checking that every `docs/…md` path written in CLAUDE.md exists, skip paths containing `YYYY` (the Team Activity Log names the placeholder `docs/team-log-archive/YYYY-MM.md`).
  Keep its `--self-test` and extend it with one assertion that a line present only in `docs/x 2.md` is reported missing.
- **Files:** create `.claude/relay/2026-11-28-tidy-up-claude-md/check_moved.py`. Read only the share-tv copy.
- **Agent:** general-purpose
- **Model:** sonnet
- **Depends on:** none
- **Verify:** `python3 '.claude/relay/2026-11-28-tidy-up-claude-md/check_moved.py' --self-test` exits 0; `python3 '.claude/relay/2026-11-28-tidy-up-claude-md/check_moved.py' 3c4b4ff` on the untouched tree exits 0 and prints before size `145435` bytes.
- **Decisions that apply:** Move, never delete (this script is the proof). Do not edit CLAUDE.md or docs in this task.

### T2: Move the Project Structure tree out
- **What:**
  - Create `docs/project-structure.md`: title `# Project structure`, one sentence saying it is the full file map moved out of CLAUDE.md on 2026-11-28 and that a file added or renamed gets its line here. Then the whole body of CLAUDE.md's `## Project Structure` section (the fenced tree, every line, verbatim, fences included).
  - In CLAUDE.md, `## Project Structure` keeps a short fenced tree written fresh: one line per top-level folder and per `src/` subfolder (`src/` with `index.js`, `config.js`, `db.js`, `server.js`, `discord.js` named; `src/pollers/`, `src/services/`, `src/routes/`, `src/views/`, `src/locales/`, `public/` with `js/` and `overlay/`, `tests/`, `scripts/`, `data/`, `docs/` with `features/`, `operations/`, `superpowers/`), each with a few words of what lives there, then the pointer line: `Every file with what it does: docs/project-structure.md.` Keep it under 2,000 characters.
- **Files:** `CLAUDE.md` (section `## Project Structure` only), create `docs/project-structure.md`.
- **Agent:** general-purpose
- **Model:** sonnet
- **Depends on:** T1
- **Verify:** `python3 '.claude/relay/2026-11-28-tidy-up-claude-md/check_moved.py' 3c4b4ff` exits 0 and the after size is below 125,000. `grep -c 'coachingRooms.js' docs/project-structure.md` is at least 1.
- **Decisions that apply:** Move, never delete; whole lines verbatim; no other section touched; no commit.

### T3: Move Key Architecture into docs/architecture.md with an index left behind
- **What:**
  - Create `docs/architecture.md`: title `# Key architecture`, one sentence saying it holds the architecture notes moved out of CLAUDE.md on 2026-11-28, that CLAUDE.md keeps an index of its sections, and that a change to a feature updates its section here. Then every bullet of CLAUDE.md's `## Key Architecture` section in the same order, verbatim (the two CSRF sub-bullets stay under the CSRF bullet), each preceded by a new `## <name>` heading taken from the bullet's bold label without the trailing colon (e.g. `## Dashboard`, `## OBS Overlay`, `## CSRF`, `## Coaching`). Two bullets may not share a heading: `**Auth:**` → `## Auth`, `**Auth flows (Streamer):**` → `## Auth flows (Streamer)`.
  - In CLAUDE.md, `## Key Architecture` keeps:
    - the line `Each area's full notes are a section of docs/architecture.md, under the heading named here. Read the section before changing that area; update it in the same change.`
    - these bullets, **verbatim, also kept** (they are rules every change must follow): `**No ORM:**`, `**Free for all:**`, and the two CSRF sub-bullets (`**Adding a form or a \`fetch\` to a page:**`, `**Adding a route that a program, not a browser page, calls with an unsafe method**`) under a new line `- **CSRF** (full notes: docs/architecture.md, "CSRF"):`.
    - an index: one bullet per remaining heading, written fresh, under 160 characters each: `- **<heading>**: <a few words of what it covers>` (e.g. `- **Coaching**: bookings, PayPal payments, Discord rooms, cancel/reschedule/refunds; also docs/features/coaching.md`). Where the original bullet named a `docs/features/*.md` or `docs/operations/*.md` file, keep that file in the index line.
  - Size budget for the kept section: under 9,000 characters.
- **Files:** `CLAUDE.md` (section `## Key Architecture` only), create `docs/architecture.md`.
- **Agent:** general-purpose
- **Model:** sonnet
- **Depends on:** T2
- **Verify:** `python3 '.claude/relay/2026-11-28-tidy-up-claude-md/check_moved.py' 3c4b4ff` exits 0 and the after size is below 40,000. `grep -c '^## ' docs/architecture.md` equals the number of top-level bullets in the base section (`git show 3c4b4ff:CLAUDE.md | sed -n '/^## Key Architecture/,/^## Environment/p' | grep -c '^- \*\*'`). Every heading in `docs/architecture.md` appears in CLAUDE.md's index (`grep -o '^## .*' docs/architecture.md | sed 's/^## //'` each found with `grep -F` in CLAUDE.md). If the size is still above 40,000, move the `Optional:` list of `## Environment Variables` (verbatim) to `docs/operations/environment.md` with a pointer line, and say so in the report.
- **Decisions that apply:** Move, never delete; whole lines verbatim; Overlay Consistency Rule, Conventions and Team Activity Log untouched; no commit.

### T4: Commit-ready copy of the plan
- **What:** Copy this `plan.md` to `docs/superpowers/plans/2026-11-28-tidy-up-claude-md.md` (the project keeps every run's plan there). Do not commit.
- **Files:** read `.claude/relay/2026-11-28-tidy-up-claude-md/plan.md`, create `docs/superpowers/plans/2026-11-28-tidy-up-claude-md.md`.
- **Agent:** general-purpose
- **Model:** sonnet
- **Depends on:** T3
- **Verify:** `diff '.claude/relay/2026-11-28-tidy-up-claude-md/plan.md' docs/superpowers/plans/2026-11-28-tidy-up-claude-md.md` prints nothing.
- **Decisions that apply:** Docs only; no commit.

### T5: QA gate
- **What:** Prove the tidy-up lost nothing and changed no code, then log it.
  1. `python3 '.claude/relay/2026-11-28-tidy-up-claude-md/check_moved.py' 3c4b4ff` exits 0; note the before/after sizes; after is below 40,000.
  2. `git diff --stat 3c4b4ff -- . ':!CLAUDE.md' ':!docs'` prints nothing, and `git status --short` shows the ` 2.*` duplicates exactly as before (untracked, unchanged).
  3. `git diff 3c4b4ff -- CLAUDE.md` changes only the `## Project Structure` and `## Key Architecture` sections (plus Environment Variables if T3 used its fallback) and the Team Activity Log entry from step 5.
  4. Every `docs/` path written in the new CLAUDE.md resolves (step 1 covers it) and every index heading is a `## ` heading of `docs/architecture.md`.
  5. Run the unit suite: `node --test "src/**/*.test.js" "tests/**/*.test.js"` passes (docs only, so it must match `main`; if `better-sqlite3` needs a rebuild for the local Node, run it in a scratch copy as the last QA did and say so).
  6. Append one Team Activity Log entry in CLAUDE.md's format (`### 2026-11-28 HH:MM — team-qa (relay T5, tidy-up CLAUDE.md)` with Task, Files, Decisions incl. the before/after sizes and the new docs files, Open). That makes 11 entries: move the oldest (`### 2026-11-24 — backend-dev (T1, deep-review follow-ups)`), verbatim, to the end of `docs/activity-log.md` (oldest first there), so CLAUDE.md keeps 10. Re-run step 1 (exit 0, still under 40,000).
- **Files:** `CLAUDE.md` (Team Activity Log only), `docs/activity-log.md`; read everything else.
- **Agent:** team-qa
- **Model:** sonnet
- **Depends on:** T1, T2, T3, T4
- **Verify:** steps 1, 2 and 5 pass as stated; `grep -c '^### 20' CLAUDE.md` is 10; the check script exits 0 after the log move.
- **Decisions that apply:** Move, never delete; docs only; Team Activity Log keeps the last 10 entries, older ones appended to docs/activity-log.md; no commit, no push.

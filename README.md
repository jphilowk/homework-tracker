# Daybook

A homework tracker with classes, due dates, completion, search, filters, editing, and delete/undo. Your existing manual list is preserved.

## Open Daybook

- Original site: https://jphilowk.github.io/homework-tracker/
- Private Canvas version: https://daybook-canvas.homework-tracker.workers.dev/ — **setup in progress; access is currently locked**.

Canvas API access has been verified with the real account through the **Check Canvas connection** GitHub workflow. The private backend and UI are implemented. Cloudflare sign-in protection, the backend's Canvas secret, authenticated production sync, and enabling its schedule are still pending. Do not treat the upgrade as complete until those checks pass.

## Bring your existing homework to the private site

Once the connected site is ready:

1. On the original site, select **Export backup** in the Canvas area.
2. Open the private site and sign in with your authorized Cloudflare identity.
3. Select **Import backup** and choose the downloaded JSON file.
4. Select **Sync Canvas** to import your school assignments.

Import merges new records without replacing existing records with the same ID. Re-importing the same backup does not duplicate assignments. Backup files contain school information; keep them private. Backups are read locally in the browser, not uploaded to GitHub or the backend.

The original `daybook.assignments.v1` localStorage key is left untouched as a recovery copy. New changes use `daybook.state.v2`, which saves the list, dismissed Canvas IDs, and sync timestamp together. Import also keeps a pre-import recovery copy under `daybook.before-import.v2`. Neither migration nor a failed sync clears your list. Storage errors stop the save and show a message.

## How Canvas sync works

**Sync Canvas** requests active student courses and their assignments through the private server. Canvas credentials never reach the browser. Dates use the student-effective Canvas due timestamp and are shown in Central time, including daylight saving. Hover over an imported due date to see its full timestamp. New assignments without a usable due date are skipped.

Imports are matched by school, course ID, and assignment ID. Changed Canvas titles, classes, and dates update the existing import. Local edits to those Canvas-owned fields last until a newer snapshot arrives. Manual assignments are never replaced by Canvas imports.

Confirmed submission evidence can mark a task complete. A grade alone cannot: it might be a zero for missing work. Unknown Canvas status preserves the prior completion state. Checking or unchecking an imported assignment records your own completion choice, which future syncs preserve. Excused and resubmission statuses are shown as notes; resubmission reopens an automatically completed task unless you explicitly chose its status.

Deleting an import remembers its Canvas ID, so it stays deleted on later syncs. **Undo** restores it. Missing assignments and assignments that lose their due dates are kept with a note and their last known date. Nothing is deleted just because Canvas stopped returning it.

Cloudflare stores a private Canvas snapshot. Your manual tasks, local completion choices, and dismissals remain in this browser. They are not automatically shared across devices. Clearing browser data removes those local choices; export backups when needed.

The browser loads the most recent snapshot on opening/focus and checks for newer snapshots every five minutes while visible. A server-side schedule is implemented but disabled until live manual sync is verified; the intended interval is every two hours. That schedule will continue while the browser is closed. A failed check preserves the last successful snapshot and timestamp. A two-minute cooldown and a database lease prevent excessive or overlapping Canvas requests.

## Credential handling

- `CANVAS_TOKEN` is already stored in GitHub Actions Secrets for the read-only connection check. That check logs only fixed results, never student records, credentials, or raw API errors. It saves no artifacts.
- The private Worker needs its own `CANVAS_TOKEN` secret. GitHub Secrets are intentionally not readable back, and are not automatically copied to Cloudflare. Enter it only at a secure secret-manager/CLI prompt when instructed.
- The Worker also has an `OWNER_EMAIL` secret restricting access to the authorized owner. Cloudflare Access must authenticate every request. Spoofed identity headers do not grant access; the service uses Cloudflare's trusted `ctx.access` identity.
- No `.env`, `.dev.vars`, credential files, database snapshots, or real student fixtures belong in the repository. Never put a token in chat, a shell command argument, or frontend settings. Replace the token securely before its Canvas expiration date; revoked/expired tokens produce a safe error without clearing homework.
- Once the Worker exists, a token can be set or rotated locally using `npx --no-install wrangler secret put CANVAS_TOKEN` from this folder and entering it at the hidden prompt. The GitHub check's token is rotated separately with `gh secret set CANVAS_TOKEN --repo jphilowk/homework-tracker`.

## Local use and tests

Node.js 24 is recommended. Start the manual tracker with:

```sh
cd ~/homework-tracker
npm start
```

Visit http://localhost:4173. Stop with Control-C. The local server serves only public UI files; it does not access real Canvas credentials or private cloud data.

```sh
npm test
npm run audit:secrets
```

Tests cover the read-only API connector, pagination and destination restrictions, conservative completion, date conversion, state migration, deduplication, editing metadata, missing records, failure preservation, SQL lease/cooldown, authenticated request handling, and background scheduling. Test data and credentials are fabricated. The credential-pattern audit checks working files and Git history and supplements manual diff review.

Optional browser tests use Playwright with installed Google Chrome:

```sh
npm install --no-save playwright
APP_URL=http://localhost:4174 node tests/browser.mjs
node tests/canvas-browser.mjs
```

Run the local server on port 4174 (`PORT=4174 npm start`) for the Canvas suite. It mocks Canvas responses and tests desktop/mobile layouts, manual workflows, sync updates, completion overrides, delete/undo, failures, backups, migration/reload, and changes made during a sync. Do not run screenshots or traces against an authenticated real-account session.

## Deployment maintenance

GitHub Pages publishes the manual app from `main`. The private Worker is deployed separately:

```sh
npm ci
npx --no-install wrangler d1 migrations apply daybook-canvas --remote
npm run deploy:worker
```

The Worker embeds only five allowlisted UI files. It deliberately has no Cloudflare Static Assets binding because that router does not pass `ctx.access` to the user Worker. Owner identity is checked before returning any UI or API response. All responses are private/non-cacheable; state-changing API calls require a matching Origin and an application header. No public Canvas proxy or credential-entry endpoint exists.

`AUTO_SYNC_ENABLED` and `triggers.crons` remain disabled in `wrangler.jsonc` pending successful authenticated production verification. The intended cron is `17 */2 * * *` (UTC). Do not enable it before the manual connection works.

See [the implementation plan](docs/canvas-plan.md) for architecture, decisions, and verification gates.

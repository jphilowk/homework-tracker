# Canvas integration plan

Status: server-only read-only connector and manually triggered connection check implemented and tested with fabricated fixtures. The user confirmed personal-token availability and stored `CANVAS_TOKEN` in GitHub Actions Secrets. Live connection verification is the next gate; connected UI, backend provisioning, and automatic sync are not yet deployed. Do not paste credentials into chat.

## Existing app

The production app is static GitHub Pages. Its manual assignments are in `daybook.assignments.v1` in localStorage. There is no backend or authentication. All five existing Node tests pass at the start of this work. The working tree was clean at inspection and history contained one application commit.

## Proposed architecture

Use a small Cloudflare Worker, a private D1 database, Worker secrets, and Cloudflare Access restricted to the owner's verified identity. Serve the connected Daybook UI and API on the same protected origin to avoid fragile cross-site login cookies. GitHub remains the source repository. Keep the existing Pages site and its data accessible while adding an explicit migration path to the connected version.

The database initially needs only normalized Canvas records and sync metadata, not a replacement for all of Daybook's local persistence. A scheduled Worker can refresh that private snapshot while the browser is closed. When Daybook opens, it merges the latest snapshot into the user's local list. Manual assignments and local edits need not move to a database to make Canvas imports automatic. Cross-device synchronization of manual assignments is outside this initial scope.

Use a manual Sync Canvas endpoint first. Once verified against the real account, enable a modest schedule (initially every two hours), a sync lease, and a minimum interval for manual refreshes. Never publish assignment snapshots in GitHub Pages, commits, logs, or public workflow artifacts. GitHub Secrets alone would protect a token but would not protect assignment data published by an Actions job.

Cloudflare account authorization and the chosen sign-in identity will require user input later. No resources have been provisioned yet. Revisit this plan if the account already has a simpler suitable backend.

## Canvas access and data rules

- School origin: `https://naperville.instructure.com`. Make read-only API requests from the backend, never from frontend JavaScript. Restrict authenticated requests and pagination links to the expected HTTPS origin and API paths. Reject redirects rather than forwarding credentials. Use authorization headers, timeouts, bounded pagination, and bounded retry/backoff for rate limits.
- First check whether the school enables personal access tokens for this account. A personal token, if permitted for this self-owned integration, must be entered through a secure secret-manager/CLI prompt. Never put it in shell command arguments or chat. Account-specific access and expiration must be verified before relying on it.
- If personal tokens are unavailable, investigate school-approved OAuth. A school administrator may need to authorize a developer key. A private calendar subscription may offer reduced due-date functionality, but it does not provide equivalent submission data; evaluate and explain its limitations before choosing it. Do not scrape login sessions or bypass school settings.
- List active student enrollments/courses with pagination. Fetch course assignments including the current student's submission. Use student-effective `due_at`; retain the original timestamp and display dates in America/Chicago with daylight saving handled by the platform date APIs. Do not guess override dates from other students' sections.
- Ignore new assignments without a valid due date. If an existing imported assignment loses its date or disappears, retain it and flag it for review. Treat a failed/partial fetch as a failed sync, never as evidence of removal.
- Key imports by Canvas origin, course ID, and assignment ID. Store name, class, due timestamp, IDs, safe Canvas URL, and narrowly selected submission metadata. Do not store submission bodies, attachments, comments, or grades.
- Update Canvas-owned fields by stable identity. Never overwrite manual assignments. Preserve explicit Daybook completion overrides. A confirmed submission can supply a default completion state; a grade alone, missing data, or `has_submitted_submissions` cannot. The latter refers to any student's submission. Surface resubmission requirements conservatively.
- Keep tombstones for intentionally deleted Canvas imports so a sync does not immediately recreate them. Undo must restore both the assignment and its import eligibility. Missing Canvas records are retained with a status, not silently deleted.
- Record last-successful-sync only after a complete snapshot is atomically saved. Failed requests must preserve the previous snapshot and timestamp. Return fixed, safe errors without raw upstream response bodies or secret values.

## Migration and UI

Preserve the current visual style and manual controls. Add a compact Canvas connection/sync area, a last-successful-sync indicator, and a small Canvas source link on imported assignments. Show failure and stale-data states clearly.

Keep the original localStorage key untouched during migration. Provide local export/import of existing assignments to transfer data between the Pages and connected origins. Validate imported records, merge by IDs, and keep a backup before any format change. Never place migration data in a URL or send it through a public repository. Test existing-record editing so Canvas metadata is not dropped by the current form implementation.

## Verification gates

1. Confirm permitted Canvas authentication, then verify active courses and assignments using a secure server-side connection.
2. Test pagination, origin restrictions, redirects, timeouts, rate limits, invalid responses, timezone boundaries, personalized due dates, and submission semantics with fabricated fixtures.
3. Test deduplication, updates, manual preservation, completion overrides, tombstones/undo, missing records, atomic failed syncs, reload, and migration.
4. Run existing browser workflows and new Canvas workflows on desktop/mobile with fabricated data; never capture live credentials in traces or screenshots.
5. Verify unauthorized backend access is denied, responses are private/non-cacheable, mutations require authenticated same-origin requests, scheduled execution uses secrets server-side, and no secret reaches the browser bundle.
6. Inspect changes and all repository history for secrets before every push. Run all tests, deploy, and verify authenticated live sync plus existing manual functionality before declaring completion.

## References checked

- Canvas assignments: https://canvas.instructure.com/doc/api/assignments.html
- Canvas submissions: https://canvas.instructure.com/doc/api/submissions.html
- Canvas OAuth and manual testing tokens: https://canvas.instructure.com/doc/api/file.oauth.html
- Canvas account token controls: https://community.instructure.com/en/kb/articles/662901-how-do-i-manage-api-access-tokens-in-my-user-account
- Cloudflare Worker secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare Access: https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- Scheduled Workers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/

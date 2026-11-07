# GQX Fit portal

**Version 2.1 UI update:** smaller public introduction, clearer service cards, a two-step enquiry form (preferences → contact details), responsive admin navigation, clickable status counters, compact expandable enquiry rows, readable notification history, and a shorter product editor with optional details collapsed. The database, existing enquiries, credentials and reminder behaviour are preserved. Refresh the browser after updating; restart the server when upgrading from the original version so new static routes are available.

**Version 2:** online training, offline training, apartment training, meal boxes and GQX Fit clothing in one public portal. Start with [PUBLIC-HOSTING.md](PUBLIC-HOSTING.md) for beginner-friendly GitHub → Render instructions and [UPGRADE.md](UPGRADE.md) to restart your working local app safely.

The public form collects service-specific preferences. `/admin` shows these details, service/status filters, search and private team notes. The **Clothing products** tab manages names, descriptions, optional direct HTTPS image links, SKU, INR prices, percentage discounts, sizes, colours, publication visibility and Available/Preorder/Out of stock status. Publish products to display them publicly; no invented products or prices are seeded. Images use external links; image upload is not included.

Clothing enquiries store size, colour, quantity, city/PIN and an immutable product/price snapshot calculated on the server. Changing or hiding a product never deletes earlier enquiries. This is a catalogue and enquiry portal: payment checkout, shipping fulfilment, inventory quantity reservation and confirmed orders are not included. Delivery charges and final availability are confirmed by your team.

Database changes are additive: original enquiries/statuses are preserved. New service fields are stored in `details_json`, team notes in `admin_notes`, and products in a new table. Training forms ask for goals, experience and schedule, apartment forms for community/group details, meal boxes for food preference/plan/delivery locality. Do not ask customers to submit medical data through this enquiry portal.

Deployable, mobile-friendly Instagram bio form and private admin dashboard. Node.js 24 LTS, built-in HTTP/SQLite, no third-party runtime dependencies. Source belongs in your GitHub repository; the live app requires an always-on server with a persistent disk. **GitHub Pages alone cannot run this backend.** No repository, hosting account, or Meta access is assumed or configured for you.

## Included

- Public form at `/`, dashboard at `/admin`, New / Contacted / Done statuses, search, filters and pagination.
- Atomic lead creation plus durable notification outbox. Initial notification is attempted immediately after saving the enquiry; failures never discard the enquiry.
- One follow-up due **168 hours after creation**, checked every minute by the internal scheduler. Contacted remains eligible; only Done closes an enquiry. Restart catches up overdue jobs.
- Meta template notifications, signed inbound webhooks, owner-only closure commands, delivery status events and attempt history.
- Secure password hashing, eight-hour signed HttpOnly/SameSite cookies, same-origin mutation checks, parameterized SQL, response security headers, server validation, honeypot and persistent rate limits.
- Docker, persistent volume, HTTPS proxy example, CI, optional GitHub Actions scheduler, meaningful automated tests.

## Try locally

Install Node.js 24 LTS (24.13 or newer). In this directory:

```sh
cp .env.example .env
npm run hash-password -- "replace with a unique password at least 14 characters"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste the password hash into `ADMIN_PASSWORD_HASH`. Generate **two separate** random values for `SESSION_SECRET` and `CRON_SECRET` (at least 32 characters each). Keep `PUBLIC_URL=http://localhost:3000`, WhatsApp disabled, then:

```sh
npm test
npm start
```

Open `http://localhost:3000`; admin uses the password you hashed. Windows Command Prompt: `copy .env.example .env`. Windows PowerShell: `Copy-Item .env.example .env`; use `npm.cmd` if script policy blocks `npm`. No package installation is needed. Disabled WhatsApp jobs are logged as blocked; enabling WhatsApp and restarting reactivates them for open enquiries.

## Deploy from GitHub

1. Create your own GitHub repository and upload this entire project, including `.github/`. Never upload `.env`, databases or backups. Commit `.env.example` only.
2. Provision an always-on Linux VPS with Docker Compose, a domain, and Caddy (or another HTTPS reverse proxy). Alternatively use a Docker host supporting a persistent `/app/data` disk and one running instance. Ephemeral/serverless disks and sleeping free services are unsuitable for this SQLite setup.
3. Clone your repository on the host. Copy `.env.example` to `.env`, set the password hash and separate strong secrets, and set `PUBLIC_URL=https://enquiries.your-domain.com`. Set WhatsApp fields after the Meta steps below. Restrict `.env` permissions (`chmod 600 .env`).
4. Run `docker compose up -d --build`. The named volume `gqx-data` retains the database across rebuilds. **Do not use `docker compose down -v`** unless intentionally deleting all records.
5. Point DNS to the host. Replace the domain in `Caddyfile` and use it as your host Caddy configuration. Proxy to `localhost:3000`; expose only HTTPS/HTTP publicly, not port 3000. Caddy provisions TLS. Allow ports 80/443 through the firewall.
6. Set edge/proxy rate limits for `/api/enquiries` and `/api/login`. Built-in limits use socket IP and deliberately distrust forwarded headers; behind a proxy they share a quota across users (10 enquiries/hour, 10 login attempts/15 minutes). Configure edge bot protection for a public campaign and adjust the built-in thresholds in `server.mjs` to your expected volume.
7. Verify `/health`, create a real test enquiry, sign into `/admin`, confirm persistence after restart, and verify WhatsApp and reminder delivery as described below. Then put the HTTPS form URL in your Instagram bio.

Run exactly **one app process/replica** on this volume. Worker state recovery assumes exclusive ownership. Do not share the database among multiple app instances or CLI operations while the server runs. For horizontal scaling, migrate to PostgreSQL with transactional row claims and explicit worker leases. HTTPS configuration and persistent-disk backups are deployment responsibilities.

### Scheduling

Recommended: leave `INTERNAL_SCHEDULER=true` with an always-on server and restart policy. Queue polling happens every minute and immediately on startup. Actual notification arrival depends on server uptime and Meta; exact delivery at 168 hours is not guaranteed.

Optional: set `INTERNAL_SCHEDULER=false`, enable the included Actions workflow with repository variable `ENABLE_EXTERNAL_CRON=true`, set `APP_URL` to your HTTPS origin (no trailing path), and add repository **secret** `CRON_SECRET` matching the server. Actions POSTs `/api/cron` hourly at minute 17. The workflow uses no repository checkout or database: it triggers the queue on your live server. A reliable external scheduler can call the same authenticated endpoint every minute instead.

GitHub schedules may be delayed or disabled for inactive public repositories. Do not depend on Actions for a strict timing guarantee. Leave only the chosen scheduling route enabled; duplicate triggers within this single process are harmless. Each run processes at most 20 jobs, so increase cadence/capacity if needed. Initial notifications still start on form submission even when the internal scheduler is off.

## WhatsApp Cloud API setup — required before real notifications

You need Meta developer/API access, an appropriate WhatsApp Business Account, a registered Cloud API sending number, a suitable production access token with messaging permissions, and an eligible recipient. Use a separate owner recipient number; do not set the sending number as its own recipient. Test mode may require adding/verifying the recipient in Meta's dashboard. Production eligibility, billing, token lifetime and account verification depend on your Meta account.

**The owner must opt in to receiving these operational notifications.** Record that consent outside the app before enabling delivery. The enquiry form consent permits GQX to contact the lead about the enquiry; this app only sends WhatsApp notifications to the owner. It does not automatically WhatsApp the lead.

Both notifications use **Meta-approved templates**, including the seven-day notification outside the customer-service conversation window. Submit both templates for review and wait for approval; Meta determines category and eligibility. Set template names and language exactly as approved. Never assume `hello_world` or arbitrary text is suitable for production.

Suggested templates (body only, four positional text parameters in this exact order):

**`gqx_new_enquiry`**

> New GQX enquiry. Reference: {{1}}. Name: {{2}}. Phone: {{3}}. Service: {{4}}. Review the enquiry in your GQX dashboard. To close it, reply with done followed by the reference.

**`gqx_enquiry_reminder`**

> GQX follow-up: enquiry {{1}} is still open after seven days. Name: {{2}}. Phone: {{3}}. Service: {{4}}. Review it in your GQX dashboard. To close it, reply with done followed by the reference.

Provide realistic sample values when submitting: UUID reference, customer name, international phone, service. Do not add header/button parameters without updating the payload builder. Full lead message and email remain in the dashboard and are not sent to Meta by this implementation.

Set `WHATSAPP_ENABLED=true`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_OWNER_NUMBER` (country code and digits only), `WHATSAPP_API_VERSION` (supported version from your app dashboard), both template names and `WHATSAPP_TEMPLATE_LANGUAGE`. Also configure `META_APP_SECRET` and a random `WEBHOOK_VERIFY_TOKEN`. Restart the server. Tokens stay server-side in environment variables, never browser scripts or GitHub source. Rotate expiring/revoked tokens and secrets; rotating the session secret signs out all admins.

### Webhooks and reply detection

Configure the Meta callback URL `https://YOUR_DOMAIN/webhooks/whatsapp`, verify it with `WEBHOOK_VERIFY_TOKEN`, subscribe the app to the WABA and the `messages` webhook field. Incoming POSTs require an `X-Hub-Signature-256` HMAC verified against the **raw request body** with `META_APP_SECRET`. Account phone-number ID and owner sender number must match configuration.

Only these owner messages close an enquiry:

- `done FULL-ENQUIRY-UUID`, `resolved FULL-ENQUIRY-UUID`, or `replied FULL-ENQUIRY-UUID`.
- Reply directly to a notification with exactly `done`, `resolved`, or `replied`; the inbound `context.id` must match the outbound message ID recorded by this app.

Commands are case-insensitive and webhook event IDs deduplicate inbound messages. Unrelated replies do not close enquiries. Lead replies, read receipts and delivery receipts do not count as closure. **The app cannot observe private chats with the lead or your personal WhatsApp conversations. Without working inbound webhooks, use Done in the dashboard.** A correlated reply arriving before the outbound message ID is persisted may not match; use the explicit UUID command in that case.

## Queue and failure guarantees

Each lead has one `new` job and one `reminder` job, protected by a database unique constraint. Lead and jobs are committed together. Job claims are transactional; the worker is serial and concurrent triggers do not send twice. Due time is based on UTC epoch milliseconds, unaffected by local time or daylight saving.

Done cancels pending/retry/blocked/failed/unknown jobs; jobs recheck closure during claim. Reopening never rearms cancelled or sent jobs. A request already in flight when you click Done cannot be recalled, so a notification may arrive after closure if the two events overlap. Already-sent reminders are never scheduled repeatedly.

Meta acceptance is logged with its message ID; **accepted is not delivered**. Status webhooks retain sent/delivered/read/failed events, including provider error codes, in the notification history. Delivery webhook failures are logged without an automatic resend.

An explicit rate-limit rejection (HTTP 429 with Meta error) retries with exponential backoff up to five attempts. Permanent rejection fails for operator review. Network errors, timeouts, 5xx, malformed successful responses and process interruption are **unknown** and are not blindly retried: the message may already have been accepted. Exactly-once delivery across SQLite and an external API cannot be guaranteed. This policy favors preventing duplicate reminders and makes uncertain delivery visible. Disabled integration creates blocked jobs without repeated calls.

Inspect each lead's **Notification history** in the dashboard for jobs, attempts, IDs, error codes and delivery events. Investigate failed/unknown states against Meta first. To requeue a particular failed/unknown/blocked job after fixing its cause, stop the application, run on the database host:

```sh
node --env-file=.env scripts/requeue.mjs JOB_ID --accept-duplicate-risk
```

Then restart. This deliberately accepts potential duplicate delivery for unknown outcomes. Never run the CLI against another/empty database; check `DB_PATH`. Prior logs remain. Closed jobs cannot be requeued. Inside Docker the DB is `/app/data/gqx.db`; maintenance commands require mounting that same volume. Scripts are available in the repository; execute them on a maintenance container/host with Node and the same files and volume, while the app is stopped.

For the included Compose deployment, use:

```sh
docker compose stop app
docker compose run --rm --no-deps app node scripts/requeue.mjs JOB_ID --accept-duplicate-risk
docker compose up -d app
```

## Operations and data

The single admin password is suitable for one owner/team with shared access. Use an identity provider with individual accounts/MFA if separate staff roles are needed. No reset-password email exists; generate a new hash and rotate `SESSION_SECRET` to revoke old sessions. Logout clears the browser cookie; it does not revoke a stolen cookie until expiry or secret rotation.

The database contains contact details, messages, consented submissions, attempt metadata and owner command IDs. No access tokens or full Meta response bodies are stored in logs. Define your privacy notice, business contact details, retention period and deletion process before launch. The supplied consent wording is a starting point; edit it for your business. This version has no self-service data export/deletion UI. Backups also contain personal data and need access controls and retention.

Consistent backup using Node's SQLite backup API (do not copy only a live `.db` file while WAL writes are active):

```sh
node --env-file=.env scripts/backup.mjs /secure-backups/gqx-backup.db
```

The script reads `DB_PATH`. With Docker, use a maintenance container with the same volume and a separate private backup destination; unlike `requeue`, backup uses SQLite's supported online backup API and can run alongside the app. Periodically test restore: stop the app, preserve the old database, restore the backup file to the configured path, remove stale WAL/SHM only while stopped, restore ownership and restart. Encrypt off-host backups. Monitor health, server uptime, disk capacity, blocked/failed/unknown queue states and webhook receipt.

For example, copy a consistent snapshot out of the running Compose container to a private directory on your host:

```sh
docker compose exec app node scripts/backup.mjs /tmp/gqx-backup.db
docker compose cp app:/tmp/gqx-backup.db /secure-backups/gqx-backup.db
```

Move the backup to protected off-host storage. The temporary snapshot contains personal data; remove it or recreate the container after copying.

## Verification

`npm test` exercises seven-day boundary conditions, concurrent triggers, cancellation/reopening, ambiguity handling, provider payloads, admin authentication, CSRF origin checks, webhook signatures and owner-only closure. Tests use temporary/in-memory storage and mocked Meta delivery; they send no WhatsApp messages.

Version 2 also tests service-specific validation, all service submissions, product publication and authentication, server-calculated discount pricing, price snapshot retention, admin notes, hidden/out-of-stock/invalid variants, and migration from the old database schema. On restricted machines that cannot connect to loopback ports, run with `GQX_TEST_IN_PROCESS=true` to test the same route handlers directly. Default/CI mode uses real local HTTP.

Before going live, perform an end-to-end smoke test with your approved templates and owner number: submit form → confirm new notification → check signed delivery webhook → reply `done UUID` → confirm Done and cancelled reminder. For a seven-day test use a **separate test database** and advance its test job due time; never change production lead timestamps. Verify that restart retains the lead and does not resend an accepted notification. Review responsive layout on your actual phone.

## Reference documentation

- [GitHub Pages is static hosting](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Meta template messages](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates)
- [Meta webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks)
- [WhatsApp opt-in guidance](https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in/)
- [Node SQLite](https://nodejs.org/api/sqlite.html)
- [GitHub scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

Meta setup must be checked in your account: documentation access was rate-limited during project preparation. No live Meta message or hosting deployment has been verified by this project generation.

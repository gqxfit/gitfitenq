# Make GQX Fit public: GitHub + Render

This guide uses Render to run the app from your GitHub repository. The public site does not require a customer login; the `/admin` dashboard requires your admin password. Your computer can be switched off after deployment.

**Cost:** this SQLite app needs an always-on web service with a persistent disk. Render offers persistent disks on paid services. Check the current price in its dashboard before creating the service. A free/ephemeral service can lose your enquiries and products; GitHub Pages cannot run this backend. No account or paid service has been created for you.

## 1. Prepare a clean GitHub upload

Use the supplied **gqx-fit-portal.zip** archive. It excludes your local `.env` and customer database. Extract it into a new folder, then upload the source into a private GitHub repository named `gqx-fit-portal`.

`package.json`, `server.mjs`, `public/` and `lib/` should be at the repository root, not inside an extra nested folder. Include `.github/`, `.gitignore`, `.node-version` and `render.yaml` too. GitHub Desktop can publish the whole extracted project reliably, including dotfiles. If copying from your running local folder instead, exclude `.env`, `data/`, backups, `.git/` and `node_modules/`.

## 2. Create fresh production credentials

In Command Prompt, inside your local project folder:

```cmd
npm.cmd run hash-password -- "YOUR-NEW-LONG-PRIVATE-PASSWORD"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep the full password hash and the two different random secrets privately. Use a new password: the earlier one appeared in the chat. Do not put secrets into the GitHub repository.

## 3. Create a Render Web Service

Sign in to [Render](https://dashboard.render.com). Choose **New → Web Service**, connect GitHub, and select your repository. Review the requested GitHub permissions yourself.

Set these values:

| Setting | Value |
| --- | --- |
| Service name | `gqx-fit-portal` (or an available name) |
| Branch | Your main branch |
| Root directory | Leave empty if source is at repository root |
| Runtime / language | Node |
| Build command | `node --version` |
| Start command | `node server.mjs` |
| Instance | An always-on paid instance that supports a persistent disk |
| Instance count | 1 |
| Health check path | `/health` |

There are no third-party dependencies to install. Node version is set by `.node-version` and the environment variable below.

## 4. Add persistent storage before using the portal

In the service's **Disks** section (or Advanced settings during creation), add:

| Setting | Value |
| --- | --- |
| Disk mount path | `/var/data` |
| Size | 1 GB to start, or a size appropriate for your needs |

The database must be written under that mount path. Do not deploy without the disk and then collect real enquiries. Attach it before launch, and keep one instance. Render disk-backed deploys can briefly interrupt the service.

## 5. Add environment variables

In Render's **Environment** section, add:

| Key | Value |
| --- | --- |
| `NODE_VERSION` | `24` |
| `NODE_ENV` | `production` |
| `DB_PATH` | `/var/data/gqx.db` |
| `ADMIN_PASSWORD_HASH` | Your complete generated hash, including the colon |
| `SESSION_SECRET` | First newly generated random secret |
| `CRON_SECRET` | Second newly generated random secret |
| `INTERNAL_SCHEDULER` | `true` |
| `WHATSAPP_ENABLED` | `false` initially |

Do **not** upload your local `.env` file or set `PUBLIC_URL=http://localhost:3000` on Render. The app automatically uses Render's `RENDER_EXTERNAL_URL` when `PUBLIC_URL` is absent. Render supplies the listening `PORT` automatically.

Alternatively, use **New → Blueprint** with the included `render.yaml`; it describes the paid service/disk, generates secrets and asks for your password hash. Review the quoted charges before provisioning. The manual steps above make each choice explicit.

## 6. Deploy and get your public link

Choose the service's create/deploy action. Once the service reports **Live**, open the actual HTTPS `onrender.com` address shown in Render. It will resemble `https://YOUR-SERVICE.onrender.com`.

1. Open the public form.
2. Open the same address with `/admin` at the end.
3. Sign in with your new production password.
4. Add and publish your real clothing products.
5. Submit a test enquiry and confirm its details in admin.
6. Restart the Render service and confirm both the enquiry and products remain. This verifies your database is on the persistent disk.

The new hosted database starts empty. Local test products and enquiries do not automatically upload. Add products on the live dashboard or deliberately migrate your existing database privately using a consistent SQLite backup. Never commit a customer database to GitHub.

## 7. Enable WhatsApp

Follow README.md's Meta setup: API access, separate opted-in owner recipient, approved new-enquiry/reminder templates, access token, phone-number ID, supported Graph version, app secret and webhook verify token.

Add those values in Render's environment settings, set `WHATSAPP_ENABLED=true`, and save/deploy the changes. Configure the Meta callback as:

```text
https://YOUR-ACTUAL-PUBLIC-HOST/webhooks/whatsapp
```

Subscribe the app to your WABA and `messages`. Submit a test enquiry, check the owner's WhatsApp notification, and close it with `done FULL-ENQUIRY-ID`. Confirm Done in admin. Keep the internal scheduler enabled for seven-day reminders. No GitHub Actions schedule is needed with this setup.

## 8. Put the public form in your Instagram bio

Copy the **public HTTPS homepage URL**, not `/admin`, into your Instagram profile link. Open it from your phone on mobile data to confirm it works outside your computer. You can link directly to clothing with `/#clothing` or the form with `/#enquire`.

For a custom domain, add it in Render's domain settings and follow the displayed DNS instructions. After HTTPS works on the custom domain, set `PUBLIC_URL=https://YOUR-CUSTOM-DOMAIN` in Render and save/deploy. Use that one address for the site, admin and Meta callback; the mutation checks require the configured origin. Old hostnames should redirect to the canonical domain.

## 9. Keep records safe

Keep the disk attached, maintain private off-host SQLite backups, and test a restore. Monitor the dashboard's notification history for blocked, failed or unknown sends. Configure suitable public rate limits/bot protection before a large campaign: the built-in form quota uses socket IP and can be shared behind a reverse proxy (see README.md). Never publish your admin password or Meta credentials.

Reference: [Render web services](https://render.com/docs/web-services), [persistent disks](https://render.com/docs/disks), [environment variables](https://render.com/docs/configure-environment-variables), [Node versions](https://render.com/docs/node-version). Dashboard labels can change; follow the equivalent current setting.

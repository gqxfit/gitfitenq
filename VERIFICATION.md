# Verification record

- Version 2 automated suite: **14 tests passed**, run locally on Node.js v26.13.0 on Windows, with `GQX_TEST_IN_PROCESS=true` because loopback TCP connections are blocked by the execution environment.
- Tests cover seven-day eligibility, one-time reminders, closure/reopening, owner command correlation, concurrent triggers, retry cap, ambiguous sends, disk persistence, interrupted-send recovery, template payload, admin login, origin checks and signed HTTP webhooks.
- Meta API mocked; no real notifications sent.
- New tests cover all GQX Fit services, product validation and authenticated creation/update/publication, discount rounding, price snapshots, hidden/out-of-stock/invalid-variant rejection, team notes, service filters, legacy database migration, Render origin fallback and public asset routes.
- Route tests invoked the actual server request handlers directly with readable request streams. Default test/CI mode retains real local HTTP and has not been rerun with real TCP for this version.
- CI is configured for Node.js 24 LTS; that CI run will occur after uploading the repository.
- Docker/Render deployment, HTTPS/DNS, Meta templates and actual webhook subscriptions have not been exercised here.
- Version 2.1 browser verification succeeded after the user restarted the previously outdated local server. Checked public landing page and desktop admin, the training preferences → contact step and back navigation (values preserved), enquiry expand/collapse, product navigation and add-product editor. Also checked the public page and admin/product editor at a 390×844 phone viewport. No enquiries were submitted, products saved, or customer records changed during these checks.
- No GitHub repository was created or modified; no deployment was performed. All source and deployment instructions are included for review and use.

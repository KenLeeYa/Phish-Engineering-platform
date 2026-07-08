# AGENTS.md

This repository is being adapted from upstream Gophish into an enterprise Chinese security awareness platform. Agents working here must keep the platform strictly focused on authorized training, measurable learning outcomes, and defensive governance.

## Project Rules

- Treat this codebase as a security-awareness training platform, not an offensive phishing kit.
- Preserve upstream runtime behavior unless the user explicitly asks for a behavioral change.
- Keep changes small, reviewable, and tied to a clear enterprise-control outcome.
- Prefer existing Go, JavaScript, template, and migration patterns already present in the repository.
- Cite concrete files and modules in architecture or planning documents when making claims about the current system.
- Use Traditional Chinese for Chinese-facing product, governance, and documentation content unless a file is clearly English-only.
- Do not add dependencies, services, or network calls without a documented reason and validation plan.
- Do not run destructive commands. Never delete, reset, or overwrite user work unless explicitly instructed.

## Safety Boundaries

- Authorized training only: every campaign concept must assume written approval, defined scope, and known business owner.
- No credential theft: do not build, document, or test flows intended to collect real passwords, session tokens, one-time passwords, recovery codes, or secret answers.
- No real password storage: any future credential-related UI must use safe placeholders, masked educational signals, or non-sensitive form submission events.
- Safe landing pages: landing pages must avoid impersonating production authentication systems in ways that collect secrets or mislead beyond the approved training objective.
- Mail delivery governance: sending must be rate-limited, domain-scoped, approved, observable, and stoppable.
- Data protection: recipient lists, campaign events, IP addresses, user agents, reports, and webhook payloads are sensitive training telemetry and must be minimized and protected.
- Reporting governance: dashboards and exports must avoid shaming individuals; aggregate and role-scoped reporting is preferred.
- Integrations must fail closed for approval, audit, identity, mail, and data-loss controls.

## Engineering Standards

- Read the relevant existing modules before editing.
- For Go code, follow the local package layout and run targeted tests for touched packages.
- For frontend code, update source files under `static/js/src/app/` and generated assets only when the build workflow requires it.
- For database changes, add paired SQLite and MySQL migrations under `db/db_sqlite3/migrations/` and `db/db_mysql/migrations/`.
- For authentication, authorization, approval, audit, and delivery controls, add tests that cover denial paths as well as success paths.
- For documentation-only PRs, verify the working tree and review the diff before committing.
- Do not weaken existing safeguards such as CSRF handling, TLS settings, API-key checks, RBAC checks, or security headers.

## Current Safety-Sensitive Areas

- `controllers/phish.go` handles tracking, landing page rendering, report handling, and submitted-form events.
- `models/page.go` controls landing page HTML parsing and the `capture_credentials` / `capture_passwords` flags.
- `models/result.go` stores campaign result status, recipient event details, IP address, geolocation, and reported-email state.
- `models/campaign.go` creates campaigns, result rows, mail logs, timeline events, and webhook fan-out.
- `models/smtp.go`, `models/maillog.go`, `mailer/mailer.go`, and `worker/worker.go` govern mail delivery.
- `models/rbac.go`, `models/user.go`, `middleware/middleware.go`, and `controllers/api/user.go` govern roles, permissions, sessions, and API access.
- `webhook/webhook.go` and `controllers/api/webhook.go` govern outbound event integrations.

## Definition of Done

- The change is scoped to the requested PR objective.
- Runtime behavior is unchanged unless the request explicitly includes behavior changes.
- Safety boundaries are preserved and called out when relevant.
- Relevant files, tests, and docs are updated together.
- The diff has been reviewed locally before staging.
- Validation is documented in the final response.
- The next recommended PR is identified when the work is part of a phased modernization effort.

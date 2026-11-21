# PlayPulse Completion Report

## Demo data

The demo seed creates:

- Admin and member accounts
- Multiple membership tiers
- Membership renewal history
- Demo courts and a court booking
- Shop products
- A shop order
- Cafeteria menu and tables
- An open tab and cafeteria order
- Staff profiles, shifts, and leave requests
- Enquiries
- Expenses
- A business invoice

Run `npm run db:seed`.

## OpenAPI

- Swagger UI: `/api/v1/docs/`
- OpenAPI 3.1 JSON: `/api/v1/openapi.json`

## Database concurrency tests

The test suite contains optional PostgreSQL tests for:

- Concurrent court reservations
- Concurrent stock deductions
- Duplicate payment idempotency keys
- Migration and core table integrity

They execute automatically when `DATABASE_URL` is configured.

## Monitoring

- Prometheus metrics: `/metrics`
- Database latency measurement
- HTTP success/failure counters
- Slow-query event recording
- Backup status recording
- Structured Pino logs

Third-party APM and log aggregation remain optional external integrations.

## Export and reporting

Exports support CSV, XLSX, and PDF. Report types include performance, invoices, and tax estimates.

## Notifications

The notification subsystem includes an outbox, in-app delivery, membership-expiry reminders, low-stock reminders, booking notifications, payment receipts, cancellation notifications, and external-provider status boundaries. Real email/SMS delivery requires a provider credential and transport adapter.

## React frontend integration status

The React/Vite frontend is built and served by Express. Its current Admin workspace reads and writes
the versioned `shared_demo_state` JSON document, and public booking uses that same snapshot. This is
PostgreSQL-backed demo synchronization, but it does not make the React screens use the normalized
membership, court, shop, cafeteria, staff, and finance tables.

The UI's demo sign-in also uses `/api/v1/auth/demo-login` and a UI session cookie, while normalized
domain APIs require the JWT returned by `/api/v1/auth/login`. The React app does not currently use
that JWT authentication flow. Therefore the React demo experience works with shared snapshot data,
but full frontend integration with the relational domain APIs is still pending.

Remaining integration work:

- Connect React sign-in/session lifecycle to database-backed accounts and JWT authentication.
- Replace demo-snapshot reads and writes with typed, permission-checked domain API calls.
- Add any missing domain read/list operations required by the existing screens.
- Verify cross-client updates for normalized domain changes, not only snapshot changes.
- Add PostgreSQL concurrency tests for simultaneous membership renewals and daily session limits.

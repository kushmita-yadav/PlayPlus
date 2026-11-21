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

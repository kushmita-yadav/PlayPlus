# Checkpoint 9 Quality and Security Report

## Validation scope

The checkpoint suite covers:

- Health and readiness behavior
- API response consistency
- Invalid JSON and malformed bearer tokens
- Privileged route authentication
- Junior and booking interval business rules
- Membership discount and stock workflow boundaries
- Shop and cafeteria authorization
- Public enquiry behavior
- Lead and leave authorization
- Team balancing
- TypeScript, lint, build, and dependency audits

## Database integration boundaries

Concurrency and real database integrity require a configured hosted PostgreSQL instance. The repository migration suite provides:

- PostgreSQL exclusion constraints for overlapping court reservations
- Row locks and transaction limits for court and member bookings
- Row locks for shop stock and payment transactions
- Unique idempotency constraints for reservations and orders
- Foreign keys, check constraints, and restricted deletions for historical records

These database tests are intended to run against a disposable PostgreSQL database in CI or a separate integration environment. No destructive reset is used.

## Security findings

- JWT secrets are read from environment variables.
- No production credentials are stored in source files.
- Passwords are hashed with bcrypt.
- Admin roles cannot be self-assigned through public registration.
- Privileged endpoints require both authentication and permission checks.
- Helmet and request size limits protect the HTTP surface.
- Input is validated with Zod.
- Internal stack traces are not returned to clients.
- Payment endpoints record payment methods rather than pretending to call a payment processor.

# PlayPulse

PlayPulse is a backend-first management platform for the Champions Club sports club.

## Challenge vertical

This project implements the Sports Club Management System vertical described in the supplied challenge brief. It keeps clubs, members, courts, shop inventory, cafeteria operations, enquiries, staff, and finance in one API-first system.

## Architecture

The system uses a modular monolith:

- Express 5 REST API with `/api/v1` versioning
- PostgreSQL for persistent relational data
- Zod request validation
- JWT bearer authentication and RBAC permissions
- Pino structured logging
- PostgreSQL transactions, row locks, idempotency keys, exclusions, and indexes
- Render Blueprint deployment

The implementation is organized around authentication, memberships, courts, shop, cafeteria, operations, finance, and assistant boundaries.

Development follows the documented 24-hour backend checkpoint sequence. Frontend work starts only after the backend checkpoints are complete.

## Quality commands

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```

## Database setup

Set `DATABASE_URL` to a PostgreSQL connection string before starting the API or running migrations.

```powershell
npm.cmd run migrate
npm.cmd start
```

The migration runner creates `schema_migrations`, then applies versioned SQL files exactly once. Deployment does not reset or destroy existing data.

### Render

The repository includes a Render Blueprint at [render.yaml](render.yaml). It creates:

- A Node Web Service named `playpulse-api`
- A PostgreSQL database named `playpulse-db`
- A generated `JWT_SECRET`
- A linked `DATABASE_URL`

Deploy the Blueprint from the Render dashboard and connect the GitHub repository. The web start command runs versioned migrations before starting the API.

After deployment, verify:

- `GET /health` returns HTTP 200
- `GET /ready` returns HTTP 200 only when PostgreSQL is reachable
- `GET /api/v1` returns API metadata

## API usage

### Register a member

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "member@example.com",
  "password": "A-long-safe-password",
  "fullName": "Test Member"
}
```

Public registration always creates a `member` account. Administrative roles must be assigned securely by an existing administrator.

### Login

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "member@example.com",
  "password": "A-long-safe-password"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "accessToken": "<JWT>",
    "expiresIn": "8h"
  }
}
```

Send protected requests with:

```http
Authorization: Bearer <JWT>
```

### Public enquiry

```http
POST /api/v1/public/enquiries
Content-Type: application/json

{
  "name": "New Visitor",
  "phone": "9876543210",
  "interest": "Trial tennis session"
}
```

### Representative workflows

- `GET /api/v1/memberships/plans`
- `GET /api/v1/courts/availability?date=2026-11-21`
- `POST /api/v1/courts/reservations`
- `GET /api/v1/shop/products`
- `POST /api/v1/shop/orders`
- `POST /api/v1/cafeteria/orders`
- `POST /api/v1/cafeteria/tabs/:tabId/settle`
- `GET /api/v1/reports/performance?from=2026-11-01&to=2026-11-30`
- `POST /api/v1/assistant/query`

Use `Idempotency-Key` headers for court reservations, shop orders, and payments where supported.

## Security

- Passwords use bcrypt.
- JWT tokens expire after eight hours.
- Privileged endpoints require role and permission checks.
- Public registration cannot assign administrator or staff roles.
- Zod validates external input.
- Helmet adds security headers.
- Request bodies are limited to 1 MB.
- API traffic is rate-limited.
- Internal stack traces are excluded from client responses.
- Production secrets come from environment variables.
- Reported payment methods are recorded; no gateway processing is simulated.

## Decision logic

The smart assistant uses explainable, deterministic intent identification and recommendations. Court and inventory answers come from database state. Matchmaking uses sport preference and skill difference to calculate compatibility. Team balancing assigns sorted players to the currently lighter team. Cancellation recovery searches for alternative courts without an overlapping confirmed reservation.

## Assumptions

- Court sessions last 60 minutes and start every 30 minutes.
- Members may hold at most two confirmed sessions per day.
- A Junior membership is valid below age 18.
- Friday social-play times are configurable because the source brief gives no exact hours.
- Membership, court, shop, and bar discounts are configurable seed values.
- Tax remains a recorded/configurable estimate; statutory filing is an external integration.
- Payroll summaries are internal estimates; regulated payroll remittance is external.
- Real payment gateway settlement is not claimed.

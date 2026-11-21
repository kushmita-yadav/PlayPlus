# PlayPulse — Intelligent Sports Club Management System

**PlayPulse** is an API-first, backend management platform designed for **The Champions Club**, a modern tennis, padel, badminton, and cricket club.

The project replaces fragmented operational processes such as WhatsApp court bookings, Excel member records, paper cafeteria receipts, and disconnected financial reporting with one structured and secure software backend.

> **Project status:** Backend implementation is complete through Checkpoints 0–9. Checkpoint 10 deployment configuration is complete, but live Render verification requires external account access. Checkpoint 11 submission documentation is complete.


## Why PlayPulse?

Sports clubs need to manage many connected activities in real time:

- Members and membership plans
- Court reservations and availability
- Product inventory and shop orders
- Cafeteria tables, customer tabs, and kitchen status
- Enquiries and trial sessions
- Staff shifts and leave
- Expenses, invoices, payroll, taxes, and reporting

Using WhatsApp, paper receipts, spreadsheets, and telephone calls makes these processes slow and unreliable. PlayPulse provides a shared data model and REST API so a future website or mobile application can operate consistently across every department.

The backend is intended to be a strong foundation for a club management platform, rather than a demonstration-only interface.

---

## Challenge and Business Goals

The Champions Club currently faces:

- Court reservations managed through WhatsApp
- Member records maintained in Excel
- Cafeteria receipts written on paper
- Court availability checked by phone
- No consolidated view of revenue or operations

PlayPulse addresses these problems through domain-specific APIs for:

1. Membership management
2. Sports court and facility management
3. Sports shop and inventory
4. Cafeteria and bar operations
5. Public enquiries and trials
6. Staff and administration
7. Finance and reporting

---

## What the System Covers

### Membership Management

- Gold, Silver, and Junior membership plans
- Configurable prices and benefits
- Member registration
- Membership renewal
- Plan upgrades and downgrades
- Membership history
- Expiry calculations
- Expiry alerts
- Court, shop, and cafeteria benefits
- Junior age eligibility validation

### Court and Facility Management

- Tennis, padel, badminton, and cricket sports
- Multiple configurable courts
- 60-minute reservations
- 30-minute booking start intervals
- Public availability queries
- Member and walk-in reservations
- Social-play participants
- A maximum of two confirmed sessions per member per day
- Membership-based court prices and discounts
- Cancellation
- Idempotent retries
- Database-level prevention of overlapping reservations

### Sports Shop and Inventory

- Product catalog
- Categories and SKUs
- Product prices
- Current inventory
- Low-stock thresholds
- Stock additions and adjustments
- Counter and online orders
- Pickup and delivery fulfillment
- Membership discounts
- Stock restoration on cancellation
- Atomic inventory deductions
- Order and payment idempotency

### Cafeteria and Bar

- Menu management
- Table management
- Member and guest tabs
- Order placement
- Kitchen preparation statuses
- Member discounts
- Cash, card, and UPI payment recording
- Tab settlement
- Daily revenue by payment method

### Enquiries and Trials

- Public enquiry creation
- Lead follow-up tracking
- Lead status management
- Quotations
- Lead-to-member conversion
- Trial and membership interest capture

### Staff and Administration

- Staff records
- Role-based permissions
- Staff shifts
- Leave requests
- Leave approval and rejection
- Staff profiles and departments

### Finance

- Court revenue
- Membership revenue records
- Shop revenue
- Cafeteria revenue
- Expenses
- Business invoices
- Invoice items
- Payroll estimates and liabilities
- Tax-related fields
- Configurable tax estimates
- Period performance reports

### Intelligent Assistant

- Rule-based intent identification
- Permission-aware data context
- Court availability recommendations
- Low-stock recommendations
- Financial summary access
- Matchmaking
- Compatibility scoring
- Balanced team generation
- Cancellation recovery
- Explainable decisions
- Confirmed-action audit history

The assistant is deliberately grounded in real club data and deterministic rules. It does not claim to perform external AI actions or modify records without authorization.

---

## How It Works

At a high level:

1. A client sends an HTTP request to a versioned endpoint.
2. Express receives and normalizes the request.
3. Helmet, CORS, rate limiting, body limits, and request tracing are applied.
4. Zod validates request input.
5. JWT middleware verifies protected requests.
6. Permission middleware checks role-specific access.
7. Route handlers invoke PostgreSQL operations.
8. Transactions and locks protect operations that change multiple records.
9. A consistent JSON success or error response is returned.

Example flow:

```text
Client
  -> REST endpoint
  -> Authentication
  -> Permission check
  -> Zod validation
  -> PostgreSQL transaction
  -> JSON response
```

---

## Technical Stack

### Runtime

| Technology | Purpose |
|---|---|
| Node.js 20+ | JavaScript runtime |
| TypeScript | Static typing and safer backend code |
| Express 5 | HTTP server and REST routing |

### Database

| Technology | Purpose |
|---|---|
| PostgreSQL | Persistent relational database |
| `pg` | PostgreSQL connection pool and query API |
| Versioned SQL migrations | Controlled schema evolution |

### Authentication and Security

| Technology | Purpose |
|---|---|
| JSON Web Tokens | Stateless API authentication |
| bcrypt | Password hashing |
| Helmet | HTTP security headers |
| CORS | Cross-origin configuration |
| Express Rate Limit | API request throttling |

### Validation and Logging

| Technology | Purpose |
|---|---|
| Zod | Runtime input validation |
| Pino | Structured JSON logging |
| dotenv | Local environment loading |

### Testing and Quality

| Technology | Purpose |
|---|---|
| Node test runner | Unit and API tests |
| Supertest | HTTP integration tests |
| TypeScript compiler | Type checking |
| ESLint | Static linting |
| npm audit | Production dependency review |

### Deployment

| Technology | Purpose |
|---|---|
| Render Blueprint | Web service and PostgreSQL provisioning |
| GitHub Actions | Automated quality checks |
| GitHub | Source control and checkpoint commits |

---

## Architecture

PlayPulse uses a **modular monolith**. It is deployed as one service but organized into clearly separated domains.

```text
src/
├── app.ts                 HTTP application setup
├── server.ts              Server startup and graceful shutdown
├── config/                Environment configuration
├── auth/                  Accounts, JWT, roles, and permissions
├── memberships/           Membership plans and member histories
├── courts/                Sports, courts, availability, and reservations
├── shop/                  Products, stock, and shop orders
├── cafeteria/             Menu, tables, tabs, orders, and payments
├── operations/            Enquiries, staff, leave, quotes, and finance
├── assistant/             Deterministic recommendations and matchmaking
├── database/              PostgreSQL pool and migration runner
└── middleware/            Central errors and HTTP handling
```

The database is equally modular and contains migrations for:

- Authentication and permissions
- Membership plans and records
- Sports and court reservations
- Shop inventory and sales
- Cafeteria and bar operations
- Enquiries, staff, and finance
- Matchmaking and assistant history

Core cross-cutting requirements include:

- Centralized error responses
- UTC timestamps
- Configurable club timezone
- Foreign keys
- Check constraints
- Unique constraints
- Indexes
- Transactional updates
- Restricted historical deletion
- Idempotency for retries

---

## Project Structure

```text
.
├── .github/workflows/ci.yml
├── docs/
│   ├── api-sample-responses.md
│   ├── checkpoint-tracker.md
│   ├── checkpoint-9-report.md
│   ├── requirements-traceability.md
│   └── submission-checklist.md
├── migrations/
│   ├── 001_initial_health_and_audit.sql
│   ├── 002_authentication.sql
│   ├── 003_memberships.sql
│   ├── 004_courts.sql
│   ├── 005_shop_inventory.sql
│   ├── 006_cafeteria.sql
│   ├── 007_enquiries_staff_finance.sql
│   └── 008_assistant_matchmaking.sql
├── src/
├── test/
├── .env.example
├── eslint.config.js
├── package.json
├── render.yaml
└── tsconfig.json
```

---

## Prerequisites

Install the following before running locally:

- Node.js 20 or newer
- npm
- PostgreSQL 14 or newer
- Git
- A terminal such as PowerShell

Confirm the tools:

```powershell
node --version
npm.cmd --version
git --version
```

---

## Quick Start

### Run the React frontend

The client is a React + TypeScript application built with Vite. Its development server proxies API
requests and live event streams to the Express API. Configure PostgreSQL and the required values
from `.env.example` before using shared data and sign-in.

Frontend source is grouped by responsibility under `frontend/src`: `app` contains the React entry
point, `data` contains the demo snapshot, `lib` contains shared API and booking utilities, `types`
contains shared client types, and `styles` contains global styles.

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:5173` for the React interface. The API remains available at
`http://localhost:3000` by default. For the built, Express-served application:

```powershell
npm.cmd run build
npm.cmd start
```

Then open `http://localhost:3000`. Backend health and API documentation are available at
`http://localhost:3000/health` and `http://localhost:3000/api/v1/docs/`.

### Demo accounts

| Experience | Email | Password |
|---|---|---|
| Admin dashboard | `admin@champions.club` | `Admin@123` |
| Member/Player portal | `member@champions.club` | `Member@123` |
| Visitor | No login required | Continue as Visitor |

Portal URLs:

- `http://localhost:3000/admin` — Admin management experience
- `http://localhost:3000/portal?mode=member` — Signed-in member experience
- `http://localhost:3000/visitor` — Public visitor experience

The React interface currently provides:

- Role-aware admin/manager workspaces, member portal, and visitor catalog
- Shared dashboard, records for club operations, staff leave review, and basic record creation
- Date-aware court availability and transactional bookings
- Live PostgreSQL-backed updates through Server-Sent Events
- Demo account sign-in, session restoration, account switching, and logout

### Real-time data synchronization

To share admin changes across signed-in sessions and synchronize court availability in the
visitor/member portal, configure `DATABASE_URL` in the local `.env`, then run:

```powershell
npm.cmd run migrate
npm.cmd run dev
```

The local development database must be PostgreSQL with UTF-8 encoding. Keep its connection
string in the ignored `.env` file and never commit credentials. On the configured development
machine, PlayPulse uses a dedicated PostgreSQL cluster at
`%LOCALAPPDATA%\PlayPulse\PostgreSQL` on `127.0.0.1:5433`; it is separate from the Odoo
database. Keep that local cluster running while the app is running. Verify the connection at
`http://localhost:3000/ready`; it should return `200` with `"status":"ready"`.

The admin dashboard stores its demo dataset in PostgreSQL with optimistic version checks.
Database notifications stream changes to connected admin/manager dashboards and public
availability/catalog views. Concurrent edits that use an outdated version are rejected and
the latest state is reloaded instead of silently overwriting another user's changes.
The UI shows the last sync time and retries transient database outages automatically. If
PostgreSQL is not configured, it clearly reports local-only demo mode; those edits do not sync
across devices.

The visitor/member API projection includes court availability, catalog and plan data. For a
signed-in demo member it additionally includes only that member's own profile, bookings, and
orders. The sample member account is currently mapped to demo member `M-1001`.

Clone the repository:

```powershell
git clone https://github.com/kushmita-yadav/PlayPlus.git
cd PlayPlus
```

Install dependencies:

```powershell
npm.cmd install
```

Create local environment settings:

```powershell
Copy-Item .env.example .env
```

Update `.env` with a real PostgreSQL URL and JWT secret.

Apply migrations:

```powershell
npm.cmd run migrate
```

Seed demonstration data after migrations:

```powershell
npm.cmd run db:seed
```

Start development mode:

```powershell
npm.cmd run dev
```

The API will listen on `http://localhost:3000` unless another port is configured.

Useful health checks:

```text
GET http://localhost:3000/health
GET http://localhost:3000/ready
GET http://localhost:3000/api/v1
```

---

## Environment Configuration

Use `.env.example` as a template.

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `NODE_ENV` | No | `development` | Execution mode |
| `PORT` | No | `3000` | HTTP port |
| `DATABASE_URL` | Yes for database operations | None | PostgreSQL connection string |
| `JWT_SECRET` | Yes for authentication | None | JWT signing and verification secret |
| `CLUB_TIMEZONE` | No | `Asia/Kolkata` | Club business timezone |
| `LOG_LEVEL` | No | `info` | Pino log level |

Example local PostgreSQL URL:

```text
DATABASE_URL=postgresql://postgres:password@localhost:5432/playpulse
```

Example JWT secret format:

```text
JWT_SECRET=use-a-long-random-secret-with-at-least-32-characters
```

Never commit `.env` or real credentials. The repository `.gitignore` excludes `.env` and local environment files.

---

## Database Setup and Migrations

The PostgreSQL migration runner:

1. Creates a `schema_migrations` table.
2. Reads SQL files from `migrations/`.
3. Sorts migration names.
4. Applies each migration once.
5. Records successful migration names.
6. Rolls back failed migration transactions.

Run migrations:

```powershell
npm.cmd run migrate
```

Compile and run migrations in a production build:

```powershell
npm.cmd run build
npm.cmd run migrate:deploy
```

Do not run destructive database reset commands. The migration system is designed to preserve existing data and apply additions safely.

For a fresh local database:

```sql
CREATE DATABASE playpulse;
```

---

## Running the Application

### Development

```powershell
npm.cmd run dev
```

### Type Check

```powershell
npm.cmd run check
```

### Tests

```powershell
npm.cmd test
```

### Lint

```powershell
npm.cmd run lint
```

### Production Build

```powershell
npm.cmd run build
npm.cmd start
```

### Complete Local Quality Gate

```powershell
npm.cmd run quality
```

### Dependency Security Audit

```powershell
npm.cmd run security:audit
```

### Demo Data

```powershell
npm.cmd run db:seed
```

Seed credentials are only for local demonstration:

- Admin: `admin@champions.local`
- Member: `member@champions.local`
- Password: `DemoPassword123!`

### Database Backup and Restore

`pg_dump` and `pg_restore` must be installed and available in `PATH`.

```powershell
npm.cmd run db:backup
npm.cmd run db:restore -- backups/playpulse-2026-01-01T00-00-00.dump
```

The restore command uses `--clean --if-exists`. Verify and authorize the target database before restoring.

---

## API Guide

Interactive API documentation is available at:

```text
/api/v1/docs/
```

The machine-readable OpenAPI 3.1 document is available at:

```text
/api/v1/openapi.json
```

All versioned application endpoints begin with `/api/v1`.

### Health and API Metadata

| Method | Endpoint | Authentication | Purpose |
|---|---|---|---|
| GET | `/health` | No | Process health |
| GET | `/ready` | No | Database readiness |
| GET | `/api/v1` | No | API metadata |

### Authentication

| Method | Endpoint | Authentication | Purpose |
|---|---|---|---|
| POST | `/api/v1/auth/register` | No | Create a member account |
| POST | `/api/v1/auth/login` | No | Obtain a JWT |
| GET | `/api/v1/auth/me` | Yes | Read current account context |

### Memberships

| Method | Endpoint | Authentication | Purpose |
|---|---|---|---|
| GET | `/api/v1/memberships/plans` | No | List active plans |
| POST | `/api/v1/memberships/plans` | Manager/Admin | Create or configure a plan |
| POST | `/api/v1/memberships/members` | Front desk or higher | Register a member |
| POST | `/api/v1/memberships/members/:memberId/renew` | Manager/Admin | Renew or change plan |
| GET | `/api/v1/memberships/members/:memberId/history` | Staff permission | View membership history |
| GET | `/api/v1/memberships/members/:memberId/benefits` | Staff permission | Calculate active benefits |
| GET | `/api/v1/memberships/alerts/expiring` | Staff permission | Find expiring memberships |

### Courts

| Method | Endpoint | Authentication | Purpose |
|---|---|---|---|
| GET | `/api/v1/courts/sports` | No | List sports |
| GET | `/api/v1/courts` | Court staff | List courts |
| POST | `/api/v1/courts` | Court staff | Create a court |
| PUT | `/api/v1/courts/:courtId/schedule` | Court staff | Configure schedule |
| GET | `/api/v1/courts/availability?date=YYYY-MM-DD` | No | Check availability |
| POST | `/api/v1/courts/reservations` | Court staff | Create reservation |
| POST | `/api/v1/courts/reservations/:reservationId/cancel` | Court staff | Cancel reservation |

### Shop

| Method | Endpoint | Authentication | Purpose |
|---|---|---|---|
| GET | `/api/v1/shop/products` | No | View catalog |
| POST | `/api/v1/shop/products` | Shop manager | Add a product |
| POST | `/api/v1/shop/products/:productId/stock` | Shop manager | Add or adjust stock |
| GET | `/api/v1/shop/low-stock` | Shop manager | List low-stock products |
| POST | `/api/v1/shop/orders` | Shop staff | Create counter or online order |
| POST | `/api/v1/shop/orders/:orderId/fulfill` | Shop staff | Mark pickup/delivery fulfilled |
| POST | `/api/v1/shop/orders/:orderId/cancel` | Shop staff | Cancel and restore stock |

### Cafeteria and Bar

| Method | Endpoint | Authentication | Purpose |
|---|---|---|---|
| GET | `/api/v1/cafeteria/menu` | No | View menu |
| POST | `/api/v1/cafeteria/menu` | Bar staff | Add menu item |
| GET | `/api/v1/cafeteria/tables` | Bar staff | View tables |
| POST | `/api/v1/cafeteria/tables` | Bar staff | Add a table |
| POST | `/api/v1/cafeteria/tabs` | Bar staff | Open a customer tab |
| POST | `/api/v1/cafeteria/orders` | Bar staff | Place an order |
| PATCH | `/api/v1/cafeteria/orders/:orderId/status` | Bar staff | Update kitchen status |
| POST | `/api/v1/cafeteria/tabs/:tabId/settle` | Bar staff | Record settlement |
| GET | `/api/v1/cafeteria/revenue/daily` | Finance staff | Daily bar revenue |

### Enquiries, Staff, and Finance

| Method | Endpoint | Authentication | Purpose |
|---|---|---|---|
| POST | `/api/v1/public/enquiries` | No | Public lead creation |
| GET | `/api/v1/enquiries` | Staff/Manager | List enquiries |
| PATCH | `/api/v1/enquiries/:enquiryId` | Staff/Manager | Update lead status |
| POST | `/api/v1/enquiries/:enquiryId/followups` | Staff/Manager | Add follow-up |
| POST | `/api/v1/quotations` | Staff/Manager | Create quotation |
| PATCH | `/api/v1/quotations/:quotationId/status` | Staff/Manager | Update quotation |
| POST | `/api/v1/staff` | Manager/Admin | Create staff profile |
| POST | `/api/v1/staff/:staffId/shifts` | Manager/Admin | Schedule shift |
| POST | `/api/v1/staff/:staffId/leave` | Authenticated staff | Request leave |
| PATCH | `/api/v1/leave/:leaveId` | Manager/Admin | Approve or reject leave |
| POST | `/api/v1/expenses` | Finance manager | Record expense |
| POST | `/api/v1/invoices` | Finance manager | Create business invoice |
| POST | `/api/v1/payroll` | Staff manager | Create payroll record |
| GET | `/api/v1/reports/performance` | Finance reader | Period performance |

### Assistant

| Method | Endpoint | Authentication | Purpose |
|---|---|---|---|
| POST | `/api/v1/assistant/query` | Yes | Identify intent and retrieve recommendations |
| POST | `/api/v1/assistant/matchmaking` | Member/Admin | Create matchmaking request |
| POST | `/api/v1/assistant/balance-teams` | Yes | Generate balanced teams |
| GET | `/api/v1/assistant/cancellation-recovery/:reservationId` | Yes | Find alternative courts |
| POST | `/api/v1/assistant/confirm` | Yes | Confirm and audit an action |

Additional operational endpoints include:

- `GET /metrics`
- `GET /api/v1/reports/export`
- `GET /api/v1/notifications`
- `POST /api/v1/notifications`
- `POST /api/v1/notifications/process`
- `POST /api/v1/notifications/generate-reminders`
- `POST /api/v1/observability/slow-queries`
- `GET /api/v1/observability/backups`

---

## Example API Requests

### Register a Member

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "member@example.com",
  "password": "A-long-safe-password",
  "fullName": "Test Member"
}
```

Public registration creates a `member` account only. A public caller cannot self-register as an admin, manager, or staff role.

### Log In

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "member@example.com",
  "password": "A-long-safe-password"
}
```

Example success response:

```json
{
  "success": true,
  "data": {
    "accessToken": "<JWT>",
    "expiresIn": "8h",
    "user": {
      "id": "<account-id>",
      "email": "member@example.com",
      "role": "member",
      "permissions": []
    }
  }
}
```

### Send an Authenticated Request

```http
Authorization: Bearer <JWT>
Content-Type: application/json
```

### Create a Public Enquiry

```http
POST /api/v1/public/enquiries
Content-Type: application/json

{
  "name": "New Visitor",
  "phone": "9876543210",
  "email": "visitor@example.com",
  "interest": "Trial tennis session"
}
```

### Create a Court Reservation

```http
POST /api/v1/courts/reservations
Authorization: Bearer <JWT>
Idempotency-Key: booking-20261121-001
Content-Type: application/json

{
  "courtId": "<court-uuid>",
  "memberId": "<member-uuid>",
  "startsAt": "2026-11-21T18:30:00.000Z",
  "bookingType": "individual"
}
```

### Create a Shop Order

```http
POST /api/v1/shop/orders
Authorization: Bearer <JWT>
Idempotency-Key: shop-order-001
Content-Type: application/json

{
  "memberId": "<member-uuid>",
  "channel": "counter",
  "fulfillment": "pickup",
  "paymentMethod": "upi",
  "items": [
    {
      "productId": "<product-uuid>",
      "quantity": 1
    }
  ]
}
```

More response examples are available in [API sample responses](docs/api-sample-responses.md).

---

## Authentication and Authorization

### Roles

The initial role model contains:

- `member`
- `front_desk`
- `staff`
- `manager`
- `admin`

### Role hierarchy and frontend encapsulation

The UI and server routes use this inheritance order:

| Role | Accessible experience |
|---|---|
| Visitor | Public club, plans, courts, shop, and trial pages only |
| Member | Visitor pages plus the signed-in member account area |
| Front Desk | Member-facing operations, member records, court and enquiry tasks |
| Staff | Front desk operations plus shop, cafeteria, court, and assistant tasks |
| Manager | Operational dashboard, members, finance, staff, reports, and settings access |
| Admin | Complete dashboard and every management feature |

Protected UI routes are separated at the server:

- `/admin` requires an authenticated operational role
- `/portal?mode=member` requires a member session
- `/visitor` remains public
- `/` is the login and role-selection page

Frontend navigation is filtered by role and the backend continues to enforce JWT permissions. Frontend filtering is convenience; it is not the security boundary.

### Permission Model

Examples of permissions include:

- `members.read`
- `members.write`
- `memberships.manage`
- `courts.manage`
- `shop.manage`
- `bar.manage`
- `finance.read`
- `finance.manage`
- `staff.manage`
- `auth.admin`

`admin` bypasses normal permission checks. Other roles receive permissions through role-permission mappings in PostgreSQL.

### Token Handling

- JWTs expire after eight hours.
- Refresh tokens rotate and can be revoked.
- Accounts lock temporarily after repeated failed login attempts.
- Password reset uses single-use, one-hour hashed tokens.
- Tokens are verified for issuer and audience.
- Invalid and expired tokens return `401`.
- Missing authentication returns `401`.
- Valid authentication without required permission returns `403`.

---

## Core Business Rules

### Court Reservations

- Reservations last 60 minutes by default.
- Start times must use 30-minute intervals.
- A member may hold at most two confirmed sessions per day.
- Overlapping confirmed reservations are prohibited.
- PostgreSQL exclusion constraints and transaction locks protect reservation integrity.
- An overlapping concurrent request is returned with `409 COURT_CONFLICT`.
- Social sessions use one reservation and multiple participant records.

### Memberships

- Gold, Silver, and Junior plans are seeded by migration.
- Junior registration requires a date of birth.
- The Junior plan is for members under 18.
- A member may have only one active membership record.
- Renewals replace an active record rather than deleting it.
- Membership history is preserved.

### Inventory

- Stock cannot go below zero.
- Purchases update product quantity atomically.
- Sales deduct stock inside the order transaction.
- Cancellation restores stock and records a movement.
- The low-stock endpoint compares quantity with each product threshold.
- Idempotency keys prevent repeated order/payment operations.

### Cafeteria

- Tab settlement adds a recorded payment.
- Payment amounts are derived from active order totals.
- Cash, card, and UPI are recorded methods only.
- A successful settlement closes the tab and frees the table.
- Kitchen status is represented through a defined lifecycle.

### Finance

- Each revenue source remains identifiable.
- Discounts are calculated before total revenue.
- Cancelled shop orders are not treated as confirmed revenue.
- Cancelled and voided financial records are excluded appropriately.
- Taxes are represented as configurable recorded estimates.
- Payroll liabilities are separate from statutory remittance.

---

## Smart Assistant and Matchmaking

The assistant uses a bounded rule engine rather than pretending to be a general AI system.

Supported intents include:

- Court availability
- Low inventory
- Revenue and finance
- Matchmaking
- Balanced teams
- Cancellation recovery
- General help

### Matchmaking Compatibility

A score is based on:

- Whether both players prefer the requested sport
- Difference in skill level
- Configurable skill floor and ceiling

The score and the factors used to calculate it are returned to the caller.

### Team Balancing

Players are sorted by skill and assigned one at a time to the team with the lower current total.

### Cancellation Recovery

The system finds alternative courts that do not contain a confirmed overlapping reservation in the same time window.

All assistant context uses authenticated RBAC rules. A confirmation endpoint records an explicit confirmed action in assistant history.

---

## Testing and Quality

The project currently includes tests for:

- Health and readiness
- API metadata
- Consistent not-found responses
- Invalid JSON
- Malformed bearer tokens
- Public role assignment protection
- Protected endpoints
- Booking intervals
- Shop and fulfillment authorization
- Cafeteria authorization
- Public enquiries
- Leave and quotation authorization
- Assistant authorization
- Balanced team generation
- Migration constraints

Run everything:

```powershell
npm.cmd run quality
```

This command runs:

1. TypeScript validation
2. ESLint
3. Test suite
4. Production build

Run dependency security:

```powershell
npm.cmd run security:audit
```

GitHub Actions runs dependency installation, type checks, lint, tests, build, and production dependency auditing on pushes to `main`.

Real database concurrency testing requires a configured disposable PostgreSQL database. The migration and transaction design is intended for integration-test environments and a hosted database.

---

## Render Deployment

The repository includes [render.yaml](render.yaml), which defines:

- One Node.js web service
- One PostgreSQL database
- Production environment mode
- A generated JWT secret
- A linked database URL
- Migration-before-start behavior
- `/health` health check

Deploy through the Render dashboard:

1. Connect the GitHub repository.
2. Create a service using the Blueprint.
3. Allow Render to create `playpulse-db`.
4. Configure `DATABASE_URL` through the Blueprint database binding.
5. Confirm `JWT_SECRET` is generated.
6. Deploy the `main` branch.
7. Verify the deployed health and readiness endpoints.

The start command performs migrations before starting the API:

```text
npm run migrate:deploy && npm start
```

Migration execution is non-destructive and repeatable.

Important verification endpoints after deployment:

```text
GET /health
GET /ready
GET /api/v1
```

`/ready` should return HTTP 503 until PostgreSQL is configured or reachable.

---

## Important Assumptions

These assumptions are documented configuration choices, not claims from the original brief:

- Court sessions are 60 minutes.
- Court start intervals are 30 minutes.
- Members may reserve at most two sessions per day.
- Junior membership requires a member under 18.
- Gold, Silver, and Junior prices are configurable seed values.
- Friday social-play hours are configurable.
- The standard club timezone is `Asia/Kolkata`.
- Taxes are recorded or estimated internally.
- Statutory tax filing is external.
- Payroll calculations are summaries or estimates.
- Statutory payroll remittance is external.
- Payment methods are recorded, but no live payment gateway is connected.

---

## External Integration Boundaries

PlayPulse intentionally leaves the following integrations external:

- Live card, UPI, and online payment-gateway processing
- Real payment settlement reconciliation
- Statutory tax filing
- Tax authority submission
- Payroll remittance
- Email and SMS delivery
- External quotation delivery
- External trial calendar booking
- Push notifications
- Frontend hosting

The backend models the operational records needed for these integrations, but it does not claim to perform regulated or third-party actions.

---

## Security

### Implemented Protections

- bcrypt password hashing
- JWT issuer and audience checks
- JWT expiration
- Role-aware permission checks
- Public registration restriction
- Zod validation
- Helmet security headers
- CORS configuration
- Request body size limits
- API rate limiting
- Structured error responses
- Restricted internal stack traces
- PostgreSQL transaction and row locking
- Idempotency keys
- Audit events and assistant action history

### Operational Security Recommendations

- Use a unique, randomly generated JWT secret in production.
- Use a database connection with TLS where supported.
- Rotate secrets periodically.
- Restrict database credentials.
- Never commit `.env` files.
- Use HTTPS in all deployed environments.
- Restrict `admin` account creation.
- Review audit records regularly.
- Run dependency audits on every release.

---

## Development Checkpoints

The project follows the submitted development checkpoint sequence:

| Checkpoint | Area | Status |
|---|---|---|
| 0 | Environment and repository | Passed |
| 1 | Backend foundation and database | Passed |
| 2 | Authentication and authorization | Passed |
| 3 | Membership management | Passed |
| 4 | Court booking engine | Passed |
| 5 | Shop and inventory | Passed |
| 6 | Cafeteria and bar | Passed |
| 7 | Enquiries, staff, and finance | Passed |
| 8 | Smart assistant and matchmaking | Passed |
| 9 | Quality, testing, and security | Passed |
| 10 | Render deployment | Configuration complete; live verification pending |
| 11 | Documentation and submission | Complete |

The checkpoint tracker is maintained in [docs/checkpoint-tracker.md](docs/checkpoint-tracker.md).

---

## Repository Links and Submission

- GitHub repository: https://github.com/kushmita-yadav/PlayPlus
- Requirements traceability: [docs/requirements-traceability.md](docs/requirements-traceability.md)
- API examples: [docs/api-sample-responses.md](docs/api-sample-responses.md)
- Quality report: [docs/checkpoint-9-report.md](docs/checkpoint-9-report.md)
- Deployment report: [docs/checkpoint-10-report.md](docs/checkpoint-10-report.md)
- Submission checklist: [docs/submission-checklist.md](docs/submission-checklist.md)

No official submission has been presented as complete until external deployment verification is available.

---

## Troubleshooting

### `DATABASE_URL is not configured`

Set `DATABASE_URL` in `.env`, or configure it in the Render environment.

### Migration fails to connect

Verify:

- PostgreSQL is running.
- The database exists.
- The username and password are valid.
- The database URL permits connections.
- TLS settings match the hosted provider.

### Login says authentication is not configured

Set `JWT_SECRET` with at least 32 characters and restart the server.

### Health endpoint works but readiness fails

The process can run while PostgreSQL is unavailable. `/health` checks process liveness, while `/ready` checks database connectivity.

### Court conflict returned

The court is already confirmed for an overlapping time. Check the same court and date with the availability endpoint.

### Stock conflict returned

The requested quantity is greater than available stock. Review the product quantity and retry.

### Invalid JSON response

Confirm that the request body is valid JSON and the `Content-Type` header is `application/json`.

### Unauthorized response

Confirm that a valid bearer token is included. Use `/api/v1/auth/login` to obtain a token.

### Forbidden response

The account is authenticated but does not have the required role or permission.

---

## License

Add the project license before public submission if required by the organizer or team policy.

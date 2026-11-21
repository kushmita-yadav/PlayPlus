# PlayPulse

PlayPulse is a backend-first management platform for the Champions Club sports club.

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

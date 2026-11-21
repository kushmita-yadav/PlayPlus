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

Configure `DATABASE_URL` and `JWT_SECRET` in the Render service environment. Deploy using [render.yaml](render.yaml). Run migrations once after setting the database:

```text
npm run migrate:deploy
```

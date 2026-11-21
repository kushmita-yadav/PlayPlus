# API Sample Responses

## Health

`GET /health`

```json
{
  "status": "healthy",
  "service": "playpulse",
  "version": "0.1.0",
  "timestamp": "2026-11-21T00:00:00.000Z"
}
```

## Readiness

`GET /ready`

Ready:

```json
{
  "status": "ready",
  "database": {
    "ok": true,
    "latencyMs": 12
  }
}
```

Not configured:

```json
{
  "status": "not-ready",
  "database": {
    "ok": false,
    "latencyMs": null,
    "error": "DATABASE_URL is not configured"
  }
}
```

## Validation error

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request"
  }
}
```

## Unauthorized

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Bearer authentication required"
  }
}
```

## Court conflict

```json
{
  "success": false,
  "error": {
    "code": "COURT_CONFLICT",
    "message": "Court is already reserved for an overlapping time"
  }
}
```

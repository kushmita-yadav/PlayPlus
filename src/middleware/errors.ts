import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../logger.js";

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code = "API_ERROR",
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`, "NOT_FOUND"));
}

export function errorHandler(error: unknown, req: Request, res: Response, next: NextFunction): void {
  void next;
  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Invalid request", details: error.flatten() },
    });
    return;
  }

  const apiError = error instanceof ApiError ? error : null;
  const status = apiError?.statusCode ?? 500;
  const expose = apiError !== null;

  logger.error({
    err: error,
    method: req.method,
    path: req.originalUrl,
  }, "Request failed");

  res.status(status).json({
    success: false,
    error: {
      code: apiError?.code ?? "INTERNAL_ERROR",
      message: expose ? apiError.message : "An unexpected error occurred",
      ...(apiError?.details ? { details: apiError.details } : {}),
    },
  });
}

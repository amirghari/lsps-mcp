import fp from "fastify-plugin";
import type { FastifyError } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";

export default fp(async (app) => {
  app.setErrorHandler((rawErr, req, reply) => {
    const err = rawErr as FastifyError & {
      validation?: unknown;
      statusCode?: number;
    };
    const requestId = req.id;

    if (err instanceof AppError) {
      req.log.warn(
        { code: err.code, statusCode: err.statusCode, details: err.details },
        err.message,
      );
      return reply.status(err.statusCode).send({
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
        requestId,
      });
    }

    if (err instanceof ZodError) {
      req.log.warn({ issues: err.issues }, "Validation failed");
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: err.issues,
        },
        requestId,
      });
    }

    // Fastify validation errors (from schema)
    if (err.validation) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: err.message,
          details: err.validation,
        },
        requestId,
      });
    }

    if (err.statusCode === 429) {
      return reply.status(429).send({
        error: { code: "RATE_LIMITED", message: err.message },
        requestId,
      });
    }

    req.log.error({ err }, "Unhandled error");
    return reply.status(err.statusCode ?? 500).send({
      error: {
        code: "INTERNAL",
        message:
          app.config.NODE_ENV === "production"
            ? "Internal server error"
            : err.message,
      },
      requestId,
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.url} not found` },
      requestId: req.id,
    });
  });
});

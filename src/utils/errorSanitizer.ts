/**
 * Reduces an arbitrary caught error to a short, log-safe string.
 *
 * HTTP client wrappers can embed request details — including an
 * `Authorization: Bearer <token>` header — in `Error.message` or attached
 * fields. Logging a caught error verbatim would leak the bearer token, so
 * callers must route any error bound for `log.*` through this function
 * instead of logging the error object or its raw message directly.
 *
 * Redacts the caller-supplied token (if provided and non-empty) and any
 * `Bearer <value>` pattern, so a redaction still applies even if the
 * caller doesn't have the exact configured token at hand.
 */
export function sanitizeErrorForLog(err: unknown, secret?: string): string {
    const name = err instanceof Error ? err.name : typeof err;
    let message = err instanceof Error ? err.message : String(err);
    if (secret) {
        message = message.split(secret).join("[redacted]");
    }
    message = message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
    return `${name}: ${message}`;
}

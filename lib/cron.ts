import "server-only";
import { NextRequest } from "next/server";
import { ApiError } from "./http";

/**
 * Guard for cron-only endpoints. The caller must present the shared secret in
 * the `x-cron-secret` header (matching CRON_SECRET). Throws 401/503 otherwise.
 *
 * Trigger from system cron, e.g.:
 *   curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" \
 *     https://projectmanager.raceinnovations.in/api/cron/due-date-alerts
 */
export function assertCron(req: NextRequest): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new ApiError(503, "CRON_SECRET is not configured");
  }
  const provided = req.headers.get("x-cron-secret");
  if (provided !== secret) {
    throw new ApiError(401, "Invalid cron secret");
  }
}

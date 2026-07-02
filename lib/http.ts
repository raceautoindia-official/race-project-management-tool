import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Throwable error that maps to an HTTP status in route handlers. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

export const unauthorized = (msg = "Not authenticated") =>
  new ApiError(401, msg);
export const forbidden = (msg = "Forbidden") => new ApiError(403, msg);
export const notFound = (msg = "Not found") => new ApiError(404, msg);
export const badRequest = (msg = "Bad request") => new ApiError(400, msg);

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/** Convert any thrown error into a well-formed JSON response. */
export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }
  console.error("Unhandled API error:", error);
  return NextResponse.json(
    { error: "Internal server error" },
    { status: 500 }
  );
}

/** Parse pagination query params with sane bounds. */
export function getPagination(searchParams: URLSearchParams) {
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(searchParams.get("pageSize") ?? 20) || 20)
  );
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

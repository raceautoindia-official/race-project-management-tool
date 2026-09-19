import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "pm_session";

/**
 * GET /api/auth/session-ended — the session cookie is still valid but the
 * account no longer is (e.g. deactivated in the Attendance app). Clear the
 * cookie and go to the login page; redirecting straight to /login would bounce
 * back here, because the proxy sends signed-in users away from /login.
 */
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}

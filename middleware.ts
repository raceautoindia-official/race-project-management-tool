import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "pm_session";

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET ?? "";
  return new TextEncoder().encode(secret);
}

interface TokenClaims {
  userId: number;
  role: "admin" | "member";
  name: string;
}

async function readToken(req: NextRequest): Promise<TokenClaims | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (
      typeof payload.userId === "number" &&
      (payload.role === "admin" || payload.role === "member")
    ) {
      return {
        userId: payload.userId,
        role: payload.role,
        name: String(payload.name ?? ""),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Paths anyone may reach without a session.
const PUBLIC_PAGES = new Set(["/login"]);
const PUBLIC_APIS = new Set(["/api/auth/login"]);

// API path prefixes restricted to admins.
const ADMIN_API_PREFIXES = ["/api/activity", "/api/presence"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PAGES.has(pathname)) return true;
  if (PUBLIC_APIS.has(pathname)) return true;
  // Cron endpoints authenticate via the x-cron-secret header (see lib/cron.ts),
  // not a session cookie, so they bypass the session gate here.
  if (pathname.startsWith("/api/cron/")) return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isPublic(pathname)) {
    // If already logged in, keep them off the login page.
    if (pathname === "/login") {
      const claims = await readToken(req);
      if (claims) {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }
    return NextResponse.next();
  }

  const claims = await readToken(req);

  // Not authenticated.
  if (!claims) {
    if (isApi) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin-only areas.
  const needsAdmin =
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    ADMIN_API_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(p + "/")
    );

  if (needsAdmin && claims.role !== "admin") {
    if (isApi) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next internals and static asset files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff|woff2)$).*)",
  ],
};

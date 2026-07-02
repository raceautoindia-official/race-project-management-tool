import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { query, DbRow } from "./db";
import { ApiError, forbidden, unauthorized } from "./http";
import type { Role, SessionUser, User } from "./types";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "pm_session";
const SESSION_DAYS = 7;
const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60; // seconds

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("AUTH_SECRET is missing or too short");
  }
  return new TextEncoder().encode(secret);
}

// ---- Session JWT ----

export async function signSession(payload: SessionUser): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getSecretKey());
}

export async function verifySession(
  token: string
): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (
      typeof payload.userId === "number" &&
      (payload.role === "admin" || payload.role === "member") &&
      typeof payload.name === "string"
    ) {
      return {
        userId: payload.userId,
        role: payload.role as Role,
        name: payload.name,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ---- Cookie helpers ----

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

// ---- Current user resolution ----

/** Lightweight: read the token only, no DB hit. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

/**
 * Authoritative: resolves the full user record from the DB so role/active
 * changes take effect immediately. Returns null if logged out, deleted, or
 * deactivated.
 */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getSessionUser();
  if (!session) return null;
  const rows = await query<DbRow[]>(
    `SELECT id, name, email, role, is_active, must_change_password, created_at, updated_at
     FROM users WHERE id = ? LIMIT 1`,
    [session.userId]
  );
  const row = rows[0];
  if (!row || !row.is_active) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    is_active: Boolean(row.is_active),
    must_change_password: Boolean(row.must_change_password),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** For route handlers: returns the active user or throws 401. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  return user;
}

/** For route handlers: returns the user or throws 403 if not an admin. */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") throw forbidden("Admin access required");
  return user;
}

export { ApiError };

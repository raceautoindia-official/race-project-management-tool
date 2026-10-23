import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser } from "./auth";
import type { User } from "./types";

/** Protected page: requires an active user. */
export async function requirePageUser(): Promise<User> {
  const user = await getCurrentUser();
  // A signed-in cookie for an account that is gone or deactivated: clear it
  // first, or /login would bounce straight back here.
  if (!user) redirect("/api/auth/session-ended");
  return user;
}

/** Admin-only page. */
export async function requirePageAdmin(): Promise<User> {
  const user = await requirePageUser();
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}

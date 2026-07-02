import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser } from "./auth";
import type { User } from "./types";

/** Protected page: requires an active user. */
export async function requirePageUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Admin-only page. */
export async function requirePageAdmin(): Promise<User> {
  const user = await requirePageUser();
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}

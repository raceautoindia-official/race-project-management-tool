import { NextRequest } from "next/server";
import { query, DbResult } from "@/lib/db";
import type { Role, User } from "@/lib/types";

/** Every following route call runs as this user. */
export function actAs(user: User | null) {
  (globalThis as { __testUser?: User | null }).__testUser = user;
}

let seq = 0;
export async function createUser(name: string, role: Role = "member"): Promise<User> {
  seq++;
  const res = (await query<DbResult>(
    `INSERT INTO users (employee_id, emp_id, name, email, role)
     VALUES (?, ?, ?, ?, ?)`,
    [100000 + seq + Math.floor(Math.random() * 1e6), `T${Date.now()}${seq}`, name, `${name.toLowerCase()}@test.local`, role]
  )) as unknown as DbResult;
  return {
    id: res.insertId,
    name,
    email: `${name.toLowerCase()}@test.local`,
    role,
    is_active: true,
    must_change_password: false,
    created_at: "",
    updated_at: "",
  };
}

/** An approved project led by `lead` (so they may be nominated to approve requests). */
export async function createLedProject(lead: User, name = "Existing project"): Promise<number> {
  const res = (await query<DbResult>(
    `INSERT INTO projects (name, status, approval_status, owner_id) VALUES (?, 'active', 'approved', ?)`,
    [name, lead.id]
  )) as unknown as DbResult;
  await query(
    `INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'lead')`,
    [res.insertId, lead.id]
  );
  return res.insertId;
}

type Handler<P extends Record<string, string> = { id: string }> = (
  req: NextRequest,
  ctx: { params: Promise<P> }
) => Promise<Response>;

export interface CallResult<T = Record<string, unknown>> {
  status: number;
  body: T;
  res: Response;
}

/**
 * Invoke a route handler like Next would: `path` becomes the request URL,
 * `id` the dynamic [id] param, `body` JSON (or a FormData for uploads).
 */
export async function call<
  T = Record<string, unknown>,
  P extends Record<string, string> = { id: string },
>(
  handler: Handler<P>,
  opts: {
    method?: string;
    path?: string;
    id?: number | string;
    body?: unknown;
    headers?: Record<string, string>;
    /** Dynamic segments other than [id], e.g. { token: "…" }. */
    params?: P;
  } = {}
): Promise<CallResult<T>> {
  const init: { method: string; body?: BodyInit; headers?: Record<string, string> } = {
    method: opts.method ?? "GET",
  };
  if (opts.body instanceof FormData) {
    init.body = opts.body;
  } else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { "content-type": "application/json" };
  }
  init.headers = { ...init.headers, ...opts.headers };
  const req = new NextRequest(new URL(opts.path ?? "/", "http://localhost:3000"), init);
  const res = await handler(req, {
    params: Promise.resolve(opts.params ?? ({ id: String(opts.id ?? "") } as unknown as P)),
  });
  const type = res.headers.get("content-type") ?? "";
  const body = type.includes("application/json") ? await res.clone().json() : {};
  return { status: res.status, body: body as T, res };
}

import { beforeAll, describe, expect, it } from "vitest";
import { query, DbRow } from "@/lib/db";
import type { User } from "@/lib/types";
import { actAs, call, createUser } from "./helpers";

import * as userRoute from "@/app/api/users/[id]/route";

type Json = Record<string, string>;

/**
 * The two things PM decides about a person, and who is allowed to decide.
 *
 * Attendance owns identity. It also owns departments — except where an admin
 * has deliberately set one here, because Attendance's own data has gaps and
 * wrong values. The rule worth testing is that a deliberate answer survives
 * the next sync, and that clearing it hands the person back.
 */
describe("a person's department and job title", () => {
  let admin: User;
  let member: User;
  let subject: User;

  beforeAll(async () => {
    admin = await createUser("ProfileAdmin", "admin");
    member = await createUser("ProfileMember");
    subject = await createUser("ProfileSubject");
  });

  async function readSubject(): Promise<DbRow> {
    const [row] = await query<DbRow[]>(
      `SELECT department, department_source, designation FROM users WHERE id = ?`,
      [subject.id]
    );
    return row;
  }

  it("is not a member's to change", async () => {
    actAs(member);
    const res = await call<Json>(userRoute.PATCH, {
      method: "PATCH",
      id: subject.id,
      body: { designation: "Chief of Everything" },
    });
    expect(res.status).toBe(403);
  });

  it("an admin sets a job title PM keeps for itself", async () => {
    actAs(admin);
    const res = await call<{ user: DbRow }>(userRoute.PATCH, {
      method: "PATCH",
      id: subject.id,
      body: { designation: "Quality Inspector" },
    });
    expect(res.status).toBe(200);
    const row = await readSubject();
    expect(row.designation).toBe("Quality Inspector");
    // Naming a title says nothing about which department they are in.
    expect(row.department_source).toBe("attendance");
  });

  it("setting a department here stops the Attendance mirror overwriting it", async () => {
    actAs(admin);
    await call(userRoute.PATCH, {
      method: "PATCH",
      id: subject.id,
      body: { department: "Wash Plant" },
    });
    expect((await readSubject()).department_source).toBe("pm");

    // What the mirror does on every login and every heartbeat.
    await query(
      `UPDATE users SET department = ?
        WHERE employee_id = ? AND department_source = 'attendance'`,
      ["7305408577", subject.id]
    );
    const row = await readSubject();
    expect(row.department).toBe("Wash Plant");
  });

  it("clearing it hands the person back to Attendance", async () => {
    actAs(admin);
    await call(userRoute.PATCH, {
      method: "PATCH",
      id: subject.id,
      body: { department: "" },
    });
    const row = await readSubject();
    expect(row.department).toBeNull();
    expect(row.department_source).toBe("attendance");

    // And the mirror writes to them again.
    await query(
      `UPDATE users SET department = ? WHERE id = ? AND department_source = 'attendance'`,
      ["Sales", subject.id]
    );
    expect((await readSubject()).department).toBe("Sales");
  });
});

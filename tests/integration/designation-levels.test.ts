import { beforeAll, describe, expect, it } from "vitest";
import type { User } from "@/lib/types";
import { actAs, call, createUser } from "./helpers";

import * as levels from "@/app/api/designation-levels/route";
import * as person from "@/app/api/users/[id]/route";

/**
 * Admin › People & levels: job titles stay free text on users.designation,
 * and designation_levels gives each title a seniority level so titles that
 * are named differently can still be compared.
 */

interface Level {
  id: number;
  title: string;
  level: number | null;
  people: number;
}

let admin: User;
let member: User;
// Titles are unique per run so a shared test database can't confuse counts.
const suffix = `${Date.now()}`;
const TITLE = `Planning Engineer ${suffix}`;
const NEW_TITLE = `Site Supervisor ${suffix}`;

async function list(): Promise<Level[]> {
  const res = await call<{ levels: Level[] }>(levels.GET, {});
  expect(res.status).toBe(200);
  return res.body.levels;
}

beforeAll(async () => {
  admin = await createUser("LevelsAdmin", "admin");
  member = await createUser("LevelsMember");
});

describe("designation levels", () => {
  it("lets a member read the list but not change it", async () => {
    actAs(member);
    expect(Array.isArray(await list())).toBe(true);
    const put = await call(levels.PUT, { method: "PUT", body: { title: TITLE, level: 4 } });
    expect(put.status).toBe(403);
    expect((await list()).find((l) => l.title === TITLE)).toBeUndefined();
  });

  it("shows a level an admin sets, with how many people hold the title", async () => {
    actAs(admin);
    const put = await call(levels.PUT, { method: "PUT", body: { title: TITLE, level: 4 } });
    expect(put.status).toBe(200);
    // Give the member that title the normal way.
    const patch = await call(person.PATCH, { method: "PATCH", id: member.id, body: { designation: TITLE } });
    expect(patch.status).toBe(200);

    const row = (await list()).find((l) => l.title === TITLE);
    expect(row).toMatchObject({ level: 4, people: 1 });

    // Changing the level updates the same row rather than adding another.
    await call(levels.PUT, { method: "PUT", body: { title: TITLE, level: 6 } });
    const rows = (await list()).filter((l) => l.title === TITLE);
    expect(rows).toHaveLength(1);
    expect(rows[0].level).toBe(6);
  });

  it("removes a title on DELETE, and only for admins", async () => {
    actAs(admin);
    const row = (await list()).find((l) => l.title === TITLE)!;

    actAs(member);
    const denied = await call(levels.DELETE, { method: "DELETE", path: `/api/designation-levels?id=${row.id}` });
    expect(denied.status).toBe(403);

    actAs(admin);
    const del = await call(levels.DELETE, { method: "DELETE", path: `/api/designation-levels?id=${row.id}` });
    expect(del.status).toBe(200);
    expect((await list()).find((l) => l.title === TITLE)).toBeUndefined();

    const again = await call(levels.DELETE, { method: "DELETE", path: `/api/designation-levels?id=${row.id}` });
    expect(again.status).toBe(404);
  });

  it("adds a new job title to the list, waiting for a level", async () => {
    actAs(admin);
    const patch = await call(person.PATCH, { method: "PATCH", id: member.id, body: { designation: NEW_TITLE } });
    expect(patch.status).toBe(200);
    expect((await list()).find((l) => l.title === NEW_TITLE)).toMatchObject({ level: null, people: 1 });

    // Setting the same title on someone else doesn't duplicate it.
    await call(person.PATCH, { method: "PATCH", id: admin.id, body: { designation: NEW_TITLE } });
    const rows = (await list()).filter((l) => l.title === NEW_TITLE);
    expect(rows).toHaveLength(1);
    expect(rows[0].people).toBe(2);
  });
});

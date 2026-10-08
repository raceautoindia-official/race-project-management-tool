import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query, DbRow } from "@/lib/db";
import type { User } from "@/lib/types";
import { actAs, call, createLedProject, createUser } from "./helpers";

import * as credentials from "@/app/api/credentials/route";
import * as credential from "@/app/api/credentials/[id]/route";
import * as reveal from "@/app/api/credentials/[id]/reveal/route";

type Json = Record<string, unknown> & { error?: string };

let admin: User, lead: User, member: User;
let projectId: number;
let id: number;

beforeAll(async () => {
  process.env.CREDENTIALS_KEY = "a".repeat(64);
  admin = await createUser("Credadmin", "admin");
  lead = await createUser("Credlead");
  member = await createUser("Credmember");
  projectId = await createLedProject(lead, "Credentials project");
});

afterAll(() => {
  delete process.env.CREDENTIALS_KEY;
});

describe("the admin credentials vault", () => {
  it("stores a login, and never writes the password to the table", async () => {
    actAs(admin);
    const res = await call<{ id: number }>(credentials.POST, {
      method: "POST",
      body: {
        name: "Dealer portal",
        url: "https://portal.example.com",
        username: "race-admin",
        password: "correct-horse-battery-staple",
        notes: "Security question: first car",
        projectId,
      },
    });
    expect(res.status).toBe(201);
    id = res.body.id;

    const [row] = await query<DbRow[]>(
      `SELECT password_cipher, notes_cipher FROM credentials WHERE id = ?`,
      [id]
    );
    // What is in the database is not the password, and not the notes.
    expect(String(row.password_cipher)).not.toContain("correct-horse");
    expect(String(row.password_cipher).startsWith("v1:")).toBe(true);
    expect(String(row.notes_cipher)).not.toContain("first car");
  });

  it("lists them without the secrets", async () => {
    actAs(admin);
    const res = await call<{ credentials: Record<string, unknown>[] }>(credentials.GET, {});
    expect(res.status).toBe(200);
    const entry = res.body.credentials.find((c) => c.id === id)!;
    expect(entry.name).toBe("Dealer portal");
    expect(entry.username).toBe("race-admin");
    // A list is seen far more often than the password is needed.
    expect(Object.keys(entry)).not.toContain("password");
    expect(Object.keys(entry)).not.toContain("password_cipher");
    expect(Object.keys(entry)).not.toContain("notes_cipher");
  });

  it("hands the password back only when asked, and records who asked", async () => {
    actAs(admin);
    const res = await call<{ password: string; notes: string; username: string }>(
      reveal.POST,
      { method: "POST", id }
    );
    expect(res.status).toBe(200);
    expect(res.body.password).toBe("correct-horse-battery-staple");
    expect(res.body.notes).toBe("Security question: first car");

    const views = await query<DbRow[]>(
      `SELECT credential_name, user_id FROM credential_views WHERE credential_id = ?`,
      [id]
    );
    expect(views).toHaveLength(1);
    expect(views[0].user_id).toBe(admin.id);
    expect(views[0].credential_name).toBe("Dealer portal");
  });

  it("is closed to everyone who is not an admin", async () => {
    for (const who of [lead, member]) {
      actAs(who);
      expect((await call(credentials.GET, {})).status).toBe(403);
      expect(
        (
          await call(credentials.POST, {
            method: "POST",
            body: { name: "Theirs", password: "x" },
          })
        ).status
      ).toBe(403);
      expect((await call(reveal.POST, { method: "POST", id })).status).toBe(403);
      expect((await call(credential.DELETE, { method: "DELETE", id })).status).toBe(403);
    }
  });

  it("keeps the stored password when an edit leaves the field blank", async () => {
    actAs(admin);
    // The form cannot show the current password, so it cannot send it back.
    const res = await call(credential.PATCH, {
      method: "PATCH",
      id,
      body: { name: "Dealer portal (admin)", username: "race-admin-2" },
    });
    expect(res.status).toBe(200);

    const shown = await call<{ password: string }>(reveal.POST, { method: "POST", id });
    expect(shown.body.password).toBe("correct-horse-battery-staple");
  });

  it("changes it when one is given", async () => {
    actAs(admin);
    await call(credential.PATCH, {
      method: "PATCH",
      id,
      body: { password: "a-new-one" },
    });
    const shown = await call<{ password: string }>(reveal.POST, { method: "POST", id });
    expect(shown.body.password).toBe("a-new-one");
  });

  it("keeps the record of who read it after the login is deleted", async () => {
    actAs(admin);
    const made = await call<{ id: number }>(credentials.POST, {
      method: "POST",
      body: { name: "Temporary", password: "short-lived" },
    });
    await call(reveal.POST, { method: "POST", id: made.body.id });
    await call(credential.DELETE, { method: "DELETE", id: made.body.id });

    const [view] = await query<DbRow[]>(
      `SELECT credential_name, credential_id FROM credential_views WHERE credential_name = ?`,
      ["Temporary"]
    );
    // The login is gone; the fact that someone read it is not.
    expect(view.credential_id).toBeNull();
    expect(view.credential_name).toBe("Temporary");
  });

  it("refuses to store anything when there is no key to store it under", async () => {
    const key = process.env.CREDENTIALS_KEY;
    delete process.env.CREDENTIALS_KEY;
    actAs(admin);
    const res = await call<Json>(credentials.POST, {
      method: "POST",
      body: { name: "Nowhere safe", password: "x" },
    });
    // Not a fallback to plaintext.
    expect(res.status).toBe(503);
    expect(res.body.error).toContain("CREDENTIALS_KEY");
    const rows = await query<DbRow[]>(`SELECT id FROM credentials WHERE name = ?`, [
      "Nowhere safe",
    ]);
    expect(rows).toHaveLength(0);
    process.env.CREDENTIALS_KEY = key;
  });

  it("says so rather than guessing when the key has changed", async () => {
    actAs(admin);
    const made = await call<{ id: number }>(credentials.POST, {
      method: "POST",
      body: { name: "Saved under the old key", password: "unreadable-soon" },
    });
    process.env.CREDENTIALS_KEY = "b".repeat(64);
    const res = await call<Json>(reveal.POST, { method: "POST", id: made.body.id });
    expect(res.status).toBe(500);
    expect(res.body.error).toContain("CREDENTIALS_KEY has changed");
    process.env.CREDENTIALS_KEY = "a".repeat(64);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { query, DbRow } from "@/lib/db";
import type { User } from "@/lib/types";
import { actAs, call, createUser } from "./helpers";

import * as documents from "@/app/api/documents/route";
import * as document from "@/app/api/documents/[id]/route";

type Json = Record<string, unknown> & { error?: string };

let admin: User, alice: User, bob: User;
let aliceDoc: number;

function upload(name: string, body: string, category = "id_proof", note = "") {
  const form = new FormData();
  form.append("file", new File([body], name, { type: "application/pdf" }));
  form.append("category", category);
  if (note) form.append("note", note);
  return form;
}

beforeAll(async () => {
  admin = await createUser("Docadmin", "admin");
  alice = await createUser("Docalice");
  bob = await createUser("Docbob");
});

describe("personal documents", () => {
  it("lets someone upload their own", async () => {
    actAs(alice);
    const res = await call<{ document: { id: number; category: string; note: string } }>(
      documents.POST,
      { method: "POST", body: upload("aadhaar.pdf", "%PDF-1.4 fake", "id_proof", "Front and back") }
    );
    expect(res.status).toBe(201);
    expect(res.body.document.category).toBe("id_proof");
    expect(res.body.document.note).toBe("Front and back");
    aliceDoc = res.body.document.id;
  });

  it("lists only your own by default", async () => {
    actAs(bob);
    await call(documents.POST, {
      method: "POST",
      body: upload("degree.pdf", "%PDF-1.4 bob", "qualification"),
    });
    const mine = await call<{ documents: DbRow[] }>(documents.GET, {});
    expect(mine.body.documents).toHaveLength(1);
    expect(mine.body.documents[0].filename).toBe("degree.pdf");
  });

  it("is not another member's to list or open", async () => {
    actAs(bob);
    const listed = await call<Json>(documents.GET, { path: `/?userId=${alice.id}` });
    expect(listed.status).toBe(403);
    const opened = await call<Json>(document.GET, { id: aliceDoc });
    expect(opened.status).toBe(403);
  });

  it("gives an admin the file, and records that they opened it", async () => {
    actAs(admin);
    const listed = await call<{ documents: DbRow[] }>(documents.GET, {
      path: `/?userId=${alice.id}`,
    });
    expect(listed.status).toBe(200);
    expect(listed.body.documents[0].filename).toBe("aadhaar.pdf");

    const file = await call(document.GET, { id: aliceDoc });
    expect(file.status).toBe(200);
    expect(file.res.headers.get("content-disposition")).toContain("aadhaar.pdf");
    // Nobody should be able to read someone's ID proof unobserved.
    expect(file.res.headers.get("cache-control")).toBe("private, no-store");

    const [log] = await query<DbRow[]>(
      `SELECT action, entity_id, metadata FROM activity_log
        WHERE user_id = ? AND action = ? ORDER BY id DESC LIMIT 1`,
      [admin.id, "document.viewed"]
    );
    expect(log.entity_id).toBe(alice.id);
    expect(JSON.stringify(log.metadata)).toContain("aadhaar.pdf");
  });

  it("does not record the owner reading their own", async () => {
    const before = await query<DbRow[]>(
      `SELECT COUNT(*) AS n FROM activity_log WHERE action = ?`,
      ["document.viewed"]
    );
    actAs(alice);
    const file = await call(document.GET, { id: aliceDoc });
    expect(file.status).toBe(200);
    const after = await query<DbRow[]>(
      `SELECT COUNT(*) AS n FROM activity_log WHERE action = ?`,
      ["document.viewed"]
    );
    expect(Number(after[0].n)).toBe(Number(before[0].n));
  });

  it("is the owner's to remove, and nobody else's — not even an admin's", async () => {
    actAs(admin);
    const byAdmin = await call<Json>(document.DELETE, { method: "DELETE", id: aliceDoc });
    // A record someone else can quietly remove is not much of a record.
    expect(byAdmin.status).toBe(403);

    actAs(bob);
    expect((await call(document.DELETE, { method: "DELETE", id: aliceDoc })).status).toBe(403);

    actAs(alice);
    expect((await call(document.DELETE, { method: "DELETE", id: aliceDoc })).status).toBe(200);
    const rows = await query<DbRow[]>(`SELECT id FROM user_documents WHERE id = ?`, [
      aliceDoc,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("refuses an empty file and falls back to 'other' for an unknown kind", async () => {
    actAs(alice);
    const empty = new FormData();
    empty.append("file", new File([], "nothing.pdf", { type: "application/pdf" }));
    const res = await call<Json>(documents.POST, { method: "POST", body: empty });
    expect(res.status).toBe(400);

    const odd = await call<{ document: { category: string } }>(documents.POST, {
      method: "POST",
      body: upload("odd.pdf", "x", "something-made-up"),
    });
    expect(odd.body.document.category).toBe("other");
  });
});

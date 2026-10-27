import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { errorResponse, ApiError } from "@/lib/http";
import { assertRequestVisible } from "@/lib/rbac";
import { dispositionFor } from "@/lib/inline-files";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/request-attachments/:id — download a file sent with a task
 * request (its raiser and the project's leads, who see the request).
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const fileId = Number(id);
    if (!Number.isInteger(fileId)) throw new ApiError(400, "Invalid id");

    const [file] = await query<DbRow[]>(
      `SELECT request_id, filename, mime_type, data FROM task_request_attachments WHERE id = ? LIMIT 1`,
      [fileId]
    );
    if (!file) throw new ApiError(404, "Attachment not found");
    await assertRequestVisible(user, file.request_id);

    const data: Buffer = file.data;
    const wantsInline = new URL(req.url).searchParams.get("inline") === "1";
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": file.mime_type || "application/octet-stream",
        "Content-Disposition": dispositionFor(file.mime_type, wantsInline, String(file.filename)),
        "Content-Length": String(data.length),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

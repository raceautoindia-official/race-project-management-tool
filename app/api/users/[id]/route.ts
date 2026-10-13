import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { updateUserProfileSchema } from "@/lib/validation";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/**
 * PATCH — the two things about a person that PM decides for itself.
 *
 * Identity comes from the Attendance app and is never written back: names,
 * employee IDs, roles and active flags all belong there. These two do not.
 *
 * A job title has no column in Attendance at all, so PM keeps its own. A
 * department does exist there, but with gaps and mistakes, so setting one
 * here marks the person as decided-in-PM and the mirror stops overwriting
 * them. Clearing it hands them back to Attendance.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin();
    const id = Number((await params).id);
    if (!Number.isInteger(id)) throw new ApiError(400, "Invalid id");

    const data = updateUserProfileSchema.parse(await req.json().catch(() => ({})));

    const [user] = await query<DbRow[]>(
      `SELECT id, name, department FROM users WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!user) throw new ApiError(404, "User not found");

    const sets: string[] = [];
    const values: unknown[] = [];
    if (data.department !== undefined) {
      sets.push("department = ?", "department_source = ?");
      values.push(data.department, data.department ? "pm" : "attendance");
    }
    if (data.designation !== undefined) {
      sets.push("designation = ?");
      values.push(data.designation);
    }
    if (!sets.length) throw new ApiError(400, "Nothing to change");

    await query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, [...values, id]);

    await logActivity({
      userId: admin.id,
      action: "user.profile_updated",
      entityType: "user",
      entityId: id,
      metadata: {
        name: user.name,
        ...(data.department !== undefined ? { department: data.department } : {}),
        ...(data.designation !== undefined ? { designation: data.designation } : {}),
      },
    });

    const [fresh] = await query<DbRow[]>(
      `SELECT id, name, department, department_source, designation
         FROM users WHERE id = ?`,
      [id]
    );
    return json({ user: fresh });
  } catch (err) {
    return errorResponse(err);
  }
}

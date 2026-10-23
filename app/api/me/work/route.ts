import { requireUser } from "@/lib/auth";
import { json, errorResponse } from "@/lib/http";
import { getMyWork } from "@/lib/my-work";

/** GET /api/me/work — what the signed-in person needs to do and review (lib/my-work.ts). */
export async function GET() {
  try {
    const user = await requireUser();
    return json(await getMyWork(user));
  } catch (err) {
    return errorResponse(err);
  }
}

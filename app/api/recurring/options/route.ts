import { requireUser } from "@/lib/auth";
import { json, errorResponse } from "@/lib/http";
import { ruleOptions } from "@/lib/recurring";

export const dynamic = "force-dynamic";

/** GET /api/recurring/options — projects (with their people) and staff, for the form. */
export async function GET() {
  try {
    const user = await requireUser();
    return json(await ruleOptions(user));
  } catch (err) {
    return errorResponse(err);
  }
}

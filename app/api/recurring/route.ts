import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { json, errorResponse } from "@/lib/http";
import { recurringRuleSchema } from "@/lib/validation";
import { createRule, listRules } from "@/lib/recurring";

export const dynamic = "force-dynamic";

/** GET /api/recurring?project=&rule= — the recurring tasks this person can see. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const sp = req.nextUrl.searchParams;
    const projectId = Number(sp.get("project")) || undefined;
    const ruleId = Number(sp.get("rule")) || undefined;
    return json({ rules: await listRules(user, { projectId, ruleId }) });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST /api/recurring — set up a recurring task. An admin's starts at once
 * (and says whether copies need review); anyone else's waits for an admin.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const data = recurringRuleSchema.parse(await req.json().catch(() => ({})));
    const id = await createRule(user, data);
    const [rule] = await listRules(user, { ruleId: id });
    return json({ rule }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

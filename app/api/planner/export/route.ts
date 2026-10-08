import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { requireUser } from "@/lib/auth";
import { errorResponse, ApiError, forbidden } from "@/lib/http";
import {
  describePeriod,
  entryDateFor,
  isDateKey,
  todayIst,
  type PlannerPeriod,
} from "@/lib/planner";
import {
  canReadPlanner,
  plannerForPeriod,
  plannerRange,
  type PlannerRow,
} from "@/lib/planner-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/planner/export — the planner as a spreadsheet.
 *
 *   ?scope=mine&userId=&from=&to=   one person over a range
 *   ?scope=team&date=               everyone you may read, for one period
 *
 * The same visibility rule as reading it on screen: what you can download is
 * what you can see.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const params = new URL(req.url).searchParams;
    const period: PlannerPeriod = params.get("period") === "week" ? "week" : "day";
    const date = params.get("date") ?? todayIst();
    if (!isDateKey(date)) throw new ApiError(400, "Expected date as YYYY-MM-DD");

    let rows: PlannerRow[];
    let title: string;

    if (params.get("scope") === "team") {
      const entryDate = entryDateFor(period, date);
      rows = await plannerForPeriod(user, period, entryDate);
      title = `team-${period}-${entryDate}`;
    } else {
      const asked = params.get("userId");
      const forUser = asked ? Number(asked) : user.id;
      if (!Number.isInteger(forUser) || forUser <= 0) throw new ApiError(400, "Invalid userId");
      if (!(await canReadPlanner(user, forUser))) {
        throw forbidden("That planner is not yours to read");
      }
      const from = params.get("from") ?? date;
      const to = params.get("to") ?? date;
      if (!isDateKey(from) || !isDateKey(to)) {
        throw new ApiError(400, "Expected from and to as YYYY-MM-DD");
      }
      rows = await plannerRange(forUser, period, from, to);
      title = `planner-${period}-${from}-to-${to}`;
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(period === "week" ? "Weekly planner" : "Daily planner");
    ws.addRow([
      period === "week" ? "Week" : "Date",
      "Person",
      "Employee ID",
      "Plan",
      "How it went",
      "Last updated",
    ]);
    for (const r of rows) {
      ws.addRow([
        describePeriod(period, String(r.entry_date)),
        r.user_name,
        (r.emp_id as string) ?? "",
        r.plan ?? "",
        r.progress ?? "",
        String(r.updated_at).replace("T", " ").slice(0, 16),
      ]);
    }

    ws.columns = [
      { width: 18 },
      { width: 22 },
      { width: 14 },
      { width: 60 },
      { width: 60 },
      { width: 18 },
    ];
    // The plans are paragraphs, so let them be paragraphs.
    ws.getColumn(4).alignment = { wrapText: true, vertical: "top" };
    ws.getColumn(5).alignment = { wrapText: true, vertical: "top" };
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
    header.alignment = { vertical: "middle" };

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${title}.xlsx"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

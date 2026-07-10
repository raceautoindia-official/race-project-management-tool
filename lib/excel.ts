import "server-only";
import ExcelJS from "exceljs";

export const STATUS_VALUES = ["todo", "in_progress", "review", "done"] as const;
export const PRIORITY_VALUES = ["low", "medium", "high", "urgent"] as const;

// Identity across the app is the attendance Employee ID (not email — some
// employees have no email). The assignee column therefore keys on Employee ID.
const HEADERS = [
  "Title",
  "Description",
  "Status",
  "Priority",
  "Assignee Employee ID",
  "Due Date (YYYY-MM-DD)",
  "Estimated Hours",
];

export interface MemberOption {
  empId: string;
  name: string;
}

export interface TaskExportRow {
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assignee_emp_id: string | null;
  due_date: string | null;
  estimated_hours: number | string | null;
}

function styleSheet(ws: ExcelJS.Worksheet) {
  ws.columns = [
    { width: 34 },
    { width: 44 },
    { width: 14 },
    { width: 12 },
    { width: 22 },
    { width: 22 },
    { width: 16 },
  ];
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF4F46E5" },
  };
  header.alignment = { vertical: "middle" };
}

/** Workbook of existing tasks for export. */
export async function tasksWorkbookBuffer(
  rows: TaskExportRow[]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Tasks");
  ws.addRow(HEADERS);
  for (const r of rows) {
    ws.addRow([
      r.title,
      r.description ?? "",
      r.status,
      r.priority,
      r.assignee_emp_id ?? "",
      r.due_date ?? "",
      r.estimated_hours != null ? Number(r.estimated_hours) : "",
    ]);
  }
  styleSheet(ws);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Blank import template: headers, one sample row, dropdown validation on the
 *  Status / Priority / Assignee columns, and an instructions sheet. */
export async function templateWorkbookBuffer(
  members: MemberOption[]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Tasks");
  ws.addRow(HEADERS);
  ws.addRow([
    "Example: design the login screen",
    "Optional longer description",
    "todo",
    "high",
    members[0]?.empId ?? "EMP001",
    "2026-08-01",
    8,
  ]);
  styleSheet(ws);

  // Dropdowns (data validation) down each list column so users pick, not type.
  const LAST = 1000;
  for (let r = 2; r <= LAST; r++) {
    ws.getCell(`C${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${STATUS_VALUES.join(",")}"`],
      showErrorMessage: true,
      error: `Choose one of: ${STATUS_VALUES.join(", ")}`,
    };
    ws.getCell(`D${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${PRIORITY_VALUES.join(",")}"`],
      showErrorMessage: true,
      error: `Choose one of: ${PRIORITY_VALUES.join(", ")}`,
    };
  }

  // Assignee Employee IDs → stash on a hidden sheet and reference it (every
  // employee has an Employee ID, unlike email).
  if (members.length > 0) {
    const lists = wb.addWorksheet("Lists");
    members.forEach((m, i) => (lists.getCell(`A${i + 1}`).value = m.empId));
    lists.state = "hidden";
    const ref = `Lists!$A$1:$A$${members.length}`;
    for (let r = 2; r <= LAST; r++) {
      ws.getCell(`E${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [ref],
      };
    }
  }

  const info = wb.addWorksheet("Instructions");
  info.columns = [{ width: 24 }, { width: 60 }];
  info.addRow(["Field", "Allowed / notes"]);
  info.getRow(1).font = { bold: true };
  info.addRow(["Title", "Required. One task per row."]);
  info.addRow(["Description", "Optional."]);
  info.addRow(["Status", STATUS_VALUES.join(", ") + " (default: todo)"]);
  info.addRow(["Priority", PRIORITY_VALUES.join(", ") + " (default: medium)"]);
  info.addRow([
    "Assignee Employee ID",
    "Must be a project member's Employee ID. Blank = unassigned.",
  ]);
  info.addRow(["Due Date", "Format YYYY-MM-DD. Optional."]);
  info.addRow(["Estimated Hours", "Number, e.g. 8. Optional."]);
  info.addRow([]);
  info.addRow(["Project members:", ""]);
  for (const m of members) info.addRow([m.empId, m.name]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface ParsedTaskRow {
  rowNumber: number;
  title: string;
  description: string | null;
  status: string | null;
  priority: string | null;
  assigneeEmpId: string | null;
  dueDate: string | null;
  estimatedHours: number | null;
}

function headerKey(text: string): string | null {
  const t = text.toLowerCase().replace(/[^a-z]/g, "");
  if (t.includes("title")) return "title";
  if (t.includes("description")) return "description";
  if (t.includes("status")) return "status";
  if (t.includes("priority")) return "priority";
  if (t.includes("assignee") || t.includes("employee") || t.includes("empid"))
    return "assigneeEmpId";
  if (t.includes("due")) return "dueDate";
  if (t.includes("estimat") || t.includes("hour")) return "estimatedHours";
  return null;
}

function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return "";
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "object" && "text" in v) return String(v.text).trim();
  return String(cell.text ?? v).trim();
}

function cellDate(cell: ExcelJS.Cell | undefined): string | null {
  if (!cell) return null;
  const v = cell.value;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = cellText(cell);
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "invalid";
}

/** Parse the first worksheet into raw task rows (validation happens later). */
export async function parseTasksWorkbook(
  buffer: Buffer
): Promise<ParsedTaskRow[]> {
  const wb = new ExcelJS.Workbook();
  // exceljs's Buffer type differs from @types/node's generic Buffer; cast.
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const colOf: Record<string, number> = {};
  ws.getRow(1).eachCell((cell, col) => {
    const key = headerKey(cellText(cell));
    if (key) colOf[key] = col;
  });

  const out: ParsedTaskRow[] = [];
  ws.eachRow((row, rn) => {
    if (rn === 1) return;
    const get = (k: string) => (colOf[k] ? row.getCell(colOf[k]) : undefined);
    const title = cellText(get("title"));
    if (!title) return; // skip blank rows
    const hoursText = cellText(get("estimatedHours"));
    out.push({
      rowNumber: rn,
      title,
      description: cellText(get("description")) || null,
      status: cellText(get("status")).toLowerCase() || null,
      priority: cellText(get("priority")).toLowerCase() || null,
      assigneeEmpId: cellText(get("assigneeEmpId")) || null,
      dueDate: cellDate(get("dueDate")),
      estimatedHours: hoursText === "" ? null : Number(hoursText),
    });
  });
  return out;
}

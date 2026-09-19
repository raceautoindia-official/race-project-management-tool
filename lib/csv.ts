type Cell = string | number | boolean | null | undefined;

function escapeCell(value: Cell): string {
  let s = value === null || value === undefined ? "" : String(value);
  // A text cell starting with = + - @ (or tab/CR) would run as a formula in
  // Excel/Sheets; prefix an apostrophe so it stays text. Numbers are untouched.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(","));
  }
  return lines.join("\r\n");
}

export function csvResponse(filename: string, csv: string): Response {
  // BOM so Excel reads UTF-8 correctly.
  return new Response("﻿" + csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

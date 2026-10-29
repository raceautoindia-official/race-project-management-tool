import { describe, expect, it } from "vitest";
import { looksLikeCode } from "@/lib/admin-overview";

describe("a department name that is really an ID or a phone number", () => {
  it("is flagged", () => {
    for (const name of ["ADMIN001", "7305408577", "+91 73054 08577", "emp42"]) {
      expect(looksLikeCode(name), name).toBe(true);
    }
  });

  it("leaves real department names alone", () => {
    for (const name of ["Production", "Design", "R&D", "Quality 2", "IT", "Sales & Marketing"]) {
      expect(looksLikeCode(name), name).toBe(false);
    }
  });
});

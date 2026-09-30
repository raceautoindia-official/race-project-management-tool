// Employees created in the throwaway attendance DB for every e2e run.
export const E2E_PIN = "4321";

export interface E2EUser {
  id: number;
  empId: string;
  name: string;
  email: string;
  role: "employee" | "manager" | "super_admin";
  active: boolean;
}

export const USERS = {
  admin: { id: 9001, empId: "E2EADMIN", name: "Asha Admin", email: "asha@e2e.local", role: "super_admin", active: true },
  lead: { id: 9002, empId: "E2ELEAD", name: "Lee Lead", email: "lee@e2e.local", role: "employee", active: true },
  alice: { id: 9003, empId: "E2EALICE", name: "Alice Requester", email: "alice@e2e.local", role: "employee", active: true },
  sam: { id: 9004, empId: "E2ESAM", name: "Sam Owner", email: "sam@e2e.local", role: "employee", active: true },
  olivia: { id: 9005, empId: "E2EOLIVIA", name: "Olivia Outsider", email: "olivia@e2e.local", role: "employee", active: true },
  gone: { id: 9006, empId: "E2EGONE", name: "Gina Gone", email: "gina@e2e.local", role: "employee", active: false },
  leaver: { id: 9007, empId: "E2ELEAVER", name: "Leo Leaver", email: "leo@e2e.local", role: "employee", active: true },
} satisfies Record<string, E2EUser>;

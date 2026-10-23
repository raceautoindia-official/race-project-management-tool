// Suggestion lists for first-time company setup (and the platform's "Add
// company" form). These are starting points only — every one is editable.

export const COUNTRIES: { name: string; timezone: string }[] = [
  { name: "India", timezone: "Asia/Kolkata (IST)" },
  { name: "UAE", timezone: "Asia/Dubai (GST)" },
  { name: "Saudi Arabia", timezone: "Asia/Riyadh (AST)" },
  { name: "Singapore", timezone: "Asia/Singapore (SGT)" },
  { name: "Malaysia", timezone: "Asia/Kuala_Lumpur (MYT)" },
  { name: "Sri Lanka", timezone: "Asia/Colombo (IST)" },
  { name: "United Kingdom", timezone: "Europe/London (GMT/BST)" },
  { name: "Germany", timezone: "Europe/Berlin (CET)" },
  { name: "United States", timezone: "America/New_York (ET)" },
  { name: "Australia", timezone: "Australia/Sydney (AET)" },
];

export const TIMEZONES = Array.from(new Set(COUNTRIES.map((c) => c.timezone)));

export const COMPANY_SIZES = ["1–10 people", "11–50 people", "51–200 people", "201–500 people", "500+ people"];

/** 0 = Sunday … 6 = Saturday, shown Monday-first. */
export const WEEK_DAYS: { day: number; short: string }[] = [
  { day: 1, short: "Mon" },
  { day: 2, short: "Tue" },
  { day: 3, short: "Wed" },
  { day: 4, short: "Thu" },
  { day: 5, short: "Fri" },
  { day: 6, short: "Sat" },
  { day: 0, short: "Sun" },
];

/** Suggested departments per industry preset (keys match TERMINOLOGY_PRESETS). */
export const DEPARTMENT_SUGGESTIONS: Record<string, string[]> = {
  "General / Corporate": ["Management", "Operations", "Sales", "Marketing", "Finance", "HR", "IT"],
  Manufacturing: ["Production", "Quality", "Maintenance", "Stores", "Purchase", "HR", "Finance"],
  Construction: ["Projects", "Site Engineering", "Planning", "Safety", "Procurement", "Finance", "HR"],
  "Agency / Marketing": ["Client Servicing", "Creative", "Strategy", "Media", "Production", "Finance"],
  "Legal / Consulting": ["Partners", "Litigation", "Corporate", "Advisory", "Research", "Finance & Admin"],
  Software: ["Engineering", "Product", "Design", "QA", "DevOps", "Customer Success", "HR"],
};

const DEFAULT_LADDER = ["Trainee", "Executive", "Senior Executive", "Assistant Manager", "Manager", "Senior Manager", "General Manager", "Director"];

/** Suggested designation ladders (level 1 = most junior). */
export const DESIGNATION_SUGGESTIONS: Record<string, string[]> = {
  "General / Corporate": DEFAULT_LADDER,
  Manufacturing: ["Trainee", "Operator", "Technician", "Supervisor", "Engineer", "Assistant Manager", "Plant Manager", "Director"],
  Construction: ["Trainee", "Site Supervisor", "Site Engineer", "Senior Engineer", "Project Engineer", "Project Manager", "General Manager", "Director"],
  "Agency / Marketing": ["Intern", "Associate", "Executive", "Senior Executive", "Manager", "Account Director", "Director"],
  "Legal / Consulting": ["Intern", "Associate", "Senior Associate", "Principal Associate", "Counsel", "Partner", "Managing Partner"],
  Software: ["Intern", "Engineer I", "Engineer II", "Senior Engineer", "Lead Engineer", "Engineering Manager", "Director"],
};

export function suggestedDepartments(industry: string): string[] {
  return DEPARTMENT_SUGGESTIONS[industry] ?? DEPARTMENT_SUGGESTIONS["General / Corporate"];
}

export function suggestedDesignations(industry: string): { name: string; level: number }[] {
  return (DESIGNATION_SUGGESTIONS[industry] ?? DEFAULT_LADDER).map((name, i) => ({ name, level: i + 1 }));
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

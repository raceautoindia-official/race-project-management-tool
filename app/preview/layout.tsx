import type { Metadata } from "next";
import { PreviewProvider } from "@/lib/preview/store";

export const metadata: Metadata = {
  title: "Work Management — Design Preview",
  description: "Clickable preview of the redesigned Project › Task › Subtask experience (sample data).",
};

// The preview runs on in-browser sample data only — it never reads or writes
// the database, so it is reachable without logging in (see middleware.ts).
// Company pages live in (company)/, the super-admin console in platform/, and
// first-time setup in onboarding/ — each with its own layout.
export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return <PreviewProvider>{children}</PreviewProvider>;
}

import Shell from "@/components/preview/Shell";

// Everything a company's members use: My Work, projects, team, admin, etc.
export default function CompanyLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}

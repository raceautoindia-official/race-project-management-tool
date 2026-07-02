// A plain download link to a CSV API endpoint. Uses a real <a> (not next/link)
// because the target streams a file rather than navigating to a page.
export default function ExportButton({
  href,
  children = "Export CSV",
}: {
  href: string;
  children?: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
    >
      {children}
    </a>
  );
}

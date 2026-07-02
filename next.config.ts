import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // This repo lives alongside other lockfiles; pin the workspace root so
  // Turbopack file tracing resolves from this project, not a parent folder.
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDFKit ships .afm font metric files that it loads at runtime by
  // path-relative lookup (`__dirname/data/Helvetica.afm`). Turbopack
  // bundles those resolutions to a virtual `/ROOT/...` root that
  // doesn't exist on disk, so the runtime open fails with ENOENT.
  // Marking the package as a server-external dependency tells Next.js
  // to leave it as a plain Node `require()` — pdfkit then resolves
  // its own data files relative to the real `node_modules` path.
  //
  // Apply the same treatment to exceljs and pdf-parse for the same
  // reason (both bundle binary/data assets they read at runtime).
  serverExternalPackages: ["pdfkit", "exceljs", "pdf-parse"],
};

export default nextConfig;

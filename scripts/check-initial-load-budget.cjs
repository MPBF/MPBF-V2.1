const path = require("node:path");
const { collectInitialAssets, measureAssets, assertBudget } = require("./lib/initial-load-budget.cjs");

try {
  const root = path.resolve(process.argv[2] || "dist/public");
  const report = measureAssets(root, collectInitialAssets(root));
  console.table(report.assets.map(asset => ({
    file: asset.file, kB: (asset.bytes / 1000).toFixed(2), gzip_kB: (asset.gzipBytes / 1000).toFixed(2),
  })));
  assertBudget(report);
  console.log(`PASS initial JS + CSS: ${(report.totals.totalGzipBytes / 1000).toFixed(2)} kB gzip. On-demand chunks are excluded.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

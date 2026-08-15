// Regenerates the theme screenshots in screenshots/ from sample data.
// Usage: npm run screenshots
import { buildSync } from "esbuild";
import { writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = path.join(root, "node_modules", ".screenshot-build.mjs");

buildSync({
	entryPoints: [path.join(root, "src", "index.ts")],
	bundle: true,
	format: "esm",
	outfile: tmp,
});
const m = await import(tmp);

const data = [
	{ requests: 265_000, bytes: 397_000_000, uniques: 21_200, date: "2026-08-08" },
	{ requests: 289_000, bytes: 433_000_000, uniques: 23_100, date: "2026-08-09" },
	{ requests: 312_000, bytes: 468_000_000, uniques: 24_900, date: "2026-08-10" },
	{ requests: 298_000, bytes: 447_000_000, uniques: 23_800, date: "2026-08-11" },
	{ requests: 334_000, bytes: 501_000_000, uniques: 26_700, date: "2026-08-12" },
	{ requests: 305_000, bytes: 457_000_000, uniques: 24_400, date: "2026-08-13" },
	{ requests: 337_000, bytes: 505_000_000, uniques: 27_000, date: "2026-08-14" },
];
const total = data.reduce((sum, d) => sum + d.requests, 0);
const label = "Website Traffic (last 7 days)";

// Deterministic pseudo-random 30-day data for the heatmap screenshot.
const heatmapData = Array.from({ length: 30 }, (_, i) => {
	const date = new Date(Date.UTC(2026, 6, 16 + i)).toISOString().split("T")[0];
	const wave = Math.sin(i * 1.7) * 0.4 + Math.sin(i * 0.6) * 0.3;
	return { requests: Math.round(300_000 * (0.55 + 0.45 * wave)), date };
});
const heatmapTotal = heatmapData.reduce((sum, d) => sum + d.requests, 0);

const outputs = {
	"theme-neon.svg": m.generateSvg(data, total, label),
	"theme-minimal.svg": m.generateSvgMinimal(data, total, label),
	"theme-gradient.svg": m.generateSvgGradient(data, total, label),
	"theme-dashboard.svg": m.generateSvgDashboard(data, total, label),
	"theme-badge.svg": m.generateSvgBadge(data, total, label),
	"theme-heatmap.svg": m.generateSvgHeatmap(heatmapData, heatmapTotal, "Website Traffic (last 30 days)"),
	"theme-ticker.svg": m.generateSvgTicker(data, total, label),
};

for (const [file, svg] of Object.entries(outputs)) {
	writeFileSync(path.join(root, "screenshots", file), svg);
	console.log(`Wrote screenshots/${file}`);
}
rmSync(tmp);

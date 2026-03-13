import {
	describe,
	it,
	expect,
} from "vitest";
import {
	formatNumber,
	buildSparklinePoints,
	buildBars,
	generateSvg,
	generateErrorSvg,
	getDateRange,
	resolveTheme,
	generateSvgMinimal,
	generateSvgGradient,
	generateSvgForTheme,
	buildAreaChart,
	buildHorizontalBars,
} from "../src/index";

describe("formatNumber", () => {
	it("formats billions", () => {
		expect(formatNumber(1_500_000_000)).toBe("1.5B");
		expect(formatNumber(2_000_000_000)).toBe("2B");
	});

	it("formats millions", () => {
		expect(formatNumber(2_140_000)).toBe("2.14M");
		expect(formatNumber(1_000_000)).toBe("1M");
		expect(formatNumber(5_600_000)).toBe("5.6M");
	});

	it("formats thousands", () => {
		expect(formatNumber(1_500)).toBe("1.5K");
		expect(formatNumber(42_000)).toBe("42K");
		expect(formatNumber(999)).toBe("999");
	});

	it("formats small numbers", () => {
		expect(formatNumber(0)).toBe("0");
		expect(formatNumber(42)).toBe("42");
		expect(formatNumber(100)).toBe("100");
	});
});

describe("buildSparklinePoints", () => {
	it("returns empty string for empty values", () => {
		expect(buildSparklinePoints([], 450, 120, 20, 20)).toBe("");
	});

	it("produces correct number of points", () => {
		const values = [10, 20, 30, 40, 50, 60, 70];
		const points = buildSparklinePoints(values, 450, 120, 20, 20);
		const coords = points.split(" ");
		expect(coords).toHaveLength(7);
	});

	it("first point starts at paddingX, last point ends at width - paddingX", () => {
		const values = [1, 2, 3];
		const points = buildSparklinePoints(values, 450, 120, 20, 20);
		const coords = points.split(" ");
		expect(coords[0].startsWith("20.0,")).toBe(true);
		expect(coords[coords.length - 1].startsWith("430.0,")).toBe(true);
	});

	it("handles constant values", () => {
		const values = [5, 5, 5, 5];
		const points = buildSparklinePoints(values, 450, 120, 20, 20);
		const coords = points.split(" ");
		// All Y values should be equal when all values are the same
		const yValues = coords.map((c) => parseFloat(c.split(",")[1]));
		expect(new Set(yValues).size).toBe(1);
	});

	it("handles a single value without division by zero", () => {
		const values = [42];
		const points = buildSparklinePoints(values, 450, 120, 20, 20);
		const coords = points.split(" ");
		expect(coords).toHaveLength(1);
		const [x, y] = coords[0].split(",").map(parseFloat);
		expect(Number.isFinite(x)).toBe(true);
		expect(Number.isFinite(y)).toBe(true);
	});
});

describe("buildBars", () => {
	it("returns empty string for empty values", () => {
		expect(buildBars([])).toBe("");
	});

	it("produces one rect per value", () => {
		const bars = buildBars([10, 20, 30]);
		const count = (bars.match(/<rect /g) || []).length;
		expect(count).toBe(3);
	});

	it("applies glow filter only to the last bar", () => {
		const bars = buildBars([10, 20, 30, 40]);
		const rects = bars.split("\n").map((r) => r.trim());
		expect(rects[rects.length - 1]).toContain('filter="url(#glow)"');
		rects.slice(0, -1).forEach((r) => {
			expect(r).not.toContain("filter=");
		});
	});

	it("scales bars so smallest has height 10 and tallest has height 70", () => {
		const bars = buildBars([0, 100]);
		// First bar: height = ((0-0)/100)*60 + 10 = 10
		expect(bars).toContain('height="10"');
		// Second bar: height = ((100-0)/100)*60 + 10 = 70
		expect(bars).toContain('height="70"');
	});

	it("handles a single value", () => {
		const bars = buildBars([42]);
		const count = (bars.match(/<rect /g) || []).length;
		expect(count).toBe(1);
		// Single value should still have filter (it's the last bar)
		expect(bars).toContain('filter="url(#glow)"');
	});
});

describe("generateSvg", () => {
	it("returns valid SVG markup with correct dimensions", () => {
		const data = [
			{ requests: 100, date: "2025-03-01" },
			{ requests: 200, date: "2025-03-02" },
			{ requests: 150, date: "2025-03-03" },
		];
		const svg = generateSvg(data, 150);
		expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
		expect(svg).toContain('width="480"');
		expect(svg).toContain('height="160"');
	});

	it("uses Cloudflare Orange in the bar gradient", () => {
		const data = [{ requests: 100, date: "2025-03-01" }];
		const svg = generateSvg(data, 100);
		expect(svg).toContain('stop-color="#F6821F"');
	});

	it("includes prefers-color-scheme media query for theme awareness", () => {
		const data = [{ requests: 100, date: "2025-03-01" }];
		const svg = generateSvg(data, 100);
		expect(svg).toContain("prefers-color-scheme: light");
	});

	it("displays formatted total requests", () => {
		const data = [
			{ requests: 1_000_000, date: "2025-03-01" },
			{ requests: 2_140_000, date: "2025-03-02" },
		];
		const svg = generateSvg(data, 3_140_000);
		expect(svg).toContain("3.14M");
	});

	it("contains bar chart rect elements", () => {
		const data = [
			{ requests: 10, date: "2025-03-01" },
			{ requests: 20, date: "2025-03-02" },
			{ requests: 30, date: "2025-03-03" },
		];
		const svg = generateSvg(data, 30);
		expect(svg).toContain('fill="url(#barGrad)"');
		const barCount = (svg.match(/fill="url\(#barGrad\)"/g) || []).length;
		expect(barCount).toBe(3);
	});

	it("includes the dot grid pattern", () => {
		const data = [{ requests: 100, date: "2025-03-01" }];
		const svg = generateSvg(data, 100);
		expect(svg).toContain('id="dotGrid"');
		expect(svg).toContain('fill="url(#dotGrid)"');
	});

	it("includes the glow filter and animated status indicator", () => {
		const data = [{ requests: 100, date: "2025-03-01" }];
		const svg = generateSvg(data, 100);
		expect(svg).toContain('id="glow"');
		expect(svg).toContain("<animate");
		expect(svg).toContain('fill="#22c55e"');
	});

	it("includes SYSTEM.STATUS header", () => {
		const data = [{ requests: 100, date: "2025-03-01" }];
		const svg = generateSvg(data, 100);
		expect(svg).toContain("SYSTEM.STATUS:");
		expect(svg).toContain("ONLINE");
	});

	it("derives subtitle from label", () => {
		const data = [{ requests: 100, date: "2025-03-01" }];
		const svg = generateSvg(data, 100);
		expect(svg).toContain("WEBSITE TRAFFIC / LAST 7 DAYS");
	});

	it("uses custom label for subtitle when provided", () => {
		const data = [{ requests: 100, date: "2025-03-01" }];
		const svg = generateSvg(data, 100, "Worker Requests (last 7 days)");
		expect(svg).toContain("WORKER REQUESTS / LAST 7 DAYS");
		expect(svg).not.toContain("WEBSITE TRAFFIC");
	});

	it("includes footer with system info", () => {
		const data = [{ requests: 100, date: "2025-03-01" }];
		const svg = generateSvg(data, 100);
		expect(svg).toContain("TYPE: EDGE_WORKER");
		expect(svg).toContain("UPTIME: 99.9%");
	});

	it("includes Y-axis labels showing max and min values", () => {
		const data = [
			{ requests: 1_000, date: "2025-03-01" },
			{ requests: 5_000, date: "2025-03-02" },
			{ requests: 3_000, date: "2025-03-03" },
		];
		const svg = generateSvg(data, 5_000);
		expect(svg).toContain("5K");
		expect(svg).toContain("1K");
		expect(svg).toContain('text-anchor="end"');
	});

	it("does not include Y-axis labels when data is empty", () => {
		const svg = generateSvg([], 0);
		expect(svg).not.toContain('text-anchor="end"');
	});

	it("does not include / 24H in subtitle", () => {
		const data = [{ requests: 100, date: "2025-03-01" }];
		const svg = generateSvg(data, 100);
		expect(svg).not.toContain("/ 24H");
	});
});

describe("generateErrorSvg", () => {
	it("returns SVG with error message", () => {
		const svg = generateErrorSvg("Something failed");
		expect(svg).toContain("Error: Something failed");
		expect(svg).toContain("<svg");
		expect(svg).toContain("</svg>");
	});
});

describe("getDateRange", () => {
	it("returns start and end as ISO date strings", () => {
		const { start, end } = getDateRange(7);
		expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it("start is 7 days before end by default", () => {
		const { start, end } = getDateRange();
		const diff = new Date(end).getTime() - new Date(start).getTime();
		expect(diff).toBe(7 * 24 * 60 * 60 * 1000);
	});

	it("respects custom day count", () => {
		const { start, end } = getDateRange(14);
		const diff = new Date(end).getTime() - new Date(start).getTime();
		expect(diff).toBe(14 * 24 * 60 * 60 * 1000);
	});
});

// ---------------------------------------------------------------------------
// resolveTheme
// ---------------------------------------------------------------------------
describe("resolveTheme", () => {
	it('returns "neon" for root path', () => {
		expect(resolveTheme("/")).toBe("neon");
	});

	it('returns "neon" for empty path', () => {
		expect(resolveTheme("")).toBe("neon");
	});

	it('returns "minimal" for /minimal', () => {
		expect(resolveTheme("/minimal")).toBe("minimal");
	});

	it('returns "gradient" for /gradient', () => {
		expect(resolveTheme("/gradient")).toBe("gradient");
	});

	it("is case-insensitive", () => {
		expect(resolveTheme("/Minimal")).toBe("minimal");
		expect(resolveTheme("/GRADIENT")).toBe("gradient");
	});

	it('returns "neon" for unknown paths', () => {
		expect(resolveTheme("/unknown")).toBe("neon");
		expect(resolveTheme("/foo/bar")).toBe("neon");
	});

	it("handles trailing slashes", () => {
		expect(resolveTheme("/minimal/")).toBe("minimal");
		expect(resolveTheme("/gradient/")).toBe("gradient");
	});
});

// ---------------------------------------------------------------------------
// buildAreaChart
// ---------------------------------------------------------------------------
describe("buildAreaChart", () => {
	it("returns empty string for empty values", () => {
		expect(buildAreaChart([], 430, 65)).toBe("");
	});

	it("produces polygon and polyline elements", () => {
		const chart = buildAreaChart([10, 20, 30], 430, 65);
		expect(chart).toContain("<polygon");
		expect(chart).toContain("<polyline");
	});

	it("uses areaFill gradient for polygon", () => {
		const chart = buildAreaChart([10, 20], 430, 65);
		expect(chart).toContain('fill="url(#areaFill)"');
	});

	it("uses var(--line) stroke for polyline", () => {
		const chart = buildAreaChart([10, 20], 430, 65);
		expect(chart).toContain('stroke="var(--line)"');
	});

	it("handles a single value", () => {
		const chart = buildAreaChart([42], 430, 65);
		expect(chart).toContain("<polygon");
		expect(chart).toContain("<polyline");
	});
});

// ---------------------------------------------------------------------------
// buildHorizontalBars
// ---------------------------------------------------------------------------
describe("buildHorizontalBars", () => {
	it("returns empty string for empty data", () => {
		expect(buildHorizontalBars([])).toBe("");
	});

	it("produces one rect per data point", () => {
		const data = [
			{ requests: 100, date: "2025-03-01" },
			{ requests: 200, date: "2025-03-02" },
			{ requests: 300, date: "2025-03-03" },
		];
		const bars = buildHorizontalBars(data);
		const count = (bars.match(/<rect /g) || []).length;
		expect(count).toBe(3);
	});

	it("includes day-of-week labels", () => {
		const data = [
			{ requests: 100, date: "2025-03-01" }, // Saturday
			{ requests: 200, date: "2025-03-02" }, // Sunday
		];
		const bars = buildHorizontalBars(data);
		expect(bars).toContain("Sat");
		expect(bars).toContain("Sun");
	});

	it("includes formatted value labels", () => {
		const data = [{ requests: 12400, date: "2025-03-01" }];
		const bars = buildHorizontalBars(data);
		expect(bars).toContain("12.4K");
	});

	it("uses horizontal gradient fill", () => {
		const data = [{ requests: 100, date: "2025-03-01" }];
		const bars = buildHorizontalBars(data);
		expect(bars).toContain('fill="url(#hGrad)"');
	});
});

// ---------------------------------------------------------------------------
// generateSvgMinimal (Minimal — sparkline area chart card)
// ---------------------------------------------------------------------------
describe("generateSvgMinimal", () => {
	const sampleData = [
		{ requests: 100, date: "2025-03-01" },
		{ requests: 200, date: "2025-03-02" },
		{ requests: 150, date: "2025-03-03" },
	];

	it("returns valid SVG with correct dimensions", () => {
		const svg = generateSvgMinimal(sampleData, 450);
		expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
		expect(svg).toContain('width="480"');
		expect(svg).toContain('height="160"');
	});

	it("uses emerald/green line color via CSS variable", () => {
		const svg = generateSvgMinimal(sampleData, 450);
		expect(svg).toContain("--line: #10b981");
	});

	it("supports dark mode via prefers-color-scheme", () => {
		const svg = generateSvgMinimal(sampleData, 450);
		expect(svg).toContain("prefers-color-scheme: dark");
	});

	it("displays formatted total requests", () => {
		const svg = generateSvgMinimal(sampleData, 3_140_000);
		expect(svg).toContain("3.14M");
	});

	it("derives name and period from label", () => {
		const svg = generateSvgMinimal(sampleData, 450, "Worker Requests (last 7 days)");
		expect(svg).toContain("WORKER REQUESTS");
		expect(svg).toContain("last 7 days");
	});

	it("contains Cloudflare Analytics footer", () => {
		const svg = generateSvgMinimal(sampleData, 450);
		expect(svg).toContain("Cloudflare Analytics");
	});

	it("uses area chart with polygon and polyline", () => {
		const svg = generateSvgMinimal(sampleData, 450);
		expect(svg).toContain("<polygon");
		expect(svg).toContain("<polyline");
		expect(svg).toContain('fill="url(#areaFill)"');
	});

	it("does not include dot grid or glow filter", () => {
		const svg = generateSvgMinimal(sampleData, 450);
		expect(svg).not.toContain("dotGrid");
		expect(svg).not.toContain('id="glow"');
	});

	it("does not include vertical bar chart rects", () => {
		const svg = generateSvgMinimal(sampleData, 450);
		expect(svg).not.toContain('fill="url(#barGrad)"');
	});
});

// ---------------------------------------------------------------------------
// generateSvgGradient (Gradient — horizontal daily bars panel)
// ---------------------------------------------------------------------------
describe("generateSvgGradient", () => {
	const sampleData = [
		{ requests: 100, date: "2025-03-01" },
		{ requests: 200, date: "2025-03-02" },
		{ requests: 150, date: "2025-03-03" },
	];

	it("returns valid SVG with correct dimensions", () => {
		const svg = generateSvgGradient(sampleData, 450);
		expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
		expect(svg).toContain('width="480"');
		expect(svg).toContain('height="160"');
	});

	it("uses gradient background", () => {
		const svg = generateSvgGradient(sampleData, 450);
		expect(svg).toContain('id="gradBg"');
		expect(svg).toContain('fill="url(#gradBg)"');
	});

	it("supports light mode via prefers-color-scheme", () => {
		const svg = generateSvgGradient(sampleData, 450);
		expect(svg).toContain("prefers-color-scheme: light");
	});

	it("displays formatted total requests", () => {
		const svg = generateSvgGradient(sampleData, 3_140_000);
		expect(svg).toContain("3.14M");
	});

	it("derives name and period from label", () => {
		const svg = generateSvgGradient(sampleData, 450, "Worker Requests (last 7 days)");
		expect(svg).toContain("WORKER REQUESTS");
		expect(svg).toContain("last 7 days");
	});

	it("uses horizontal bar chart layout", () => {
		const svg = generateSvgGradient(sampleData, 450);
		expect(svg).toContain('fill="url(#hGrad)"');
		const barCount = (svg.match(/fill="url\(#hGrad\)"/g) || []).length;
		expect(barCount).toBe(3);
	});

	it("includes day labels in horizontal bars", () => {
		const svg = generateSvgGradient(sampleData, 450);
		// 2025-03-01 is Saturday
		expect(svg).toContain("Sat");
	});

	it("includes animated status indicator", () => {
		const svg = generateSvgGradient(sampleData, 450);
		expect(svg).toContain("<animate");
	});

	it("contains Edge Analytics footer", () => {
		const svg = generateSvgGradient(sampleData, 450);
		expect(svg).toContain("Edge Analytics");
	});

	it("does not include vertical bar chart or dot grid", () => {
		const svg = generateSvgGradient(sampleData, 450);
		expect(svg).not.toContain('fill="url(#barGrad)"');
		expect(svg).not.toContain("dotGrid");
	});
});

// ---------------------------------------------------------------------------
// generateSvgForTheme (dispatcher)
// ---------------------------------------------------------------------------
describe("generateSvgForTheme", () => {
	const sampleData = [
		{ requests: 100, date: "2025-03-01" },
		{ requests: 200, date: "2025-03-02" },
	];

	it('returns neon theme SVG for "neon"', () => {
		const svg = generateSvgForTheme("neon", sampleData, 300, "Website Traffic (last 7 days)");
		expect(svg).toContain("SYSTEM.STATUS:");
		expect(svg).toContain('id="dotGrid"');
	});

	it('returns minimal theme SVG for "minimal"', () => {
		const svg = generateSvgForTheme("minimal", sampleData, 300, "Website Traffic (last 7 days)");
		expect(svg).toContain('id="areaFill"');
		expect(svg).not.toContain("SYSTEM.STATUS:");
	});

	it('returns gradient theme SVG for "gradient"', () => {
		const svg = generateSvgForTheme("gradient", sampleData, 300, "Website Traffic (last 7 days)");
		expect(svg).toContain('id="gradBg"');
		expect(svg).not.toContain("SYSTEM.STATUS:");
	});
});

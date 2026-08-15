export interface Env {
	CF_API_TOKEN: string;
	CF_ZONE_ID?: string;
	CF_ACCOUNT_ID?: string;
}

interface RequestData {
	requests: number;
	date: string;
	bytes?: number;
	uniques?: number;
}

/** Aggregate statistics derived from daily request data. */
export interface TrafficStats {
	total: number;
	avg: number;
	peak: number;
	bytes?: number;
	uniques?: number;
}

interface ZoneGraphQLResponse {
	data?: {
		viewer: {
			zones: Array<{
				httpRequests1dGroups: Array<{
					sum: { requests: number; bytes: number };
					uniq: { uniques: number };
					dimensions: { date: string };
				}>;
			}>;
		};
	};
	errors?: Array<{ message: string }>;
}

interface WorkerEventsGraphQLResponse {
	data?: {
		viewer: {
			accounts: Array<{
				workersInvocationsAdaptive: Array<{
					sum: { requests: number; responseBodySize: number };
					dimensions: { date: string };
				}>;
			}>;
		};
	};
	errors?: Array<{ message: string }>;
}

/** Format a number into a compact human-readable string (e.g. 2140000 → "2.14M"). */
export function formatNumber(n: number): string {
	if (n >= 1_000_000_000) {
		return (n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, "") + "B";
	}
	if (n >= 1_000_000) {
		return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "M";
	}
	if (n >= 1_000) {
		return (n / 1_000).toFixed(2).replace(/\.?0+$/, "") + "K";
	}
	return n.toString();
}

/** Format a byte count into a compact human-readable string (e.g. 1240000000 → "1.24GB"). */
export function formatBytes(n: number): string {
	if (n >= 1e12) {
		return (n / 1e12).toFixed(2).replace(/\.?0+$/, "") + "TB";
	}
	if (n >= 1e9) {
		return (n / 1e9).toFixed(2).replace(/\.?0+$/, "") + "GB";
	}
	if (n >= 1e6) {
		return (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "MB";
	}
	if (n >= 1e3) {
		return (n / 1e3).toFixed(2).replace(/\.?0+$/, "") + "KB";
	}
	return n + "B";
}

/** Parse a ?days= query value into a day count, clamped to 1–30. Defaults to 7. */
export function parseDays(value: string | null): number {
	const n = Number.parseInt(value ?? "", 10);
	if (Number.isNaN(n)) return 7;
	return Math.min(30, Math.max(1, n));
}

/** Compute aggregate stats (total, avg/day, peak day, bandwidth, uniques) from daily data. */
export function computeStats(data: RequestData[]): TrafficStats {
	const total = data.reduce((sum, d) => sum + d.requests, 0);
	const avg = data.length > 0 ? Math.round(total / data.length) : 0;
	const peak =
		data.length > 0 ? Math.max(...data.map((d) => d.requests)) : 0;
	const hasBytes = data.some((d) => typeof d.bytes === "number");
	const bytes = hasBytes
		? data.reduce((sum, d) => sum + (d.bytes ?? 0), 0)
		: undefined;
	const hasUniques = data.some((d) => typeof d.uniques === "number");
	const uniques = hasUniques
		? data.reduce((sum, d) => sum + (d.uniques ?? 0), 0)
		: undefined;
	return { total, avg, peak, bytes, uniques };
}

/** Map an array of values to SVG polyline coordinate strings within a given width/height. */
export function buildSparklinePoints(
	values: number[],
	width: number,
	height: number,
	paddingX: number,
	paddingY: number,
): string {
	if (values.length === 0) return "";
	const graphWidth = width - 2 * paddingX;
	const graphHeight = height - 2 * paddingY;
	const max = Math.max(...values);
	const min = Math.min(...values);
	const range = max - min || 1;
	const segmentCount = values.length > 1 ? values.length - 1 : 1;
	return values
		.map((v, i) => {
			const x = paddingX + (i / segmentCount) * graphWidth;
			const y = paddingY + graphHeight - ((v - min) / range) * graphHeight;
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		})
		.join(" ");
}

/** Compute start/end ISO date strings for the last N days (UTC, exclusive of today). */
export function getDateRange(days: number = 7): { start: string; end: string } {
	const now = new Date();
	const end = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
	return {
		start: start.toISOString().split("T")[0],
		end: end.toISOString().split("T")[0],
	};
}

/** Send a GraphQL query to the Cloudflare Analytics API and return the parsed JSON. */
async function cfGraphQL<T>(apiToken: string, query: string): Promise<T> {
	const resp = await fetch("https://api.cloudflare.com/client/v4/graphql", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ query }),
	});
	return resp.json() as Promise<T>;
}

/** Fetch the last N days of HTTP request data from the Cloudflare GraphQL Analytics API (zone-level). */
async function fetchZoneRequestData(
	apiToken: string,
	zoneId: string,
	days: number = 7,
): Promise<RequestData[]> {
	const { start, end } = getDateRange(days);

	const query = `query {
  viewer {
    zones(filter: {zoneTag: "${zoneId}"}) {
      httpRequests1dGroups(
        limit: ${days}
        filter: {date_geq: "${start}", date_lt: "${end}"}
        orderBy: [date_ASC]
      ) {
        sum { requests bytes }
        uniq { uniques }
        dimensions { date }
      }
    }
  }
}`;

	const json = await cfGraphQL<ZoneGraphQLResponse>(apiToken, query);

	if (json.errors && json.errors.length > 0) {
		throw new Error(
			`Cloudflare API error: ${json.errors.map((e) => e.message).join(", ")}`,
		);
	}

	const groups =
		json.data?.viewer.zones[0]?.httpRequests1dGroups ?? [];
	return groups.map((g) => ({
		requests: g.sum.requests,
		bytes: g.sum.bytes,
		uniques: g.uniq.uniques,
		date: g.dimensions.date,
	}));
}

/** Fetch the last N days of Worker invocation data from the Cloudflare GraphQL Analytics API (account-level). */
async function fetchWorkerEventData(
	apiToken: string,
	accountId: string,
	days: number = 7,
): Promise<RequestData[]> {
	const { start, end } = getDateRange(days);

	const query = `query {
  viewer {
    accounts(filter: {accountTag: "${accountId}"}) {
      workersInvocationsAdaptive(
        limit: ${days}
        filter: {date_geq: "${start}", date_lt: "${end}"}
        orderBy: [date_ASC]
      ) {
        sum { requests responseBodySize }
        dimensions { date }
      }
    }
  }
}`;

	const json = await cfGraphQL<WorkerEventsGraphQLResponse>(apiToken, query);

	if (json.errors && json.errors.length > 0) {
		throw new Error(
			`Cloudflare API error: ${json.errors.map((e) => e.message).join(", ")}`,
		);
	}

	const groups =
		json.data?.viewer.accounts[0]?.workersInvocationsAdaptive ?? [];
	return groups.map((g) => ({
		requests: g.sum.requests,
		bytes: g.sum.responseBodySize,
		date: g.dimensions.date,
	}));
}

/** Build SVG <rect> elements for a bar chart from an array of values. Bars scale to fit chartWidth. */
export function buildBars(
	values: number[],
	preMin?: number,
	preMax?: number,
	chartWidth: number = 175,
): string {
	if (values.length === 0) return "";
	const max = preMax ?? Math.max(...values);
	const min = preMin ?? Math.min(...values);
	const range = max - min || 1;
	const slot = chartWidth / values.length;
	const barWidth = Math.max(2, Math.min(18, slot - 4));

	return values
		.map((val, i) => {
			const height = ((val - min) / range) * 60 + 10;
			const y = 80 - height;
			const x = (i * slot).toFixed(1);
			const opacity = (
				0.4 +
				(i / (values.length > 1 ? values.length - 1 : 1)) * 0.6
			).toFixed(2);
			const filter =
				i === values.length - 1 ? ' filter="url(#glow)"' : "";
			return `<rect x="${x}" y="${y}" width="${barWidth.toFixed(1)}" height="${height}" rx="3" fill="url(#barGrad)" opacity="${opacity}"${filter}/>`;
		})
		.join("\n      ");
}

/** Generate an error SVG for display when something goes wrong. */
export function generateErrorSvg(msg: string): string {
	return `<svg width="400" height="100" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#fff5f5" rx="10" stroke="#feb2b2"/>
  <text x="20" y="55" font-family="sans-serif" fill="#c53030">Error: ${msg}</text>
</svg>`;
}

/** Supported theme names for the usage graph. */
export type ThemeOption =
	| "neon"
	| "minimal"
	| "gradient"
	| "dashboard"
	| "badge"
	| "heatmap"
	| "ticker";

/** Resolve a URL pathname to a ThemeOption. Returns "neon" for unknown paths. */
export function resolveTheme(pathname: string): ThemeOption {
	const cleaned = pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
	if (cleaned === "minimal") return "minimal";
	if (cleaned === "gradient") return "gradient";
	if (cleaned === "dashboard") return "dashboard";
	if (cleaned === "badge") return "badge";
	if (cleaned === "heatmap") return "heatmap";
	if (cleaned === "ticker") return "ticker";
	return "neon";
}

/** Shared helper: extract subtitle parts from a label string. */
function parseLabel(label: string): { name: string; period: string; subtitle: string } {
	const name = label.replace(/\s*\(.*\)/, "").toUpperCase();
	const periodMatch = label.match(/\((.+?)\)/);
	const period = periodMatch
		? periodMatch[1].trim().toUpperCase()
		: "LAST 7 DAYS";
	return { name, period, subtitle: `${name} / ${period}` };
}

/** Generate the SVG string for the usage graph (Option 1 — Neon Terminal theme). */
export function generateSvg(
	data: RequestData[],
	totalRequests: number,
	label: string = "Website Traffic (last 7 days)",
): string {
	const values = data.map((d) => d.requests);
	const formattedTotal = formatNumber(totalRequests);
	const maxVal = values.length > 0 ? Math.max(...values) : 0;
	const minVal = values.length > 0 ? Math.min(...values) : 0;
	const bars = buildBars(values, minVal, maxVal);
	const { subtitle } = parseLabel(label);
	const stats = computeStats(data);
	const statParts = [
		`AVG: ${formatNumber(stats.avg)}/D`,
		`PEAK: ${formatNumber(stats.peak)}`,
	];
	if (stats.bytes !== undefined) statParts.push(`BW: ${formatBytes(stats.bytes)}`);
	if (stats.uniques !== undefined) statParts.push(`UNIQ: ${formatNumber(stats.uniques)}`);
	const statsLine = statParts.join(" // ");

	// Y-axis labels for bar chart
	const maxLabel = formatNumber(maxVal);
	const minLabel = formatNumber(minVal);
	const yAxisLabels =
		values.length > 0
			? `<text x="-5" y="15" class="mono" font-size="8" fill="var(--text-s)" text-anchor="end">${maxLabel}</text>
      <text x="-5" y="80" class="mono" font-size="8" fill="var(--text-s)" text-anchor="end">${minLabel}</text>`
			: "";

	return `<svg width="480" height="160" viewBox="0 0 480 160" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="dotGrid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1" fill="var(--grid-color, #30363d)"/>
    </pattern>
    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="100%">
      <stop offset="0%" stop-color="#F6821F"/>
      <stop offset="100%" stop-color="#FBAD66"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
    <style>
      :root { --bg: #0d1117; --grid-color: #30363d; --text-p: #ffffff; --text-s: #768390; --brd: #30363d; }
      @media (prefers-color-scheme: light) {
        :root { --bg: #ffffff; --grid-color: #d0d7de; --text-p: #24292f; --text-s: #57606a; --brd: #d0d7de; }
      }
      .mono { font-family: ui-monospace, SFMono-Regular, monospace; }
      .sans { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    </style>
  </defs>

  <rect width="480" height="160" rx="12" fill="var(--bg)"/>
  <rect width="480" height="160" rx="12" fill="url(#dotGrid)"/>
  <rect x="0.5" y="0.5" width="479" height="159" rx="11.5" stroke="var(--brd)" fill="none"/>
  <path d="M 400 0 L 480 0 L 480 60" stroke="#F6821F" stroke-width="2" fill="none" opacity="0.6"/>

  <g transform="translate(25, 35)">
    <text class="mono" font-size="12" fill="#F6821F" font-weight="bold" letter-spacing="2">SYSTEM.STATUS: <tspan fill="#22c55e">ONLINE</tspan></text>
    <text y="45" class="sans" font-size="42" font-weight="800" fill="var(--text-p)" filter="url(#glow)">${formattedTotal}</text>
    <text y="70" class="mono" font-size="11" fill="var(--text-s)">${subtitle}</text>
  </g>

  <g transform="translate(280, 50)">
    ${yAxisLabels}
    ${bars}
  </g>

  <g transform="translate(25, 140)">
    <text class="mono" font-size="9" fill="var(--text-s)">${statsLine}</text>
  </g>

  <circle cx="455" cy="25" r="4" fill="#22c55e">
    <animate attributeName="opacity" values="1;0.2;1" dur="2s" repeatCount="indefinite"/>
  </circle>
</svg>`;
}

/** Build an SVG area chart (filled polygon + sparkline) from an array of values. */
export function buildAreaChart(
	values: number[],
	width: number,
	height: number,
): string {
	if (values.length === 0) return "";
	const points = buildSparklinePoints(values, width, height, 0, 5);
	const coords = points.split(" ");
	const firstX = coords[0].split(",")[0];
	const lastX = coords[coords.length - 1].split(",")[0];
	const bottomY = height.toFixed(1);
	const polygonPoints = `${points} ${lastX},${bottomY} ${firstX},${bottomY}`;
	return `<polygon points="${polygonPoints}" fill="url(#areaFill)" opacity="0.3"/>
    <polyline points="${points}" fill="none" stroke="var(--line)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** Generate the SVG string for the usage graph (Minimal — sparkline area chart card). */
export function generateSvgMinimal(
	data: RequestData[],
	totalRequests: number,
	label: string = "Website Traffic (last 7 days)",
): string {
	const values = data.map((d) => d.requests);
	const formattedTotal = formatNumber(totalRequests);
	const chart = buildAreaChart(values, 430, 65);
	const { name, period } = parseLabel(label);
	const stats = computeStats(data);
	const statParts = [
		`avg ${formatNumber(stats.avg)}/day`,
		`peak ${formatNumber(stats.peak)}`,
	];
	if (stats.bytes !== undefined) statParts.push(formatBytes(stats.bytes));
	if (stats.uniques !== undefined) statParts.push(`${formatNumber(stats.uniques)} visitors`);
	const statsLine = statParts.join(" \u00b7 ");

	return `<svg width="480" height="160" viewBox="0 0 480 160" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="100%">
      <stop offset="0%" stop-color="var(--line)"/>
      <stop offset="100%" stop-color="var(--line)" stop-opacity="0"/>
    </linearGradient>
    <style>
      :root { --bg: #ffffff; --text-p: #1a1a2e; --text-s: #6c6c8a; --brd: #e2e2f0; --line: #10b981; }
      @media (prefers-color-scheme: dark) {
        :root { --bg: #1a1a2e; --text-p: #e2e2f0; --text-s: #9999b3; --brd: #2d2d4a; --line: #34d399; }
      }
      .sans { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    </style>
  </defs>

  <rect width="480" height="160" rx="12" fill="var(--bg)"/>
  <rect x="0.5" y="0.5" width="479" height="159" rx="11.5" stroke="var(--brd)" fill="none"/>

  <g transform="translate(25, 22)">
    <text class="sans" font-size="11" font-weight="600" fill="var(--line)" letter-spacing="1">${name}</text>
    <text y="26" class="sans" font-size="30" font-weight="700" fill="var(--text-p)">${formattedTotal}</text>
    <text y="42" class="sans" font-size="10" fill="var(--text-s)">${period.toLowerCase()}</text>
  </g>

  <g transform="translate(25, 75)">
    ${chart}
  </g>

  <g transform="translate(25, 152)">
    <text class="sans" font-size="9" fill="var(--text-s)">Cloudflare Analytics</text>
    <text x="430" class="sans" font-size="9" fill="var(--text-s)" text-anchor="end">${statsLine}</text>
  </g>
</svg>`;
}

/** Build SVG horizontal bar rows from data, each row contains a day label, bar, and value. Rows scale to fit chartHeight. */
export function buildHorizontalBars(
	data: RequestData[],
	chartHeight: number = 119,
): string {
	if (data.length === 0) return "";
	const max = Math.max(...data.map((d) => d.requests));
	const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const barMaxWidth = 150;
	const rowHeight = Math.min(17, chartHeight / data.length);
	const barHeight = Math.max(3, Math.round(rowHeight * 0.6));
	const labelFontSize = rowHeight >= 12 ? 8 : 6;
	const valueFontSize = rowHeight >= 12 ? 7 : 6;
	const textOffset = Math.min(9, barHeight + 2);
	return data
		.map((d, i) => {
			const w = max > 0 ? (d.requests / max) * barMaxWidth : 0;
			const y = i * rowHeight;
			const date = new Date(d.date + "T00:00:00Z");
			const dayLabel = days[date.getUTCDay()];
			const valueLabel = formatNumber(d.requests);
			const opacity = (
				0.5 +
				(i / (data.length > 1 ? data.length - 1 : 1)) * 0.5
			).toFixed(2);
			return `<text x="0" y="${(y + textOffset).toFixed(1)}" class="sans" font-size="${labelFontSize}" fill="var(--text-s)">${dayLabel}</text>
      <rect x="28" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${barHeight}" rx="${Math.min(4, barHeight / 2)}" fill="url(#hGrad)" opacity="${opacity}"/>
      <text x="${(28 + w + 5).toFixed(1)}" y="${(y + textOffset).toFixed(1)}" class="sans" font-size="${valueFontSize}" fill="var(--text-s)">${valueLabel}</text>`;
		})
		.join("\n      ");
}

/** Generate the SVG string for the usage graph (Gradient — horizontal daily bars panel). */
export function generateSvgGradient(
	data: RequestData[],
	totalRequests: number,
	label: string = "Website Traffic (last 7 days)",
): string {
	const formattedTotal = formatNumber(totalRequests);
	const bars = buildHorizontalBars(data);
	const { name, period } = parseLabel(label);
	const stats = computeStats(data);
	const statsLine1 = `avg ${formatNumber(stats.avg)}/day \u00b7 peak ${formatNumber(stats.peak)}`;
	const extraParts: string[] = [];
	if (stats.bytes !== undefined) extraParts.push(formatBytes(stats.bytes));
	if (stats.uniques !== undefined) extraParts.push(`${formatNumber(stats.uniques)} visitors`);
	const statsLine2 = extraParts.join(" \u00b7 ");

	return `<svg width="480" height="160" viewBox="0 0 480 160" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gradBg" x1="0" y1="0" x2="480" y2="160" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="var(--g1)"/>
      <stop offset="100%" stop-color="var(--g2)"/>
    </linearGradient>
    <linearGradient id="hGrad" x1="0" y1="0" x2="100%" y2="0">
      <stop offset="0%" stop-color="var(--bar-from)"/>
      <stop offset="100%" stop-color="var(--bar-to)"/>
    </linearGradient>
    <style>
      :root {
        --g1: #0f0c29; --g2: #1a1a40; --text-p: #f0f0ff; --text-s: #8888aa;
        --brd: #2e2e5a; --bar-from: #00d2ff; --bar-to: #7b2ff7;
      }
      @media (prefers-color-scheme: light) {
        :root {
          --g1: #f8f9ff; --g2: #eef0ff; --text-p: #1a1a2e; --text-s: #6c6c8a;
          --brd: #d4d4f0; --bar-from: #3b82f6; --bar-to: #8b5cf6;
        }
      }
      .sans { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    </style>
  </defs>

  <rect width="480" height="160" rx="12" fill="url(#gradBg)"/>
  <rect x="0.5" y="0.5" width="479" height="159" rx="11.5" stroke="var(--brd)" fill="none"/>

  <g transform="translate(25, 18)">
    <text class="sans" font-size="10" font-weight="600" fill="var(--bar-to)" letter-spacing="0.5">${name}</text>
  </g>

  <g transform="translate(25, 62)">
    <text class="sans" font-size="38" font-weight="800" fill="var(--text-p)">${formattedTotal}</text>
    <text y="20" class="sans" font-size="10" fill="var(--text-s)">${period.toLowerCase()}</text>
    <text y="38" class="sans" font-size="9" fill="var(--text-s)">${statsLine1}</text>
    <text y="52" class="sans" font-size="9" fill="var(--text-s)">${statsLine2}</text>
  </g>

  <g transform="translate(240, 18)">
    ${bars}
  </g>

  <g transform="translate(25, 150)">
    <text class="sans" font-size="9" fill="var(--text-s)">Edge Analytics // Global CDN</text>
  </g>

  <circle cx="455" cy="20" r="4" fill="var(--bar-to)">
    <animate attributeName="opacity" values="1;0.3;1" dur="2.5s" repeatCount="indefinite"/>
  </circle>
</svg>`;
}

/** Generate the SVG string for the usage graph (Dashboard — stat tile grid with sparkline). */
export function generateSvgDashboard(
	data: RequestData[],
	totalRequests: number,
	label: string = "Website Traffic (last 7 days)",
): string {
	const values = data.map((d) => d.requests);
	const formattedTotal = formatNumber(totalRequests);
	const { name, period } = parseLabel(label);
	const stats = computeStats(data);
	const spark = buildSparklinePoints(values, 195, 35, 0, 4);

	const tiles: Array<{ label: string; value: string }> = [
		{ label: "AVG / DAY", value: formatNumber(stats.avg) },
		{ label: "PEAK DAY", value: formatNumber(stats.peak) },
		{
			label: "BANDWIDTH",
			value: stats.bytes !== undefined ? formatBytes(stats.bytes) : "N/A",
		},
		{
			label: "VISITORS",
			value:
				stats.uniques !== undefined
					? formatNumber(stats.uniques)
					: "N/A",
		},
	];
	const tileW = 100;
	const tileH = 52;
	const tileSvg = tiles
		.map((t, i) => {
			const x = 250 + (i % 2) * (tileW + 8);
			const y = 24 + Math.floor(i / 2) * (tileH + 8);
			return `<g transform="translate(${x}, ${y})">
      <rect width="${tileW}" height="${tileH}" rx="8" fill="var(--tile)" stroke="var(--brd)"/>
      <text x="10" y="18" class="sans" font-size="8" font-weight="600" fill="var(--accent)" letter-spacing="1">${t.label}</text>
      <text x="10" y="38" class="sans" font-size="15" font-weight="700" fill="var(--text-p)">${t.value}</text>
    </g>`;
		})
		.join("\n  ");

	const sparkline = spark
		? `<polyline points="${spark}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
		: "";

	return `<svg width="480" height="160" viewBox="0 0 480 160" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      :root { --bg: #0f172a; --tile: #1e293b; --text-p: #f1f5f9; --text-s: #94a3b8; --brd: #334155; --accent: #818cf8; }
      @media (prefers-color-scheme: light) {
        :root { --bg: #ffffff; --tile: #f1f5f9; --text-p: #0f172a; --text-s: #64748b; --brd: #e2e8f0; --accent: #6366f1; }
      }
      .sans { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    </style>
  </defs>

  <rect width="480" height="160" rx="12" fill="var(--bg)"/>
  <rect x="0.5" y="0.5" width="479" height="159" rx="11.5" stroke="var(--brd)" fill="none"/>

  <g transform="translate(25, 34)">
    <text class="sans" font-size="10" font-weight="600" fill="var(--accent)" letter-spacing="1">${name}</text>
    <text y="34" class="sans" font-size="34" font-weight="800" fill="var(--text-p)">${formattedTotal}</text>
    <text y="52" class="sans" font-size="10" fill="var(--text-s)">${period.toLowerCase()}</text>
  </g>

  <g transform="translate(25, 105)">
    ${sparkline}
  </g>

  <g transform="translate(25, 152)">
    <text class="sans" font-size="9" fill="var(--text-s)">Cloudflare Analytics</text>
  </g>

  ${tileSvg}
</svg>`;
}

/** Extract a short period suffix (e.g. "7d") from a label period like "last 7 days". */
function shortPeriod(period: string): string {
	const match = period.match(/(\d+)/);
	return match ? `${match[1]}d` : "7d";
}

/** Generate the SVG string for the usage graph (Badge — shields.io-style compact pill). */
export function generateSvgBadge(
	data: RequestData[],
	totalRequests: number,
	label: string = "Website Traffic (last 7 days)",
): string {
	const { name, period } = parseLabel(label);
	const labelText = `\u26a1 ${name.toLowerCase()} \u00b7 ${shortPeriod(period)}`;
	const valueText = formatNumber(totalRequests);

	const labelWidth = Math.round(labelText.length * 6.2 + 20);
	const valueWidth = Math.round(valueText.length * 7.5 + 20);
	const width = labelWidth + valueWidth;

	return `<svg width="${width}" height="28" viewBox="0 0 ${width} 28" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${labelText}: ${valueText}">
  <defs>
    <clipPath id="pill"><rect width="${width}" height="28" rx="6"/></clipPath>
  </defs>
  <g clip-path="url(#pill)">
    <rect width="${labelWidth}" height="28" fill="#2f363d"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="28" fill="#F6821F"/>
  </g>
  <g font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
    <text x="${labelWidth / 2}" y="18.5" fill="#010101" fill-opacity="0.3">${labelText}</text>
    <text x="${labelWidth / 2}" y="17.5" fill="#ffffff">${labelText}</text>
    <text x="${labelWidth + valueWidth / 2}" y="18.5" fill="#010101" fill-opacity="0.3" font-weight="bold">${valueText}</text>
    <text x="${labelWidth + valueWidth / 2}" y="17.5" fill="#ffffff" font-weight="bold">${valueText}</text>
  </g>
</svg>`;
}

/** Build GitHub-contribution-style heatmap cells from daily data. Rows are weekdays (Sun–Sat), columns are weeks. */
export function buildHeatmapCells(
	data: RequestData[],
	cellSize: number = 14,
	gap: number = 3,
): string {
	if (data.length === 0) return "";
	const max = Math.max(...data.map((d) => d.requests));
	const firstDay = new Date(data[0].date + "T00:00:00Z").getUTCDay();
	return data
		.map((d, i) => {
			const idx = i + firstDay;
			const col = Math.floor(idx / 7);
			const row = idx % 7;
			const ratio = max > 0 ? d.requests / max : 0;
			const level =
				ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
			const x = col * (cellSize + gap);
			const y = row * (cellSize + gap);
			return `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="3" fill="var(--h${level})"><title>${d.date}: ${formatNumber(d.requests)} requests</title></rect>`;
		})
		.join("\n      ");
}

/** Generate the SVG string for the usage graph (Heatmap — contribution-graph style). */
export function generateSvgHeatmap(
	data: RequestData[],
	totalRequests: number,
	label: string = "Website Traffic (last 7 days)",
): string {
	const formattedTotal = formatNumber(totalRequests);
	const { name, period } = parseLabel(label);
	const stats = computeStats(data);
	const cells = buildHeatmapCells(data);
	const statParts = [
		`avg ${formatNumber(stats.avg)}/day`,
		`peak ${formatNumber(stats.peak)}`,
	];
	if (stats.bytes !== undefined) statParts.push(formatBytes(stats.bytes));
	const statsLine = statParts.join(" \u00b7 ");

	return `<svg width="480" height="160" viewBox="0 0 480 160" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      :root {
        --bg: #0d1117; --text-p: #f0f6fc; --text-s: #8b949e; --brd: #30363d;
        --accent: #39d353; --h1: #0e4429; --h2: #006d32; --h3: #26a641; --h4: #39d353;
      }
      @media (prefers-color-scheme: light) {
        :root {
          --bg: #ffffff; --text-p: #1f2328; --text-s: #59636e; --brd: #d1d9e0;
          --accent: #216e39; --h1: #9be9a8; --h2: #40c463; --h3: #30a14e; --h4: #216e39;
        }
      }
      .sans { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    </style>
  </defs>

  <rect width="480" height="160" rx="12" fill="var(--bg)"/>
  <rect x="0.5" y="0.5" width="479" height="159" rx="11.5" stroke="var(--brd)" fill="none"/>

  <g transform="translate(25, 34)">
    <text class="sans" font-size="10" font-weight="600" fill="var(--accent)" letter-spacing="1">${name}</text>
    <text y="34" class="sans" font-size="34" font-weight="800" fill="var(--text-p)">${formattedTotal}</text>
    <text y="52" class="sans" font-size="10" fill="var(--text-s)">${period.toLowerCase()}</text>
    <text y="76" class="sans" font-size="9" fill="var(--text-s)">${statsLine}</text>
  </g>

  <g transform="translate(25, 146)" class="sans" font-size="8" fill="var(--text-s)">
    <text>less</text>
    <rect x="22" y="-8" width="10" height="10" rx="2" fill="var(--h1)"/>
    <rect x="36" y="-8" width="10" height="10" rx="2" fill="var(--h2)"/>
    <rect x="50" y="-8" width="10" height="10" rx="2" fill="var(--h3)"/>
    <rect x="64" y="-8" width="10" height="10" rx="2" fill="var(--h4)"/>
    <text x="80">more</text>
  </g>

  <g transform="translate(330, 22)">
    <g class="sans" font-size="8" fill="var(--text-s)">
      <text x="-6" y="28" text-anchor="end">Mon</text>
      <text x="-6" y="62" text-anchor="end">Wed</text>
      <text x="-6" y="96" text-anchor="end">Fri</text>
    </g>
    <g>
      ${cells}
    </g>
  </g>
</svg>`;
}

/** Build candlestick-style bars (green up / red down vs. previous day) from daily values. */
export function buildCandles(
	values: number[],
	chartWidth: number = 215,
	chartHeight: number = 80,
): string {
	if (values.length === 0) return "";
	const max = Math.max(...values);
	const min = Math.min(...values);
	const range = max - min || 1;
	const yFor = (v: number) =>
		chartHeight - 5 - ((v - min) / range) * (chartHeight - 10);
	const slot = chartWidth / values.length;
	const bodyWidth = Math.max(3, Math.min(18, slot - 8));
	return values
		.map((v, i) => {
			const prev = i > 0 ? values[i - 1] : v;
			const up = v >= prev;
			const color = up ? "var(--up)" : "var(--down)";
			const yTop = yFor(Math.max(prev, v));
			const yBottom = yFor(Math.min(prev, v));
			const bodyHeight = Math.max(2, yBottom - yTop);
			const cx = slot * i + slot / 2;
			const wickTop = Math.max(0, yTop - 4);
			const wickBottom = Math.min(chartHeight, yBottom + 4);
			return `<line x1="${cx.toFixed(1)}" y1="${wickTop.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${wickBottom.toFixed(1)}" stroke="${color}" stroke-width="2"/>
      <rect x="${(cx - bodyWidth / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bodyWidth.toFixed(1)}" height="${bodyHeight.toFixed(1)}" fill="${color}"/>`;
		})
		.join("\n      ");
}

/** Generate the SVG string for the usage graph (Ticker — stock-market candlestick style). */
export function generateSvgTicker(
	data: RequestData[],
	totalRequests: number,
	label: string = "Website Traffic (last 7 days)",
): string {
	const values = data.map((d) => d.requests);
	const formattedTotal = formatNumber(totalRequests);
	const { name, period } = parseLabel(label);
	const stats = computeStats(data);
	const candles = buildCandles(values);

	const tickerName = name.replace(/\s+/g, "/");
	const lo = values.length > 0 ? Math.min(...values) : 0;

	let changeLine = "";
	if (values.length >= 2) {
		const last = values[values.length - 1];
		const prev = values[values.length - 2];
		const pct = prev > 0 ? ((last - prev) / prev) * 100 : 0;
		const up = pct >= 0;
		const arrow = up ? "\u25b2" : "\u25bc";
		const sign = up ? "+" : "";
		changeLine = `<text x="25" y="86" class="mono" font-size="11" fill="${up ? "var(--up)" : "var(--down)"}">${arrow} ${sign}${pct.toFixed(1)}% vs prev day</text>`;
	}

	const footerParts = [
		`HI ${formatNumber(stats.peak)}`,
		`LO ${formatNumber(lo)}`,
	];
	if (stats.bytes !== undefined) footerParts.push(`VOL ${formatBytes(stats.bytes)}`);
	const footerLine = footerParts.join(" \u00b7 ");

	const slot = values.length > 0 ? 215 / values.length : 215;
	const dayLetters =
		slot >= 14
			? data
					.map((d, i) => {
						const day = new Date(d.date + "T00:00:00Z").getUTCDay();
						const letter = ["S", "M", "T", "W", "T", "F", "S"][day];
						const cx = (slot * i + slot / 2).toFixed(1);
						return `<text x="${cx}" y="97" class="mono" font-size="7" fill="var(--text-s)" text-anchor="middle">${letter}</text>`;
					})
					.join("\n      ")
			: "";

	return `<svg width="480" height="160" viewBox="0 0 480 160" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      :root {
        --bg: #0b0e11; --text-p: #eaecef; --text-s: #5e6673; --brd: #252a30;
        --up: #16c784; --down: #ea3943;
      }
      @media (prefers-color-scheme: light) {
        :root {
          --bg: #ffffff; --text-p: #16171a; --text-s: #707a8a; --brd: #e5e7eb;
          --up: #059669; --down: #dc2626;
        }
      }
      .mono { font-family: ui-monospace, SFMono-Regular, monospace; }
    </style>
  </defs>

  <rect width="480" height="160" rx="12" fill="var(--bg)"/>
  <rect x="0.5" y="0.5" width="479" height="159" rx="11.5" stroke="var(--brd)" fill="none"/>

  <text x="25" y="30" class="mono" font-size="11" font-weight="bold" fill="var(--text-p)">${tickerName} <tspan fill="var(--text-s)">\u00b7 ${shortPeriod(period).toUpperCase()}</tspan></text>
  <text x="25" y="66" class="mono" font-size="30" font-weight="800" fill="var(--text-p)">${formattedTotal}</text>
  ${changeLine}
  <text x="25" y="140" class="mono" font-size="9" fill="var(--text-s)">${footerLine}</text>

  <g transform="translate(240, 25)">
    <line x1="0" y1="25" x2="215" y2="25" stroke="var(--brd)" stroke-dasharray="3 3"/>
    <line x1="0" y1="55" x2="215" y2="55" stroke="var(--brd)" stroke-dasharray="3 3"/>
    <g>
      ${candles}
    </g>
    ${dayLetters}
  </g>
</svg>`;
}

/** Select the correct SVG generator for a given theme. */
export function generateSvgForTheme(
	theme: ThemeOption,
	data: RequestData[],
	totalRequests: number,
	label: string,
): string {
	switch (theme) {
		case "minimal":
			return generateSvgMinimal(data, totalRequests, label);
		case "gradient":
			return generateSvgGradient(data, totalRequests, label);
		case "dashboard":
			return generateSvgDashboard(data, totalRequests, label);
		case "badge":
			return generateSvgBadge(data, totalRequests, label);
		case "heatmap":
			return generateSvgHeatmap(data, totalRequests, label);
		case "ticker":
			return generateSvgTicker(data, totalRequests, label);
		default:
			return generateSvg(data, totalRequests, label);
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		try {
			const url = new URL(request.url);
			const isRefresh = url.searchParams.has("refresh");
			const theme = resolveTheme(url.pathname);
			const days = parseDays(url.searchParams.get("days"));

			let data: RequestData[];
			let label: string;

			if (env.CF_ZONE_ID) {
				data = await fetchZoneRequestData(env.CF_API_TOKEN, env.CF_ZONE_ID, days);
				label = `Website Traffic (last ${days} days)`;
			} else if (env.CF_ACCOUNT_ID) {
				data = await fetchWorkerEventData(env.CF_API_TOKEN, env.CF_ACCOUNT_ID, days);
				label = `Worker Requests (last ${days} days)`;
			} else {
				return new Response(
					"Error: CF_ZONE_ID or CF_ACCOUNT_ID must be set",
					{ status: 500 },
				);
			}

			const totalRequests =
				data.reduce((sum, d) => sum + d.requests, 0);

			const svg = generateSvgForTheme(theme, data, totalRequests, label);

			return new Response(svg, {
				headers: {
					"Content-Type": "image/svg+xml",
					"Cache-Control": isRefresh
						? "no-store, no-cache"
						: "public, max-age=3600",
				},
			});
		} catch (err: unknown) {
			const message =
				err instanceof Error ? err.message : "Unknown error";
			return new Response(generateErrorSvg(message), {
				status: 500,
				headers: { "Content-Type": "image/svg+xml" },
			});
		}
	},
};

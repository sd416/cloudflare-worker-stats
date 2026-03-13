export interface Env {
	CF_API_TOKEN: string;
	CF_ZONE_ID?: string;
	CF_ACCOUNT_ID?: string;
}

interface RequestData {
	requests: number;
	date: string;
}

interface ZoneGraphQLResponse {
	data?: {
		viewer: {
			zones: Array<{
				httpRequests1dGroups: Array<{
					sum: { requests: number };
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
					sum: { requests: number };
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

/** Fetch the last 7 days of HTTP request data from the Cloudflare GraphQL Analytics API (zone-level). */
async function fetchZoneRequestData(
	apiToken: string,
	zoneId: string,
): Promise<RequestData[]> {
	const { start, end } = getDateRange(7);

	const query = `query {
  viewer {
    zones(filter: {zoneTag: "${zoneId}"}) {
      httpRequests1dGroups(
        limit: 7
        filter: {date_geq: "${start}", date_lt: "${end}"}
        orderBy: [date_ASC]
      ) {
        sum { requests }
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
		date: g.dimensions.date,
	}));
}

/** Fetch the last 7 days of Worker invocation data from the Cloudflare GraphQL Analytics API (account-level). */
async function fetchWorkerEventData(
	apiToken: string,
	accountId: string,
): Promise<RequestData[]> {
	const { start, end } = getDateRange(7);

	const query = `query {
  viewer {
    accounts(filter: {accountTag: "${accountId}"}) {
      workersInvocationsAdaptive(
        limit: 7
        filter: {date_geq: "${start}", date_lt: "${end}"}
        orderBy: [date_ASC]
      ) {
        sum { requests }
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
		date: g.dimensions.date,
	}));
}

/** Build SVG <rect> elements for a bar chart from an array of values. */
export function buildBars(values: number[], preMin?: number, preMax?: number): string {
	if (values.length === 0) return "";
	const max = preMax ?? Math.max(...values);
	const min = preMin ?? Math.min(...values);
	const range = max - min || 1;

	return values
		.map((val, i) => {
			const height = ((val - min) / range) * 60 + 10;
			const y = 80 - height;
			const x = i * 25;
			const opacity = (
				0.4 +
				(i / (values.length > 1 ? values.length - 1 : 1)) * 0.6
			).toFixed(2);
			const filter =
				i === values.length - 1 ? ' filter="url(#glow)"' : "";
			return `<rect x="${x}" y="${y}" width="18" height="${height}" rx="3" fill="url(#barGrad)" opacity="${opacity}"${filter}/>`;
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
export type ThemeOption = "neon" | "minimal" | "gradient";

/** Resolve a URL pathname to a ThemeOption. Returns "neon" for unknown paths. */
export function resolveTheme(pathname: string): ThemeOption {
	const cleaned = pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
	if (cleaned === "minimal") return "minimal";
	if (cleaned === "gradient") return "gradient";
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
    <text class="mono" font-size="9" fill="var(--text-s)">TYPE: EDGE_WORKER // REGION: GLOBAL // UPTIME: 99.9%</text>
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
    <text class="sans" font-size="9" fill="var(--text-s)">Cloudflare Analytics // updated hourly</text>
  </g>
</svg>`;
}

/** Build SVG horizontal bar rows from data, each row contains a day label, bar, and value. */
export function buildHorizontalBars(data: RequestData[]): string {
	if (data.length === 0) return "";
	const max = Math.max(...data.map((d) => d.requests));
	const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const barMaxWidth = 150;
	const barHeight = 10;
	const rowHeight = 17;
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
			return `<text x="0" y="${y + 9}" class="sans" font-size="8" fill="var(--text-s)">${dayLabel}</text>
      <rect x="28" y="${y}" width="${w.toFixed(1)}" height="${barHeight}" rx="4" fill="url(#hGrad)" opacity="${opacity}"/>
      <text x="${(28 + w + 5).toFixed(1)}" y="${y + 9}" class="sans" font-size="7" fill="var(--text-s)">${valueLabel}</text>`;
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

			let data: RequestData[];
			let label: string;

			if (env.CF_ZONE_ID) {
				data = await fetchZoneRequestData(env.CF_API_TOKEN, env.CF_ZONE_ID);
				label = "Website Traffic (last 7 days)";
			} else if (env.CF_ACCOUNT_ID) {
				data = await fetchWorkerEventData(env.CF_API_TOKEN, env.CF_ACCOUNT_ID);
				label = "Worker Requests (last 7 days)";
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

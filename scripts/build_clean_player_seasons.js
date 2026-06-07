const path = require("node:path");
const {
  CLEAN_COLUMNS,
  normalizeGoalie,
  normalizeSkater,
  seasonIds,
  validateCleanRows,
  writeCsv,
} = require("./pipeline_common");

const BASE_URL = "https://api.nhle.com/stats/rest/en";

function parseArgs(argv) {
  const args = {
    startSeason: 19171918,
    endSeason: 20252026,
    output: path.join("data", "clean_player_seasons.csv"),
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--start-season") {
      args.startSeason = Number(value);
      i += 1;
    } else if (arg === "--end-season") {
      args.endSeason = Number(value);
      i += 1;
    } else if (arg === "--output") {
      args.output = value;
      i += 1;
    }
  }
  return args;
}

function endpointUrl(report, seasonId, start, limit) {
  const params = new URLSearchParams({
    isAggregate: "false",
    isGame: "false",
    start: String(start),
    limit: String(limit),
    cayenneExp: `gameTypeId=2 and seasonId=${seasonId}`,
  });
  return `${BASE_URL}${report}?${params.toString()}`;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "11-cups-nhl-data-pipeline/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`NHL API request failed ${response.status}: ${url}`);
  }
  return response.json();
}

async function fetchReport(report, seasonId) {
  try {
    const allRows = await fetchJson(endpointUrl(report, seasonId, 0, -1));
    if (Array.isArray(allRows.data)) return allRows.data;
  } catch (_error) {
    // Fall back to paginated requests below.
  }

  const pageSize = 1000;
  const rows = [];
  let total = Infinity;
  for (let start = 0; rows.length < total; start += pageSize) {
    const page = await fetchJson(endpointUrl(report, seasonId, start, pageSize));
    const data = Array.isArray(page.data) ? page.data : [];
    total = Number.isFinite(Number(page.total)) ? Number(page.total) : rows.length + data.length;
    rows.push(...data);
    if (data.length === 0) break;
  }
  return rows;
}

function realtimeKey(row) {
  return `${row.playerId}|${row.seasonId}|${row.teamAbbrevs || ""}`;
}

function joinRealtime(summaryRows, realtimeRows) {
  const realtimeByKey = new Map();
  for (const row of realtimeRows) {
    realtimeByKey.set(realtimeKey(row), row);
  }
  return summaryRows.map((row) => [row, realtimeByKey.get(realtimeKey(row))]);
}

async function buildCleanPlayerSeasons(options) {
  const rows = [];
  const ids = seasonIds(options.startSeason, options.endSeason);

  for (const seasonId of ids) {
    console.log(`Fetching ${seasonId}`);
    const [skaterSummary, skaterRealtime, goalieSummary] = await Promise.all([
      fetchReport("/skater/summary", seasonId),
      fetchReport("/skater/realtime", seasonId),
      fetchReport("/goalie/summary", seasonId),
    ]);

    for (const [summaryRow, realtimeRow] of joinRealtime(skaterSummary, skaterRealtime)) {
      const normalized = normalizeSkater(summaryRow, realtimeRow);
      if (normalized) rows.push(normalized);
    }

    for (const goalieRow of goalieSummary) {
      const normalized = normalizeGoalie(goalieRow);
      if (normalized) rows.push(normalized);
    }
  }

  rows.sort((a, b) => (
    Number(a.season_id) - Number(b.season_id) ||
    String(a.team).localeCompare(String(b.team)) ||
    String(a.player_name).localeCompare(String(b.player_name))
  ));
  validateCleanRows(rows);
  writeCsv(options.output, rows, CLEAN_COLUMNS);
  console.log(`Wrote ${rows.length} rows to ${options.output}`);
  return rows;
}

if (require.main === module) {
  buildCleanPlayerSeasons(parseArgs(process.argv)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildCleanPlayerSeasons,
  endpointUrl,
  fetchReport,
  joinRealtime,
};

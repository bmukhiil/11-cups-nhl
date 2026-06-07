const fs = require("node:fs");
const path = require("node:path");
const { readCsv, writeCsv, numeric } = require("./pipeline_common");

const CLEAN_COLUMNS = [
  "player_id",
  "player_name",
  "season",
  "season_id",
  "age",
  "team",
  "league",
  "position",
  "position_group",
  "games_played",
  "games_started",
  "goals",
  "assists",
  "points",
  "plus_minus",
  "wins",
  "losses",
  "save_percentage",
  "gaa",
  "ops",
  "dps",
  "gps",
  "ps",
  "raw_ps",
  "raw_ops",
  "raw_dps",
  "raw_gps",
  "historical_team",
  "team_name",
  "franchise_key",
  "franchise_name",
  "current_team",
  "franchise_status",
  "source",
];

const CARD_COLUMNS = [
  "card_id",
  "player_id",
  "player_name",
  "position_group",
  "position",
  "franchise_key",
  "historical_team",
  "team_name",
  "franchise_name",
  "current_team",
  "franchise_status",
  "card_type",
  "card_label",
  "start_season",
  "end_season",
  "selected_seasons",
  "season_count",
  "games_played_total",
  "raw_card_ps",
  "raw_card_ops",
  "raw_card_dps",
  "raw_card_gps",
  "era_bucket",
  "is_legend",
  "is_modern",
  "source",
];

const BOARD_COLUMNS = [
  "franchise_key",
  "board_pool_rank",
  "selection_type",
  "pool_priority",
  "draw_weight",
  ...CARD_COLUMNS.filter((column) => column !== "franchise_key"),
];

const TRACE_COLUMNS = [
  "timestamp_utc",
  "season_end_year",
  "season",
  "page_type",
  "url",
  "cache_path",
  "status",
  "http_status",
  "bytes",
  "attempt",
  "message",
];

const SKIPPED_SEASON_END_YEARS = new Set([
  2005,
]);

function parseArgs(argv) {
  const args = {
    startSeasonEndYear: 1918,
    endSeasonEndYear: 2026,
    franchiseMap: path.join("data", "franchise_map.csv"),
    cacheDir: path.join("data", "hockey_reference_cache"),
    cleanOutput: path.join("data", "hockey_reference_player_seasons_clean.csv"),
    windowsOutput: path.join("data", "hockey_reference_card_windows.csv"),
    playableOutput: path.join("data", "playable_cards_hockey_reference_raw.csv"),
    boardOutput: path.join("data", "team_board_pools_hockey_reference_raw.csv"),
    minSkaterGames: 65,
    minGoalieGames: 40,
    targetCardsPerFranchise: 100,
    historicalTargetPerFranchise: 30,
    historicalCutoffEndYear: 2000,
    maxCardsPerPlayerFranchise: 3,
    maxCardsPerPlayerTotal: 4,
    requestDelayMs: 15000,
    maxRetries: 4,
    downloadOnly: false,
    resumeDownload: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--start-season-end-year") {
      args.startSeasonEndYear = Number(value);
      index += 1;
    } else if (arg === "--end-season-end-year") {
      args.endSeasonEndYear = Number(value);
      index += 1;
    } else if (arg === "--franchise-map") {
      args.franchiseMap = value;
      index += 1;
    } else if (arg === "--cache-dir") {
      args.cacheDir = value;
      index += 1;
    } else if (arg === "--clean-output") {
      args.cleanOutput = value;
      index += 1;
    } else if (arg === "--windows-output") {
      args.windowsOutput = value;
      index += 1;
    } else if (arg === "--playable-output") {
      args.playableOutput = value;
      index += 1;
    } else if (arg === "--board-output") {
      args.boardOutput = value;
      index += 1;
    } else if (arg === "--request-delay-ms") {
      args.requestDelayMs = Number(value);
      index += 1;
    } else if (arg === "--max-retries") {
      args.maxRetries = Number(value);
      index += 1;
    } else if (arg === "--max-cards-per-player-total") {
      args.maxCardsPerPlayerTotal = Number(value);
      index += 1;
    } else if (arg === "--historical-target-per-franchise") {
      args.historicalTargetPerFranchise = Number(value);
      index += 1;
    } else if (arg === "--historical-cutoff-end-year") {
      args.historicalCutoffEndYear = Number(value);
      index += 1;
    } else if (arg === "--download-only") {
      args.downloadOnly = true;
    } else if (arg === "--resume-download") {
      args.resumeDownload = true;
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function seasonLabelFromEndYear(endYear) {
  return `${endYear - 1}-${String(endYear).slice(2)}`;
}

function seasonIdFromEndYear(endYear) {
  return Number(`${endYear - 1}${endYear}`);
}

function seasonStartFromSeasonId(seasonId) {
  return Number(String(seasonId).slice(0, 4));
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .trim();
}

function attrValue(html, attr) {
  const match = html.match(new RegExp(`${attr}="([^"]*)"`, "i"));
  return match ? match[1] : "";
}

function cellValue(rowHtml, dataStat) {
  const regex = new RegExp(`<t[dh][^>]*data-stat="${dataStat}"[^>]*>([\\s\\S]*?)<\\/t[dh]>`, "i");
  const match = rowHtml.match(regex);
  if (!match) return "";
  if (dataStat === "name_display") return stripTags(match[1]);
  const csk = attrValue(match[0], "csk");
  if (csk !== "") return csk;
  return stripTags(match[1]);
}

function cellPlayerId(rowHtml) {
  const regex = /<td[^>]*data-stat="name_display"[^>]*>/i;
  const match = rowHtml.match(regex);
  if (!match) return "";
  return attrValue(match[0], "data-append-csv");
}

function tableRows(html) {
  return [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
}

function positionGroup(position) {
  const normalized = String(position || "").toUpperCase();
  if (normalized === "G") return "G";
  if (normalized === "D") return "D";
  if (normalized) return "F";
  return "";
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return "";
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : "";
}

function csvEscape(value) {
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function appendCsv(filePath, row, columns) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const exists = fs.existsSync(filePath);
  const lines = [];
  if (!exists) lines.push(columns.join(","));
  lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  fs.appendFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function appendDownloadTrace(options, target, details) {
  appendCsv(path.join(options.cacheDir, "_download_trace.csv"), {
    timestamp_utc: new Date().toISOString(),
    season_end_year: target.endYear,
    season: seasonLabelFromEndYear(target.endYear),
    page_type: target.pageType,
    url: target.url,
    cache_path: target.cachePath,
    status: details.status,
    http_status: details.httpStatus ?? "",
    bytes: details.bytes ?? "",
    attempt: details.attempt ?? "",
    message: details.message ?? "",
  }, TRACE_COLUMNS);
}

async function fetchWithCache(target, options) {
  const { url, cachePath } = target;
  if (fs.existsSync(cachePath)) {
    appendDownloadTrace(options, target, {
      status: "cached",
      bytes: fs.statSync(cachePath).size,
      message: "already exists",
    });
    return fs.readFileSync(cachePath, "utf8");
  }
  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    await sleep(options.requestDelayMs);
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 NHL data research script",
      },
    });
    if (response.ok) {
      const html = await response.text();
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, html, "utf8");
      appendDownloadTrace(options, target, {
        status: "downloaded",
        httpStatus: response.status,
        bytes: Buffer.byteLength(html, "utf8"),
        attempt: attempt + 1,
        message: "ok",
      });
      return html;
    }
    appendDownloadTrace(options, target, {
      status: response.status === 429 ? "rate_limited" : "http_error",
      httpStatus: response.status,
      attempt: attempt + 1,
      message: response.statusText,
    });
    if (response.status !== 429 || attempt === options.maxRetries) {
      throw new Error(`Failed ${response.status} ${url}`);
    }
    const retryDelay = Math.max(options.requestDelayMs * 4, 30000) * (attempt + 1);
    console.warn(`Rate limited for ${url}; retrying in ${Math.round(retryDelay / 1000)}s`);
    await sleep(retryDelay);
  }
  throw new Error(`Failed ${url}`);
}

function cachePaths(options, endYear) {
  return {
    skater: path.join(options.cacheDir, `NHL_${endYear}_skaters-misc.html`),
    goalie: path.join(options.cacheDir, `NHL_${endYear}_goalies.html`),
  };
}

function cacheProgressRows(options) {
  const rows = [];
  for (let endYear = options.startSeasonEndYear; endYear <= options.endSeasonEndYear; endYear += 1) {
    const paths = cachePaths(options, endYear);
    const skipped = SKIPPED_SEASON_END_YEARS.has(endYear);
    const skatersCached = fs.existsSync(paths.skater);
    const goaliesCached = fs.existsSync(paths.goalie);
    rows.push({
      season_end_year: endYear,
      season: seasonLabelFromEndYear(endYear),
      skaters_cached: skipped ? "skipped" : (skatersCached ? "true" : "false"),
      goalies_cached: skipped ? "skipped" : (goaliesCached ? "true" : "false"),
      complete: skipped || (skatersCached && goaliesCached) ? "true" : "false",
    });
  }
  return rows;
}

function writeCacheProgress(options) {
  writeCsv(
    path.join(options.cacheDir, "_progress.csv"),
    cacheProgressRows(options),
    ["season_end_year", "season", "skaters_cached", "goalies_cached", "complete"],
  );
}

function firstMissingEndYear(options) {
  const missing = cacheProgressRows(options).find((row) => row.complete !== "true");
  return missing ? Number(missing.season_end_year) : options.endSeasonEndYear + 1;
}

function parseSkaterRows(html, endYear) {
  const season = seasonLabelFromEndYear(endYear);
  const seasonId = seasonIdFromEndYear(endYear);
  return tableRows(html)
    .map((rowHtml) => {
      const playerId = cellPlayerId(rowHtml);
      if (!playerId) return null;
      const team = cellValue(rowHtml, "team_name_abbr");
      const position = cellValue(rowHtml, "pos");
      const ops = toNumber(cellValue(rowHtml, "ops"));
      const dps = toNumber(cellValue(rowHtml, "dps"));
      const psValue = toNumber(cellValue(rowHtml, "ps"));
      const rawPs = psValue === "" ? (toNumber(ops) || 0) + (toNumber(dps) || 0) : psValue;
      return {
        player_id: playerId,
        player_name: cellValue(rowHtml, "name_display"),
        season,
        season_id: seasonId,
        age: toNumber(cellValue(rowHtml, "age")),
        team,
        league: "NHL",
        position,
        position_group: positionGroup(position),
        games_played: toNumber(cellValue(rowHtml, "games")),
        games_started: "",
        goals: toNumber(cellValue(rowHtml, "goals_adjusted")),
        assists: toNumber(cellValue(rowHtml, "assists_adjusted")),
        points: toNumber(cellValue(rowHtml, "points_adjusted")),
        plus_minus: toNumber(cellValue(rowHtml, "plus_minus")),
        wins: "",
        losses: "",
        save_percentage: "",
        gaa: "",
        ops,
        dps,
        gps: "",
        ps: psValue,
        raw_ps: rawPs,
        raw_ops: ops,
        raw_dps: dps,
        raw_gps: "",
        source: "hockey_reference",
      };
    })
    .filter(Boolean);
}

function parseGoalieRows(html, endYear) {
  const season = seasonLabelFromEndYear(endYear);
  const seasonId = seasonIdFromEndYear(endYear);
  return tableRows(html)
    .map((rowHtml) => {
      const playerId = cellPlayerId(rowHtml);
      if (!playerId) return null;
      const gps = toNumber(cellValue(rowHtml, "gps"));
      return {
        player_id: playerId,
        player_name: cellValue(rowHtml, "name_display"),
        season,
        season_id: seasonId,
        age: toNumber(cellValue(rowHtml, "age")),
        team: cellValue(rowHtml, "team_name_abbr"),
        league: "NHL",
        position: "G",
        position_group: "G",
        games_played: toNumber(cellValue(rowHtml, "goalie_games")),
        games_started: toNumber(cellValue(rowHtml, "goalie_starts")),
        goals: "",
        assists: "",
        points: "",
        plus_minus: "",
        wins: toNumber(cellValue(rowHtml, "goalie_wins")),
        losses: toNumber(cellValue(rowHtml, "goalie_losses")),
        save_percentage: toNumber(cellValue(rowHtml, "save_pct_goalie")),
        gaa: toNumber(cellValue(rowHtml, "goals_against_avg")),
        ops: "",
        dps: "",
        gps,
        ps: gps,
        raw_ps: gps,
        raw_ops: "",
        raw_dps: "",
        raw_gps: gps,
        source: "hockey_reference",
      };
    })
    .filter(Boolean);
}

function isMultiTeamCode(team) {
  return team === "TOT" || /^[0-9]+TM$/.test(team);
}

function applyMultiTeamDrop(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.player_id}|${row.season_id}`;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  const output = [];
  for (const group of groups.values()) {
    const teams = [...new Set(group.map((row) => row.team))];
    if (teams.some(isMultiTeamCode)) continue;
    if (teams.length > 1) continue;
    output.push(...group);
  }
  return output;
}

function enrichFranchises(rows, franchiseMapPath) {
  const mapRows = readCsv(franchiseMapPath);
  const byTeam = new Map(mapRows.map((row) => [row.team, row]));
  const missing = [...new Set(rows.map((row) => row.team))]
    .filter((team) => !byTeam.has(team))
    .sort();
  if (missing.length > 0) {
    throw new Error(`Missing franchise mappings for Hockey-Reference teams: ${missing.join(", ")}`);
  }
  return rows.map((row) => {
    const mapped = byTeam.get(row.team);
    return {
      ...row,
      historical_team: row.team,
      team_name: mapped.team_name,
      franchise_key: mapped.franchise_key,
      franchise_name: mapped.franchise_name,
      current_team: mapped.current_team,
      franchise_status: mapped.franchise_status,
    };
  });
}

function cleanRowsForOutput(rows, options) {
  const singleTeamRows = applyMultiTeamDrop(rows);
  const eligible = singleTeamRows.filter((row) => {
    if (row.league !== "NHL") return false;
    if (row.position_group === "G") return numeric(row.games_played) >= options.minGoalieGames;
    return numeric(row.games_played) >= options.minSkaterGames;
  });
  return enrichFranchises(eligible, options.franchiseMap)
    .map((row) => {
      const output = {};
      for (const column of CLEAN_COLUMNS) output[column] = row[column] ?? "";
      return output;
    });
}

function bySeason(a, b) {
  return numeric(a.season_id) - numeric(b.season_id);
}

function byRawSeasonValue(a, b) {
  const aValue = a.position_group === "G" ? numeric(a.raw_gps) : numeric(a.raw_ps);
  const bValue = b.position_group === "G" ? numeric(b.raw_gps) : numeric(b.raw_ps);
  return bValue - aValue || numeric(a.season_id) - numeric(b.season_id);
}

function weightedAverage(rows, weights, column) {
  const values = rows.map((row) => numeric(row[column])).filter((value) => Number.isFinite(value));
  if (values.length === 0) return "";
  return rows.reduce((sum, row, index) => {
    const value = numeric(row[column]);
    return sum + (Number.isFinite(value) ? value : 0) * weights[index];
  }, 0);
}

function normalizedWeights(count) {
  const base = [0.5, 0.3, 0.2].slice(0, count);
  const total = base.reduce((sum, value) => sum + value, 0);
  return base.map((value) => value / total);
}

function rowsInWindow(rows, startYear, endYear) {
  return rows.filter((row) => {
    const year = seasonStartFromSeasonId(row.season_id);
    return year >= startYear && year <= endYear;
  });
}

function scoreWindow(rows) {
  const selected = [...rows].sort(byRawSeasonValue).slice(0, 3);
  const weights = normalizedWeights(selected.length);
  return {
    selected,
    raw_card_ps: weightedAverage(selected, weights, "raw_ps"),
    raw_card_ops: weightedAverage(selected, weights, "raw_ops"),
    raw_card_dps: weightedAverage(selected, weights, "raw_dps"),
    raw_card_gps: weightedAverage(selected, weights, "raw_gps"),
  };
}

function bestPeakWindow(rows) {
  const sorted = [...rows].sort(bySeason);
  const minYear = seasonStartFromSeasonId(sorted[0].season_id);
  const maxYear = seasonStartFromSeasonId(sorted[sorted.length - 1].season_id);
  if (maxYear - minYear <= 4) {
    return { rows: sorted, startYear: minYear, endYear: maxYear };
  }
  const candidates = [];
  for (let startYear = minYear; startYear <= maxYear - 4; startYear += 1) {
    const candidate = rowsInWindow(sorted, startYear, startYear + 4);
    if (candidate.length === 0) continue;
    const score = scoreWindow(candidate);
    candidates.push({ rows: candidate, startYear, endYear: startYear + 4, score });
  }
  const maxSeasons = Math.max(...candidates.map((candidate) => candidate.score.selected.length));
  return candidates
    .filter((candidate) => candidate.score.selected.length === maxSeasons)
    .sort((a, b) => numeric(b.score.raw_card_ps) - numeric(a.score.raw_card_ps) || a.startYear - b.startYear)[0];
}

function eraBucketFromEndYear(endYear) {
  if (endYear >= 2020) return "2020s";
  if (endYear >= 2010) return "2010s";
  if (endYear >= 2000) return "2000s";
  if (endYear >= 1990) return "1990s";
  if (endYear >= 1980) return "1980s";
  if (endYear >= 1970) return "1970s";
  if (endYear >= 1960) return "1960s";
  return "pre1960";
}

function round(value, digits = 3) {
  if (value === "") return "";
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function representativeTeamName(rows) {
  const counts = new Map();
  for (const row of rows) {
    const current = counts.get(row.historical_team) || { count: 0, rawPs: 0, row };
    current.count += 1;
    current.rawPs += numeric(row.raw_ps);
    if (numeric(row.raw_ps) > numeric(current.row.raw_ps)) current.row = row;
    counts.set(row.historical_team, current);
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || b.rawPs - a.rawPs || String(a.row.historical_team).localeCompare(String(b.row.historical_team)))[0]
    .row;
}

function bestSeason(rows, excludedSeasonIds = new Set()) {
  return [...rows]
    .filter((row) => !excludedSeasonIds.has(String(row.season_id)))
    .sort(byRawSeasonValue)[0] || null;
}

function buildSingleSeasonCard(groupRows, cardType, selected) {
  if (!selected) return null;
  const representative = representativeTeamName(groupRows);
  const selectedSeasons = selected.season;
  const cardId = [
    selected.player_id,
    selected.franchise_key,
    cardType,
    selectedSeasons,
  ].join("-");
  const startYear = seasonStartFromSeasonId(selected.season_id);
  const eraBucket = eraBucketFromEndYear(startYear + 1);
  return {
    card_id: cardId,
    player_id: selected.player_id,
    player_name: selected.player_name,
    position_group: selected.position_group,
    position: selected.position,
    franchise_key: selected.franchise_key,
    historical_team: representative.historical_team,
    team_name: representative.team_name,
    franchise_name: selected.franchise_name,
    current_team: selected.current_team,
    franchise_status: selected.franchise_status,
    card_type: cardType,
    card_label: selected.season,
    start_season: selected.season_id,
    end_season: selected.season_id,
    selected_seasons: selectedSeasons,
    season_count: 1,
    games_played_total: numeric(selected.games_played),
    raw_card_ps: round(numeric(selected.raw_ps)),
    raw_card_ops: round(selected.raw_ops === "" ? "" : numeric(selected.raw_ops)),
    raw_card_dps: round(selected.raw_dps === "" ? "" : numeric(selected.raw_dps)),
    raw_card_gps: round(selected.raw_gps === "" ? "" : numeric(selected.raw_gps)),
    era_bucket: eraBucket,
    is_legend: "false",
    is_modern: startYear >= 1990 ? "true" : "false",
    source: "hockey_reference_point_shares",
  };
}

function generateCards(cleanRows) {
  const groups = new Map();
  for (const row of cleanRows) {
    const key = `${row.player_id}|${row.franchise_key}`;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  const cards = [];
  for (const groupRows of groups.values()) {
    const sorted = [...groupRows].sort(bySeason);
    const seen = new Set();

    const earlyRows = sorted.slice(0, 5);
    const lateRows = sorted.slice(Math.max(0, sorted.length - 5));
    const peakSeason = bestSeason(sorted);
    let earlySeason = bestSeason(earlyRows);
    if (earlySeason && peakSeason && String(earlySeason.season_id) === String(peakSeason.season_id)) {
      earlySeason = sorted[0];
    }

    const phaseRows = [
      { type: "early", row: earlySeason },
      { type: "peak", row: peakSeason },
    ];
    const usedBeforeLate = new Set(phaseRows.filter((item) => item.row).map((item) => String(item.row.season_id)));
    phaseRows.push({
      type: "late",
      row: bestSeason(lateRows, usedBeforeLate) || bestSeason(lateRows),
    });

    for (const item of phaseRows) {
      const card = buildSingleSeasonCard(sorted, item.type, item.row);
      if (!card) continue;
      const key = card.selected_seasons;
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push(card);
    }
  }
  return cards.sort((a, b) => (
    String(a.franchise_key).localeCompare(String(b.franchise_key)) ||
    numeric(b.raw_card_ps) - numeric(a.raw_card_ps) ||
    String(a.player_name).localeCompare(String(b.player_name))
  ));
}

function eraPriority(card) {
  return {
    "2020s": 90,
    "2010s": 88,
    "2000s": 80,
    "1990s": 70,
    "1980s": 60,
    "1970s": 45,
    "1960s": 25,
    pre1960: 15,
  }[card.era_bucket] || 50;
}

function poolPriority(card) {
  return eraPriority(card) + numeric(card.raw_card_ps) * 8;
}

function eraBucketEndYear(eraBucket) {
  return {
    pre1960: 1959,
    "1960s": 1969,
    "1970s": 1979,
    "1980s": 1989,
    "1990s": 1999,
    "2000s": 2009,
    "2010s": 2019,
    "2020s": 2029,
  }[eraBucket] || 9999;
}

function isHistoricalCard(card, cutoffEndYear = 2000) {
  return eraBucketEndYear(card.era_bucket) < cutoffEndYear;
}

function buildBoardPools(cards, options, franchiseMapPath) {
  const targetCardsPerFranchise = options.targetCardsPerFranchise ?? 100;
  const historicalTargetPerFranchise = options.historicalTargetPerFranchise ?? 25;
  const historicalCutoffEndYear = options.historicalCutoffEndYear ?? 2000;
  const maxCardsPerPlayerFranchise = options.maxCardsPerPlayerFranchise ?? 3;
  const maxCardsPerPlayerTotal = options.maxCardsPerPlayerTotal ?? 4;
  const currentTeams = [...new Set(readCsv(franchiseMapPath).map((row) => row.current_team).filter(Boolean))].sort();
  const selectedByTeam = new Map(currentTeams.map((team) => [team, []]));
  const selectedIds = new Set();
  const playerFranchiseCounts = new Map();
  const playerTotalCounts = new Map();

  const ranked = cards
    .filter((card) => selectedByTeam.has(card.franchise_key))
    .sort((a, b) => (
      poolPriority(b) - poolPriority(a) ||
      numeric(b.raw_card_ps) - numeric(a.raw_card_ps) ||
      numeric(b.end_season) - numeric(a.end_season) ||
      String(a.player_name).localeCompare(String(b.player_name))
    ));

  function add(card) {
    const teamSelected = selectedByTeam.get(card.franchise_key);
    if (!teamSelected || teamSelected.length >= targetCardsPerFranchise) return false;
    if (selectedIds.has(card.card_id)) return false;

    const playerFranchiseKey = `${card.player_id}|${card.franchise_key}`;
    const playerFranchiseCount = playerFranchiseCounts.get(playerFranchiseKey) || 0;
    if (playerFranchiseCount >= maxCardsPerPlayerFranchise) return false;

    const playerTotalCount = playerTotalCounts.get(card.player_id) || 0;
    if (playerTotalCount >= maxCardsPerPlayerTotal) return false;

    teamSelected.push({ ...card, selection_type: "priority_fill" });
    selectedIds.add(card.card_id);
    playerFranchiseCounts.set(playerFranchiseKey, playerFranchiseCount + 1);
    playerTotalCounts.set(card.player_id, playerTotalCount + 1);
    return true;
  }

  for (const team of currentTeams) {
    const teamRanked = ranked.filter((card) => card.franchise_key === team);
    const historicalTarget = Math.min(
      historicalTargetPerFranchise,
      teamRanked.filter((card) => isHistoricalCard(card, historicalCutoffEndYear)).length,
      targetCardsPerFranchise,
    );

    for (const card of teamRanked) {
      if (selectedByTeam.get(team).length >= historicalTarget) break;
      if (isHistoricalCard(card, historicalCutoffEndYear)) add(card);
    }

    for (const card of teamRanked) add(card);
  }

  const output = [];
  for (const team of currentTeams) {
    selectedByTeam.get(team)
      .sort((a, b) => (
        poolPriority(b) - poolPriority(a) ||
        numeric(b.raw_card_ps) - numeric(a.raw_card_ps) ||
        String(a.player_name).localeCompare(String(b.player_name))
      ))
      .forEach((card, index) => {
      const priority = round(poolPriority(card), 3);
      const drawWeight = round((1 + priority / 100) * (card.is_modern === "true" ? 1.1 : 1), 6);
      output.push({
        franchise_key: team,
        board_pool_rank: index + 1,
        selection_type: card.selection_type,
        pool_priority: priority,
        draw_weight: drawWeight,
        ...card,
      });
    });
  }
  return output;
}

async function fetchAllRows(options) {
  const rows = [];
  for (let endYear = options.startSeasonEndYear; endYear <= options.endSeasonEndYear; endYear += 1) {
    if (SKIPPED_SEASON_END_YEARS.has(endYear)) {
      writeCacheProgress(options);
      console.log(`Skipping Hockey-Reference ${seasonLabelFromEndYear(endYear)}: no NHL season`);
      continue;
    }
    const skaterUrl = `https://www.hockey-reference.com/leagues/NHL_${endYear}_skaters-misc.html`;
    const goalieUrl = `https://www.hockey-reference.com/leagues/NHL_${endYear}_goalies.html`;
    const paths = cachePaths(options, endYear);
    try {
      const skaterHtml = await fetchWithCache({
        endYear,
        pageType: "skaters-misc",
        url: skaterUrl,
        cachePath: paths.skater,
      }, options);
      rows.push(...parseSkaterRows(skaterHtml, endYear));
      const goalieHtml = await fetchWithCache({
        endYear,
        pageType: "goalies",
        url: goalieUrl,
        cachePath: paths.goalie,
      }, options);
      rows.push(...parseGoalieRows(goalieHtml, endYear));
      writeCacheProgress(options);
      console.log(`Fetched Hockey-Reference ${seasonLabelFromEndYear(endYear)}: ${rows.length} total rows`);
    } catch (error) {
      writeCacheProgress(options);
      console.warn(`Skipping ${endYear}: ${error.message}`);
    }
  }
  return rows;
}

async function buildHockeyReferencePointShares(options) {
  if (options.resumeDownload) {
    if (!options.downloadOnly) {
      throw new Error("--resume-download must be used with --download-only. Run the final build without --resume-download after the cache is complete.");
    }
    const resumeYear = firstMissingEndYear(options);
    if (resumeYear > options.endSeasonEndYear) {
      console.log("Hockey-Reference cache is already complete for the requested range.");
    } else {
      console.log(`Resuming Hockey-Reference download at ${seasonLabelFromEndYear(resumeYear)} (${resumeYear})`);
      options.startSeasonEndYear = resumeYear;
    }
  }
  const rawRows = await fetchAllRows(options);
  writeCacheProgress(options);

  if (options.downloadOnly) {
    console.log(`Updated Hockey-Reference cache at ${options.cacheDir}`);
    console.log(`Progress file: ${path.join(options.cacheDir, "_progress.csv")}`);
    return { cleanRows: [], cards: [], boardRows: [] };
  }

  const cleanRows = cleanRowsForOutput(rawRows, options);
  writeCsv(options.cleanOutput, cleanRows, CLEAN_COLUMNS);

  const cards = generateCards(cleanRows);
  writeCsv(options.windowsOutput, cards, CARD_COLUMNS);

  const boardRows = buildBoardPools(cards, options, options.franchiseMap);
  const playableCards = boardRows.map((row) => {
    const card = {};
    for (const column of CARD_COLUMNS) card[column] = row[column] ?? "";
    return card;
  });
  writeCsv(options.playableOutput, playableCards, CARD_COLUMNS);
  writeCsv(options.boardOutput, boardRows, BOARD_COLUMNS);

  console.log(`Wrote ${cleanRows.length} rows to ${options.cleanOutput}`);
  console.log(`Wrote ${cards.length} rows to ${options.windowsOutput}`);
  console.log(`Wrote ${playableCards.length} rows to ${options.playableOutput}`);
  console.log(`Wrote ${boardRows.length} rows to ${options.boardOutput}`);
  return { cleanRows, cards: playableCards, boardRows };
}

if (require.main === module) {
  buildHockeyReferencePointShares(parseArgs(process.argv)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildBoardPools,
  buildSingleSeasonCard,
  buildHockeyReferencePointShares,
  cleanRowsForOutput,
  generateCards,
  parseGoalieRows,
  parseSkaterRows,
  scoreWindow,
};

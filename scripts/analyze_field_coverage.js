const { readCsv, seasonIds, numeric } = require("./pipeline_common");
const { fetchReport } = require("./build_clean_player_seasons");

const SKATER_REPORTS = {
  timeonice: [
    "evTimeOnIcePerGame",
    "ppTimeOnIcePerGame",
    "shTimeOnIcePerGame",
    "shiftsPerGame",
    "timeOnIcePerShift",
  ],
  goalsForAgainst: [
    "evenStrengthGoalsForPct",
    "evenStrengthGoalDifference",
    "evenStrengthGoalsFor",
    "evenStrengthGoalsAgainst",
    "shortHandedTimeOnIcePerGame",
    "powerPlayTimeOnIcePerGame",
  ],
  percentages: [
    "satPercentage",
    "satRelative",
    "usatPercentage",
    "usatRelative",
    "zoneStartPct5v5",
  ],
  scoringRates: [
    "goals5v5",
    "primaryAssists5v5",
    "points5v5",
    "pointsPer605v5",
    "satRelative5v5",
    "netMinorPenaltiesPer60",
  ],
  puckPossessions: [
    "satPct",
    "usatPct",
    "goalsPct",
    "offensiveZoneStartPct",
    "defensiveZoneStartPct",
  ],
  penalties: [
    "penaltiesDrawn",
    "penalties",
    "netPenalties",
    "netPenaltiesPer60",
  ],
};

const GOALIE_REPORTS = {
  advanced: [
    "gamesStarted",
    "qualityStart",
    "qualityStartsPct",
    "shotsAgainstPer60",
    "regulationWins",
    "regulationLosses",
  ],
  savesByStrength: [
    "evSavePct",
    "ppSavePct",
    "shSavePct",
    "evShotsAgainst",
    "ppShotsAgainst",
    "shShotsAgainst",
  ],
};

function parseArgs(argv) {
  const args = {
    input: "data/clean_player_seasons.csv",
    startSeason: null,
    endSeason: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--input") {
      args.input = value;
      i += 1;
    } else if (arg === "--start-season") {
      args.startSeason = Number(value);
      i += 1;
    } else if (arg === "--end-season") {
      args.endSeason = Number(value);
      i += 1;
    }
  }
  return args;
}

function key(row) {
  return `${row.playerId || row.player_id}|${row.seasonId || row.season_id}|${row.teamAbbrevs || row.team}`;
}

function decade(seasonId) {
  return `${Math.floor(Number(String(seasonId).slice(0, 4)) / 10) * 10}s`;
}

function hasValue(value) {
  if (value === undefined || value === null || value === "") return false;
  const number = Number(value);
  return Number.isFinite(number);
}

function initSummary(report, field, playerType) {
  return {
    report,
    field,
    player_type: playerType,
    matched_rows: 0,
    populated_rows: 0,
    populated_nonzero_rows: 0,
    by_decade: {},
  };
}

function addDecade(summary, decadeName, hasField, nonzero) {
  if (!summary.by_decade[decadeName]) {
    summary.by_decade[decadeName] = { matched: 0, populated: 0, nonzero: 0 };
  }
  summary.by_decade[decadeName].matched += 1;
  if (hasField) summary.by_decade[decadeName].populated += 1;
  if (nonzero) summary.by_decade[decadeName].nonzero += 1;
}

async function analyzeCoverage(args) {
  const cleanRows = readCsv(args.input);
  const seasons = args.startSeason && args.endSeason
    ? seasonIds(args.startSeason, args.endSeason)
    : [...new Set(cleanRows.map((row) => Number(row.season_id)))].sort((a, b) => a - b);

  const cleanByTypeSeason = new Map();
  for (const row of cleanRows) {
    const mapKey = `${row.player_type}|${row.season_id}`;
    if (!cleanByTypeSeason.has(mapKey)) cleanByTypeSeason.set(mapKey, []);
    cleanByTypeSeason.get(mapKey).push(row);
  }

  const summaries = [];

  for (const [report, fields] of Object.entries(SKATER_REPORTS)) {
    for (const field of fields) summaries.push(initSummary(report, field, "skater"));
  }
  for (const [report, fields] of Object.entries(GOALIE_REPORTS)) {
    for (const field of fields) summaries.push(initSummary(report, field, "goalie"));
  }

  const summaryByReportField = new Map(summaries.map((summary) => [
    `${summary.player_type}|${summary.report}|${summary.field}`,
    summary,
  ]));

  for (const seasonId of seasons) {
    console.error(`Checking ${seasonId}`);

    for (const [report, fields] of Object.entries(SKATER_REPORTS)) {
      const clean = cleanByTypeSeason.get(`skater|${seasonId}`) || [];
      if (clean.length === 0) continue;
      const reportRows = await fetchReport(`/skater/${report}`, seasonId);
      const reportMap = new Map(reportRows.map((row) => [key(row), row]));
      for (const cleanRow of clean) {
        const row = reportMap.get(key(cleanRow));
        if (!row) continue;
        const decadeName = decade(seasonId);
        for (const field of fields) {
          const summary = summaryByReportField.get(`skater|${report}|${field}`);
          const present = hasValue(row[field]);
          const nonzero = present && numeric(row[field]) !== 0;
          summary.matched_rows += 1;
          if (present) summary.populated_rows += 1;
          if (nonzero) summary.populated_nonzero_rows += 1;
          addDecade(summary, decadeName, present, nonzero);
        }
      }
    }

    for (const [report, fields] of Object.entries(GOALIE_REPORTS)) {
      const clean = cleanByTypeSeason.get(`goalie|${seasonId}`) || [];
      if (clean.length === 0) continue;
      const reportRows = await fetchReport(`/goalie/${report}`, seasonId);
      const reportMap = new Map(reportRows.map((row) => [key(row), row]));
      for (const cleanRow of clean) {
        const row = reportMap.get(key(cleanRow));
        if (!row) continue;
        const decadeName = decade(seasonId);
        for (const field of fields) {
          const summary = summaryByReportField.get(`goalie|${report}|${field}`);
          const present = hasValue(row[field]);
          const nonzero = present && numeric(row[field]) !== 0;
          summary.matched_rows += 1;
          if (present) summary.populated_rows += 1;
          if (nonzero) summary.populated_nonzero_rows += 1;
          addDecade(summary, decadeName, present, nonzero);
        }
      }
    }
  }

  const output = summaries.map((summary) => ({
    report: summary.report,
    field: summary.field,
    player_type: summary.player_type,
    matched_rows: summary.matched_rows,
    populated_rows: summary.populated_rows,
    populated_pct: summary.matched_rows ? Number(((summary.populated_rows / summary.matched_rows) * 100).toFixed(1)) : 0,
    nonzero_rows: summary.populated_nonzero_rows,
    nonzero_pct: summary.matched_rows ? Number(((summary.populated_nonzero_rows / summary.matched_rows) * 100).toFixed(1)) : 0,
    by_decade: summary.by_decade,
  }));

  console.log(JSON.stringify(output, null, 2));
  return output;
}

if (require.main === module) {
  analyzeCoverage(parseArgs(process.argv)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { analyzeCoverage };

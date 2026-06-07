const fs = require("node:fs");
const path = require("node:path");
const { readCsv, writeCsv } = require("./pipeline_common");

const ROOT = path.join(__dirname, "..");
const HR_CARDS_PATH = path.join(ROOT, "data", "team_board_pools_hockey_reference_raw.csv");
const NHL_SEASONS_PATH = path.join(ROOT, "data", "clean_player_seasons.csv");
const MANUAL_OVERRIDES_PATH = path.join(ROOT, "data", "player_id_manual_overrides.csv");
const HANDEDNESS_PATH = path.join(ROOT, "data", "player_handedness.csv");
const ENRICHED_CARDS_PATH = path.join(ROOT, "data", "team_board_pools_hockey_reference_enriched.csv");
const CACHE_DIR = path.join(ROOT, "data", "nhl_player_landing_cache");

const HANDEDNESS_COLUMNS = [
  "hr_player_id",
  "nhl_player_id",
  "player_name",
  "shoots",
  "source",
  "match_method",
  "match_confidence",
  "notes",
];

function parseArgs(argv) {
  const args = {
    fetch: true,
    delayMs: 1500,
    limit: null,
    force: false,
  };
  for (const arg of argv) {
    if (arg === "--no-fetch") args.fetch = false;
    else if (arg === "--force") args.force = true;
    else if (arg.startsWith("--delay-ms=")) args.delayMs = Number(arg.slice("--delay-ms=".length));
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(args.delayMs) || args.delayMs < 0) throw new Error("Invalid --delay-ms value");
  if (args.limit !== null && (!Number.isFinite(args.limit) || args.limit < 1)) throw new Error("Invalid --limit value");
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function splitSeasons(value) {
  return String(value || "")
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeHandedness(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "L" || raw === "LEFT") return "L";
  if (raw === "R" || raw === "RIGHT") return "R";
  return "unknown";
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== "" && value !== undefined && value !== null))];
}

function uniqueIds(rows) {
  return unique(rows.map((row) => row.player_id || row.nhl_player_id));
}

function readManualOverrides() {
  if (!fs.existsSync(MANUAL_OVERRIDES_PATH)) return new Map();
  const rows = readCsv(MANUAL_OVERRIDES_PATH);
  const byHrId = new Map();
  for (const row of rows) {
    if (!row.hr_player_id || !row.nhl_player_id) continue;
    byHrId.set(row.hr_player_id, row);
  }
  return byHrId;
}

function buildHrPlayers(cards) {
  const byPlayer = new Map();
  for (const card of cards) {
    const player = byPlayer.get(card.player_id) || {
      hr_player_id: card.player_id,
      player_name: card.player_name,
      normalized_name: normalizeName(card.player_name),
      seasons: new Set(),
      teams: new Set(),
      positions: new Set(),
    };
    for (const season of splitSeasons(card.selected_seasons || card.card_label)) {
      player.seasons.add(season);
    }
    if (card.card_label) player.seasons.add(card.card_label);
    if (card.historical_team) player.teams.add(card.historical_team);
    if (card.position) player.positions.add(card.position);
    byPlayer.set(card.player_id, player);
  }
  return [...byPlayer.values()].map((player) => ({
    ...player,
    seasons: [...player.seasons],
    teams: [...player.teams],
    positions: [...player.positions],
  }));
}

function buildNhlIndex(rows) {
  const byName = new Map();
  for (const row of rows) {
    const key = normalizeName(row.player_name);
    if (!key) continue;
    const items = byName.get(key) || [];
    items.push(row);
    byName.set(key, items);
  }
  return byName;
}

function oneIdMatch(candidates) {
  const ids = uniqueIds(candidates);
  return ids.length === 1 ? ids[0] : "";
}

function matchHrPlayer(hrPlayer, nhlByName, overrides) {
  const candidates = nhlByName.get(hrPlayer.normalized_name) || [];
  const seasonTeam = candidates.filter((row) => (
    hrPlayer.seasons.includes(row.season_label) &&
    hrPlayer.teams.includes(row.team)
  ));
  const seasonTeamId = oneIdMatch(seasonTeam);
  if (seasonTeamId) {
    return {
      nhl_player_id: seasonTeamId,
      match_method: "exact_name_season_team",
      match_confidence: "high",
      notes: "",
    };
  }

  const seasonOnly = candidates.filter((row) => hrPlayer.seasons.includes(row.season_label));
  const seasonOnlyId = oneIdMatch(seasonOnly);
  if (seasonOnlyId) {
    return {
      nhl_player_id: seasonOnlyId,
      match_method: "exact_name_season",
      match_confidence: "medium",
      notes: "Matched without team because historical team abbreviation did not uniquely match.",
    };
  }

  const override = overrides.get(hrPlayer.hr_player_id);
  if (override) {
    return {
      nhl_player_id: override.nhl_player_id,
      match_method: "manual_override",
      match_confidence: "high",
      notes: override.notes || "",
    };
  }

  return {
    nhl_player_id: "",
    match_method: "unresolved",
    match_confidence: "none",
    notes: candidates.length > 0
      ? `Found ${uniqueIds(candidates).length} name candidates but no unique season/team match.`
      : "No NHL clean-season name candidate found.",
  };
}

function cachePath(nhlPlayerId) {
  return path.join(CACHE_DIR, `${nhlPlayerId}.json`);
}

async function fetchLanding(nhlPlayerId, options) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const filePath = cachePath(nhlPlayerId);
  if (!options.force && fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }
  if (!options.fetch) return null;
  const url = `https://api-web.nhle.com/v1/player/${nhlPlayerId}/landing`;
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "11-cups-nhl-handedness-enrichment/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`NHL API ${response.status} for ${nhlPlayerId}`);
  }
  const payload = await response.json();
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await sleep(options.delayMs);
  return payload;
}

async function addHandedness(matches, options) {
  const rows = [];
  let uncachedFetches = 0;
  for (const match of matches) {
    let source = "unresolved";
    let shoots = "unknown";
    let notes = match.notes;
    if (match.nhl_player_id) {
      try {
        const wasCached = fs.existsSync(cachePath(match.nhl_player_id));
        const landing = await fetchLanding(match.nhl_player_id, options);
        if (!wasCached && landing) uncachedFetches += 1;
        if (landing) {
          shoots = normalizeHandedness(landing.shootsCatches);
          source = "nhl_api";
          if (shoots === "unknown") {
            notes = [notes, "NHL landing response missing shootsCatches."].filter(Boolean).join(" ");
          }
        } else {
          notes = [notes, "NHL API fetch skipped and no cache file existed."].filter(Boolean).join(" ");
        }
      } catch (error) {
        notes = [notes, error.message].filter(Boolean).join(" ");
      }
    }
    rows.push({
      hr_player_id: match.hr_player_id,
      nhl_player_id: match.nhl_player_id,
      player_name: match.player_name,
      shoots,
      source,
      match_method: match.match_method,
      match_confidence: match.match_confidence,
      notes,
    });
    if (options.limit !== null && uncachedFetches >= options.limit) {
      const remaining = matches.slice(rows.length).map((item) => ({
        hr_player_id: item.hr_player_id,
        nhl_player_id: item.nhl_player_id,
        player_name: item.player_name,
        shoots: "unknown",
        source: "unresolved",
        match_method: item.match_method,
        match_confidence: item.match_confidence,
        notes: [item.notes, `Skipped because --limit=${options.limit} was reached.`].filter(Boolean).join(" "),
      }));
      return rows.concat(remaining);
    }
  }
  return rows;
}

function enrichCards(cards, handednessRows) {
  const byHrId = new Map(handednessRows.map((row) => [row.hr_player_id, row]));
  return cards.map((card) => {
    const handedness = byHrId.get(card.player_id);
    return {
      ...card,
      shoots: handedness?.shoots || "unknown",
      handedness_source: handedness?.source || "unresolved",
      handedness_match_confidence: handedness?.match_confidence || "none",
    };
  });
}

function summarize(rows) {
  const count = (predicate) => rows.filter(predicate).length;
  return {
    unique_hr_players: rows.length,
    matched_to_nhl_id: count((row) => row.nhl_player_id),
    unresolved_players: count((row) => !row.nhl_player_id),
    handedness_l: count((row) => row.shoots === "L"),
    handedness_r: count((row) => row.shoots === "R"),
    handedness_unknown: count((row) => row.shoots === "unknown"),
    high_confidence_matches: count((row) => row.match_confidence === "high"),
    medium_confidence_matches: count((row) => row.match_confidence === "medium"),
    manual_overrides: count((row) => row.match_method === "manual_override"),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cards = readCsv(HR_CARDS_PATH);
  const nhlRows = readCsv(NHL_SEASONS_PATH);
  const hrPlayers = buildHrPlayers(cards);
  const nhlByName = buildNhlIndex(nhlRows);
  const overrides = readManualOverrides();

  const matches = hrPlayers.map((player) => ({
    hr_player_id: player.hr_player_id,
    player_name: player.player_name,
    ...matchHrPlayer(player, nhlByName, overrides),
  }));
  const handednessRows = await addHandedness(matches, options);
  const enrichedCards = enrichCards(cards, handednessRows);
  const enrichedColumns = [...Object.keys(cards[0]), "shoots", "handedness_source", "handedness_match_confidence"];

  writeCsv(HANDEDNESS_PATH, handednessRows, HANDEDNESS_COLUMNS);
  writeCsv(ENRICHED_CARDS_PATH, enrichedCards, enrichedColumns);

  console.log(JSON.stringify({
    options,
    outputs: {
      handedness: path.relative(ROOT, HANDEDNESS_PATH),
      enriched_cards: path.relative(ROOT, ENRICHED_CARDS_PATH),
      cache_dir: path.relative(ROOT, CACHE_DIR),
    },
    summary: summarize(handednessRows),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

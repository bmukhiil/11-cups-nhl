const fs = require("node:fs");
const path = require("node:path");
const { readCsv } = require("./pipeline_common");

const ROOT = path.join(__dirname, "..");
const HANDEDNESS_INPUT = path.join(ROOT, "data", "player_handedness.csv");
const LANDING_CACHE_DIR = path.join(ROOT, "data", "nhl_player_landing_cache");
const OUTPUT_DIR = path.join(ROOT, "app", "public", "player-headshots");

function parseArgs(argv) {
  const args = {
    delayMs: 300,
    limit: Infinity,
    force: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--delay-ms") {
      args.delayMs = Number(value);
      index += 1;
    } else if (arg === "--limit") {
      args.limit = Number(value);
      index += 1;
    } else if (arg === "--force") {
      args.force = true;
    }
  }
  if (!Number.isFinite(args.delayMs) || args.delayMs < 0) {
    throw new Error("--delay-ms must be a non-negative number");
  }
  if (!Number.isFinite(args.limit) && args.limit !== Infinity) {
    throw new Error("--limit must be a number");
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function landingCachePath(nhlPlayerId) {
  return path.join(LANDING_CACHE_DIR, `${nhlPlayerId}.json`);
}

function loadLanding(nhlPlayerId) {
  const filePath = landingCachePath(nhlPlayerId);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function uniqueMappedPlayers() {
  const rows = readCsv(HANDEDNESS_INPUT);
  const byNhlId = new Map();
  for (const row of rows) {
    const nhlPlayerId = String(row.nhl_player_id || "").trim();
    if (!nhlPlayerId || byNhlId.has(nhlPlayerId)) continue;
    byNhlId.set(nhlPlayerId, {
      nhlPlayerId,
      hrPlayerId: row.hr_player_id || "",
      playerName: row.player_name || "",
    });
  }
  return [...byNhlId.values()];
}

async function fetchLanding(nhlPlayerId) {
  const response = await fetch(`https://api-web.nhle.com/v1/player/${nhlPlayerId}/landing`);
  if (!response.ok) {
    throw new Error(`NHL landing ${response.status}`);
  }
  const data = await response.json();
  fs.mkdirSync(LANDING_CACHE_DIR, { recursive: true });
  fs.writeFileSync(landingCachePath(nhlPlayerId), `${JSON.stringify(data)}\n`);
  return data;
}

async function downloadImage(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`image ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("image")) {
    throw new Error(`unexpected content-type ${contentType || "unknown"}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, bytes);
}

async function downloadHeadshots(options = {}) {
  const args = { ...parseArgs([]), ...options };
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const players = uniqueMappedPlayers().slice(0, args.limit);
  const summary = {
    players: players.length,
    downloaded: 0,
    skippedExisting: 0,
    missingLanding: 0,
    missingHeadshot: 0,
    failed: 0,
  };

  for (const [index, player] of players.entries()) {
    const outputPath = path.join(OUTPUT_DIR, `${player.nhlPlayerId}.png`);
    if (!args.force && fs.existsSync(outputPath)) {
      summary.skippedExisting += 1;
      continue;
    }

    try {
      let landing = loadLanding(player.nhlPlayerId);
      if (!landing) {
        summary.missingLanding += 1;
        landing = await fetchLanding(player.nhlPlayerId);
      }
      if (!landing.headshot) {
        summary.missingHeadshot += 1;
        continue;
      }
      await downloadImage(landing.headshot, outputPath);
      summary.downloaded += 1;
      console.log(`${index + 1}/${players.length} downloaded ${player.playerName} (${player.nhlPlayerId})`);
    } catch (error) {
      summary.failed += 1;
      console.warn(`${index + 1}/${players.length} failed ${player.playerName} (${player.nhlPlayerId}): ${error.message}`);
    }

    if (args.delayMs > 0) {
      await sleep(args.delayMs);
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  downloadHeadshots(parseArgs(process.argv)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  OUTPUT_DIR,
  downloadHeadshots,
  uniqueMappedPlayers,
};

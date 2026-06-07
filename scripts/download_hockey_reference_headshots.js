const fs = require("node:fs");
const path = require("node:path");
const { readCsv, writeCsv } = require("./pipeline_common");

const TRACE_COLUMNS = [
  "timestamp_utc",
  "player_id",
  "player_name",
  "url",
  "output_path",
  "status",
  "http_status",
  "bytes",
  "message",
];

const PROGRESS_COLUMNS = [
  "player_id",
  "player_name",
  "headshot_url",
  "output_path",
  "status",
];

function parseArgs(argv) {
  const args = {
    input: path.join("data", "playable_cards_hockey_reference_raw.csv"),
    outputDir: path.join("data", "hockey_reference_headshots"),
    baseUrl: "https://www.hockey-reference.com/req/202301051/images/headshots",
    delayMs: 15000,
    maxPlayers: null,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--input") {
      args.input = value;
      index += 1;
    } else if (arg === "--output-dir") {
      args.outputDir = value;
      index += 1;
    } else if (arg === "--base-url") {
      args.baseUrl = value.replace(/\/$/, "");
      index += 1;
    } else if (arg === "--delay-ms") {
      args.delayMs = Number(value);
      index += 1;
    } else if (arg === "--max-players") {
      args.maxPlayers = Number(value);
      index += 1;
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function uniquePlayers(inputPath, baseUrl, outputDir) {
  const rows = readCsv(inputPath);
  const players = new Map();
  for (const row of rows) {
    if (!row.player_id || players.has(row.player_id)) continue;
    const url = `${baseUrl}/${row.player_id}.jpg`;
    players.set(row.player_id, {
      player_id: row.player_id,
      player_name: row.player_name,
      headshot_url: url,
      output_path: path.join(outputDir, `${row.player_id}.jpg`),
    });
  }
  return [...players.values()].sort((a, b) => String(a.player_name).localeCompare(String(b.player_name)));
}

function progressRows(players) {
  return players.map((player) => ({
    ...player,
    status: fs.existsSync(player.output_path) ? "downloaded" : "pending",
  }));
}

function writeProgress(options, players) {
  writeCsv(
    path.join(options.outputDir, "_progress.csv"),
    progressRows(players),
    PROGRESS_COLUMNS,
  );
}

function trace(options, player, details) {
  appendCsv(path.join(options.outputDir, "_download_trace.csv"), {
    timestamp_utc: new Date().toISOString(),
    player_id: player.player_id,
    player_name: player.player_name,
    url: player.headshot_url,
    output_path: player.output_path,
    status: details.status,
    http_status: details.httpStatus ?? "",
    bytes: details.bytes ?? "",
    message: details.message ?? "",
  }, TRACE_COLUMNS);
}

async function downloadHeadshot(options, player) {
  if (fs.existsSync(player.output_path)) {
    const bytes = fs.statSync(player.output_path).size;
    trace(options, player, { status: "cached", bytes, message: "already exists" });
    console.log(`cached ${player.player_name} (${player.player_id})`);
    return "cached";
  }

  console.log(`sleeping ${Math.round(options.delayMs / 1000)}s before ${player.player_name}`);
  await sleep(options.delayMs);

  const response = await fetch(player.headshot_url, {
    headers: {
      "user-agent": "Mozilla/5.0 NHL game headshot cache downloader",
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
  });

  if (response.status === 404) {
    trace(options, player, { status: "missing", httpStatus: 404, message: "not found" });
    console.log(`missing ${player.player_name} (${player.player_id})`);
    return "missing";
  }

  if (!response.ok) {
    trace(options, player, {
      status: response.status === 429 ? "rate_limited" : "http_error",
      httpStatus: response.status,
      message: response.statusText,
    });
    throw new Error(`Failed ${response.status} ${player.headshot_url}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("image")) {
    trace(options, player, { status: "invalid_content_type", httpStatus: response.status, message: contentType });
    console.log(`invalid content type ${player.player_name}: ${contentType}`);
    return "invalid_content_type";
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(player.output_path), { recursive: true });
  fs.writeFileSync(player.output_path, bytes);
  trace(options, player, { status: "downloaded", httpStatus: response.status, bytes: bytes.length, message: "ok" });
  console.log(`downloaded ${player.player_name} (${player.player_id}) ${bytes.length} bytes`);
  return "downloaded";
}

async function downloadHeadshots(options) {
  const players = uniquePlayers(options.input, options.baseUrl, options.outputDir);
  const selectedPlayers = options.maxPlayers ? players.slice(0, options.maxPlayers) : players;
  writeProgress(options, players);

  console.log(`Found ${players.length} unique players in ${options.input}`);
  console.log(`Downloading ${selectedPlayers.length} pending/cached players to ${options.outputDir}`);

  let completedThisRun = 0;
  for (const player of selectedPlayers) {
    try {
      await downloadHeadshot(options, player);
      completedThisRun += 1;
      writeProgress(options, players);
    } catch (error) {
      writeProgress(options, players);
      console.error(error.message);
      console.error("Stopped so the next run can resume without re-downloading cached images.");
      process.exitCode = 1;
      break;
    }
  }

  const downloaded = progressRows(players).filter((row) => row.status === "downloaded").length;
  console.log(`Completed this run: ${completedThisRun}`);
  console.log(`Downloaded/cached total: ${downloaded}/${players.length}`);
  console.log(`Progress: ${path.join(options.outputDir, "_progress.csv")}`);
  console.log(`Trace: ${path.join(options.outputDir, "_download_trace.csv")}`);
}

if (require.main === module) {
  downloadHeadshots(parseArgs(process.argv)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  downloadHeadshots,
  uniquePlayers,
};

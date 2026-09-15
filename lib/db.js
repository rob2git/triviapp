const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = { admin: null, games: {}, players: {} };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
  }
}

function readDb() {
  ensureDb();
  const raw = fs.readFileSync(DB_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.games) parsed.games = {};
    if (!parsed.players) parsed.players = {};
    return parsed;
  } catch (e) {
    return { admin: null, games: {}, players: {} };
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// All writes go through this queue so two requests arriving at the same
// moment (e.g. two players joining at once) can't clobber each other.
let queue = Promise.resolve();

function mutate(fn) {
  const run = queue.then(async () => {
    const db = readDb();
    const result = await fn(db);
    writeDb(db);
    return result;
  });
  // Keep the chain alive even if this mutation throws, so later ones still run.
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

module.exports = { readDb, mutate };

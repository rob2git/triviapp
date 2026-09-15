const crypto = require("crypto");

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string" || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(check, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Sessions live in memory only — they reset if the server restarts.
// That's fine for a small self-hosted trivia app; swap in a real session
// store if you need logins to survive restarts.
const sessions = new Set();

function issueToken() {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.add(token);
  return token;
}

function isValidToken(token) {
  return !!token && sessions.has(token);
}

function revokeToken(token) {
  sessions.delete(token);
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!isValidToken(token)) {
    return res.status(401).json({ error: "Log in again to continue." });
  }
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  issueToken,
  isValidToken,
  revokeToken,
  requireAdmin,
};

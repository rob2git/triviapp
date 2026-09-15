const crypto = require("crypto");

// Excludes 0/O and 1/I/L to keep codes easy to read aloud and type.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(existingCodes) {
  for (let attempt = 0; attempt < 200; attempt++) {
    let code = "";
    for (let i = 0; i < 4; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    if (!existingCodes.includes(code)) return code;
  }
  return Date.now().toString(36).slice(-4).toUpperCase();
}

function generateId() {
  return crypto.randomUUID();
}

function normalizeText(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function checkAnswer(question, optionId, text) {
  if (question.type === "mc") {
    return !!optionId && optionId === question.correctOptionId;
  }
  const userNorm = normalizeText(text);
  if (!userNorm) return false;
  return question.acceptableAnswers.some((a) => normalizeText(a) === userNorm);
}

// Strips correct answers / accepted answers before a game is sent to a player.
function toPublicGame(game) {
  return {
    code: game.code,
    title: game.title,
    timerSeconds: game.timerSeconds,
    questions: game.questions.map((q) =>
      q.type === "mc"
        ? { id: q.id, type: "mc", prompt: q.prompt, options: q.options.map((o) => ({ id: o.id, text: o.text })) }
        : { id: q.id, type: "text", prompt: q.prompt }
    ),
  };
}

function toPublicPlayer(p) {
  return { name: p.name, score: p.score, total: p.total, finished: p.finished };
}

module.exports = { generateCode, generateId, normalizeText, checkAnswer, toPublicGame, toPublicPlayer };

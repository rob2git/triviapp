const path = require("path");
const express = require("express");

const { readDb, mutate } = require("./lib/db");
const { hashPassword, verifyPassword, issueToken, revokeToken, requireAdmin } = require("./lib/auth");
const { generateCode, generateId, checkAnswer, toPublicGame, toPublicPlayer } = require("./lib/game-utils");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ---------------------------------------------------------------------------
// Admin: setup / login
// ---------------------------------------------------------------------------

app.get("/api/admin/status", (req, res) => {
  const db = readDb();
  res.json({ passwordSet: !!db.admin });
});

app.post("/api/admin/setup", async (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 4) {
    return res.status(400).json({ error: "Choose a password with at least 4 characters." });
  }
  // The "already set up?" check runs inside the mutation queue itself so two
  // setup requests arriving at the same instant can't both win.
  const result = await mutate((db) => {
    if (db.admin) return { error: "A host password is already set up." };
    db.admin = { passwordHash: hashPassword(String(password)) };
    return { ok: true };
  });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ token: issueToken() });
});

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  const db = readDb();
  if (!db.admin) {
    return res.status(400).json({ error: "No host password has been set up yet." });
  }
  if (!verifyPassword(String(password || ""), db.admin.passwordHash)) {
    return res.status(401).json({ error: "That password isn't right. Try again." });
  }
  res.json({ token: issueToken() });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  revokeToken(token);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Admin: manage games
// ---------------------------------------------------------------------------

app.get("/api/admin/games", requireAdmin, (req, res) => {
  const db = readDb();
  const list = Object.values(db.games)
    .map((g) => ({ code: g.code, title: g.title, questionCount: g.questions.length, timerSeconds: g.timerSeconds, createdAt: g.createdAt }))
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json({ games: list });
});

app.post("/api/admin/games", requireAdmin, async (req, res) => {
  const { title, timerSeconds, questions } = req.body || {};

  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: "Give the game a title." });
  }
  const timer = Number(timerSeconds);
  if (!timer || timer < 5) {
    return res.status(400).json({ error: "The timer needs to be at least 5 seconds." });
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: "Add at least one question before you create the game." });
  }
  for (const q of questions) {
    const label = (q.prompt || "").trim() || "One of your questions";
    if (!q.prompt || !String(q.prompt).trim()) {
      return res.status(400).json({ error: "Every question needs a prompt." });
    }
    if (q.type === "mc") {
      const filled = (q.options || []).filter((o) => o.text && String(o.text).trim());
      if (filled.length < 2) {
        return res.status(400).json({ error: `"${label}" needs at least two answer choices.` });
      }
      if (!q.correctOptionId || !filled.find((o) => o.id === q.correctOptionId)) {
        return res.status(400).json({ error: `Mark the correct choice for "${label}".` });
      }
    } else if (q.type === "text") {
      const filled = (q.acceptableAnswers || []).filter((a) => a && String(a).trim());
      if (filled.length === 0) {
        return res.status(400).json({ error: `Give at least one accepted answer for "${label}".` });
      }
    } else {
      return res.status(400).json({ error: "Each question must be multiple choice or open text." });
    }
  }

  const code = await mutate((db) => {
    const newCode = generateCode(Object.keys(db.games));
    const cleaned = questions.map((q) =>
      q.type === "mc"
        ? {
            id: q.id || generateId(),
            type: "mc",
            prompt: String(q.prompt).trim(),
            options: q.options.filter((o) => o.text && String(o.text).trim()).map((o) => ({ id: o.id || generateId(), text: String(o.text).trim() })),
            correctOptionId: q.correctOptionId,
          }
        : {
            id: q.id || generateId(),
            type: "text",
            prompt: String(q.prompt).trim(),
            acceptableAnswers: q.acceptableAnswers.filter((a) => a && String(a).trim()).map((a) => String(a).trim()),
          }
    );
    db.games[newCode] = { code: newCode, title: String(title).trim(), timerSeconds: timer, questions: cleaned, createdAt: Date.now() };
    db.players[newCode] = [];
    return newCode;
  });

  res.json({ code });
});

app.get("/api/admin/games/:code/results", requireAdmin, (req, res) => {
  const code = req.params.code.toUpperCase();
  const db = readDb();
  const game = db.games[code];
  if (!game) return res.status(404).json({ error: "That game doesn't exist." });
  const players = (db.players[code] || []).slice().sort((a, b) => b.score - a.score);
  res.json({
    game: { code: game.code, title: game.title, timerSeconds: game.timerSeconds, questionCount: game.questions.length },
    players,
  });
});

app.delete("/api/admin/games/:code", requireAdmin, async (req, res) => {
  const code = req.params.code.toUpperCase();
  await mutate((db) => {
    delete db.games[code];
    delete db.players[code];
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Public: players finding and joining a game
// ---------------------------------------------------------------------------

app.get("/api/games/:code", (req, res) => {
  const code = req.params.code.toUpperCase();
  const db = readDb();
  const game = db.games[code];
  if (!game) return res.status(404).json({ error: "We couldn't find a game with that code." });
  res.json({ game: toPublicGame(game) });
});

app.post("/api/games/:code/join", async (req, res) => {
  const code = req.params.code.toUpperCase();
  const name = String((req.body || {}).name || "").trim().slice(0, 24);
  if (!name) return res.status(400).json({ error: "Enter a name or handle to play under." });

  const result = await mutate((db) => {
    const game = db.games[code];
    if (!game) return { status: 404, error: "We couldn't find a game with that code." };
    const players = db.players[code] || (db.players[code] = []);
    if (players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return { status: 409, error: "That name is already taken in this game. Try another one." };
    }
    const player = {
      id: generateId(),
      name,
      score: 0,
      total: game.questions.length,
      currentIndex: 0,
      finished: false,
      joinedAt: Date.now(),
    };
    players.push(player);
    return { status: 200, playerId: player.id, game: toPublicGame(game) };
  });

  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ playerId: result.playerId, game: result.game });
});

app.post("/api/games/:code/answer", async (req, res) => {
  const code = req.params.code.toUpperCase();
  const { playerId, questionIndex, optionId, text } = req.body || {};

  const result = await mutate((db) => {
    const game = db.games[code];
    if (!game) return { status: 404, error: "That game doesn't exist." };
    const players = db.players[code] || [];
    const player = players.find((p) => p.id === playerId);
    if (!player) return { status: 404, error: "We lost track of you in this game — try rejoining." };
    if (player.finished) return { status: 409, error: "You've already finished this game." };
    if (Number(questionIndex) !== player.currentIndex) {
      return { status: 409, error: "Out of sync with the game.", currentIndex: player.currentIndex };
    }
    const q = game.questions[player.currentIndex];
    if (!q) return { status: 400, error: "Invalid question." };

    const correct = checkAnswer(q, optionId, text);
    if (correct) player.score += 1;
    player.currentIndex += 1;
    player.finished = player.currentIndex >= game.questions.length;
    if (player.finished) player.finishedAt = Date.now();

    return { status: 200, correct, score: player.score, finished: player.finished, nextIndex: player.currentIndex };
  });

  if (result.error) return res.status(result.status).json({ error: result.error, currentIndex: result.currentIndex });
  res.json(result);
});

app.get("/api/games/:code/leaderboard", (req, res) => {
  const code = req.params.code.toUpperCase();
  const db = readDb();
  const game = db.games[code];
  if (!game) return res.status(404).json({ error: "That game doesn't exist." });
  const players = (db.players[code] || []).slice().sort((a, b) => b.score - a.score).map(toPublicPlayer);
  res.json({ players });
});

// ---------------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------------

app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Last-resort error handler so a thrown error returns JSON instead of hanging.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(PORT, () => {
  console.log(`Trivia Night running at http://localhost:${PORT}`);
});

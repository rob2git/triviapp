// Trivia Night — vanilla JS frontend. No build step, no framework:
// `state` holds everything, `render()` redraws the current view, and
// small `bind*()` functions wire up event listeners after each render.

const root = document.getElementById("root");

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function newId() {
  return "tmp-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

async function api(path, { method = "GET", body, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth && state.admin.token) headers["Authorization"] = `Bearer ${state.admin.token}`;

  let res;
  try {
    res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (e) {
    const err = new Error("Couldn't reach the server. Check your connection and try again.");
    err.status = 0;
    throw err;
  }
  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    // no JSON body — leave data as {}
  }
  if (!res.ok) {
    const err = new Error(data.error || `Something went wrong (${res.status}).`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function blankMCQuestion() {
  return {
    id: newId(),
    type: "mc",
    prompt: "",
    options: [
      { id: newId(), text: "" },
      { id: newId(), text: "" },
    ],
    correctOptionId: null,
  };
}
function blankTextQuestion() {
  return { id: newId(), type: "text", prompt: "", acceptableAnswers: [""] };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  view: "home",
  loading: false,
  error: "",
  admin: { authed: false, token: localStorage.getItem("tv_admin_token") || null },
  games: [],
  deleteConfirmCode: "",
  copiedCode: "",
  editor: { title: "", timerSeconds: 60, questions: [] },
  createdCode: "",
  resultsGame: null,
  leaderboard: [],
  join: { code: "", name: "" },
  play: {
    game: null,
    playerId: null,
    playerName: "",
    qIndex: 0,
    secondsLeft: 60,
    selectedOptionId: null,
    textAnswer: "",
    score: 0,
    timerHandle: null,
    locking: false,
  },
};

// ---------------------------------------------------------------------------
// Navigation & admin auth
// ---------------------------------------------------------------------------

function goHome() {
  state.error = "";
  state.view = "home";
  render();
}

async function goAdmin() {
  state.error = "";
  if (state.admin.token) {
    state.loading = true;
    render();
    try {
      await loadGamesIndex();
      state.admin.authed = true;
      state.loading = false;
      state.view = "adminDashboard";
      render();
      return;
    } catch (e) {
      state.admin.token = null;
      localStorage.removeItem("tv_admin_token");
    }
  }
  state.loading = true;
  render();
  let passwordSet = false;
  try {
    const status = await api("/api/admin/status");
    passwordSet = status.passwordSet;
  } catch (e) {
    state.error = e.message;
  }
  state.loading = false;
  state.view = passwordSet ? "adminLogin" : "adminSetup";
  render();
}

async function handleAdminSetup(e) {
  e.preventDefault();
  state.error = "";
  const password = document.getElementById("input-new-password").value;
  const confirm = document.getElementById("input-confirm-password").value;
  if (password.length < 4) {
    state.error = "Choose a password with at least 4 characters.";
    render();
    return;
  }
  if (password !== confirm) {
    state.error = "Those passwords don't match.";
    render();
    return;
  }
  state.loading = true;
  render();
  try {
    const data = await api("/api/admin/setup", { method: "POST", body: { password } });
    state.admin.token = data.token;
    localStorage.setItem("tv_admin_token", data.token);
    state.admin.authed = true;
    await loadGamesIndex();
    state.loading = false;
    state.view = "adminDashboard";
    render();
  } catch (e) {
    state.loading = false;
    state.error = e.message;
    render();
  }
}

async function handleAdminLogin(e) {
  e.preventDefault();
  state.error = "";
  const password = document.getElementById("input-password").value;
  state.loading = true;
  render();
  try {
    const data = await api("/api/admin/login", { method: "POST", body: { password } });
    state.admin.token = data.token;
    localStorage.setItem("tv_admin_token", data.token);
    state.admin.authed = true;
    await loadGamesIndex();
    state.loading = false;
    state.view = "adminDashboard";
    render();
  } catch (e) {
    state.loading = false;
    state.error = e.message;
    render();
  }
}

async function handleAdminLogout() {
  try {
    await api("/api/admin/logout", { method: "POST", auth: true });
  } catch (e) {
    // token may already be invalid — fine, we're logging out anyway
  }
  state.admin.authed = false;
  state.admin.token = null;
  localStorage.removeItem("tv_admin_token");
  goHome();
}

async function loadGamesIndex() {
  const data = await api("/api/admin/games", { auth: true });
  state.games = data.games;
}

// ---------------------------------------------------------------------------
// Game editor
// ---------------------------------------------------------------------------

function openNewGameEditor() {
  state.error = "";
  state.editor = { title: "", timerSeconds: 60, questions: [] };
  state.view = "gameEditor";
  render();
}

function addMC() {
  state.editor.questions.push(blankMCQuestion());
  render();
}
function addText() {
  state.editor.questions.push(blankTextQuestion());
  render();
}
function removeQuestion(id) {
  state.editor.questions = state.editor.questions.filter((q) => q.id !== id);
  render();
}
function addOption(qid) {
  const q = state.editor.questions.find((q) => q.id === qid);
  if (q && q.options.length < 6) {
    q.options.push({ id: newId(), text: "" });
    render();
  }
}
function removeOption(qid, oid) {
  const q = state.editor.questions.find((q) => q.id === qid);
  if (q && q.options.length > 2) {
    q.options = q.options.filter((o) => o.id !== oid);
    if (q.correctOptionId === oid) q.correctOptionId = null;
    render();
  }
}
function addAcceptable(qid) {
  const q = state.editor.questions.find((q) => q.id === qid);
  if (q) {
    q.acceptableAnswers.push("");
    render();
  }
}
function removeAcceptable(qid, idx) {
  const q = state.editor.questions.find((q) => q.id === qid);
  if (q && q.acceptableAnswers.length > 1) {
    q.acceptableAnswers.splice(idx, 1);
    render();
  }
}

async function handleSaveGame() {
  state.error = "";
  const ed = state.editor;
  if (!ed.title.trim()) {
    state.error = "Give the game a title.";
    render();
    return;
  }
  if (ed.questions.length === 0) {
    state.error = "Add at least one question before you create the game.";
    render();
    return;
  }
  for (const q of ed.questions) {
    const label = q.prompt.trim() || "One of your questions";
    if (!q.prompt.trim()) {
      state.error = "Every question needs a prompt.";
      render();
      return;
    }
    if (q.type === "mc") {
      const filled = q.options.filter((o) => o.text.trim());
      if (filled.length < 2) {
        state.error = `"${label}" needs at least two answer choices.`;
        render();
        return;
      }
      if (!q.correctOptionId || !filled.find((o) => o.id === q.correctOptionId)) {
        state.error = `Mark the correct choice for "${label}".`;
        render();
        return;
      }
    } else {
      const filled = q.acceptableAnswers.filter((a) => a.trim());
      if (filled.length === 0) {
        state.error = `Give at least one accepted answer for "${label}".`;
        render();
        return;
      }
    }
  }
  const timer = Number(ed.timerSeconds);
  if (!timer || timer < 5) {
    state.error = "The timer needs to be at least 5 seconds.";
    render();
    return;
  }

  state.loading = true;
  render();
  try {
    const data = await api("/api/admin/games", {
      method: "POST",
      auth: true,
      body: { title: ed.title, timerSeconds: timer, questions: ed.questions },
    });
    state.createdCode = data.code;
    await loadGamesIndex();
    state.loading = false;
    state.view = "gameCreated";
    render();
  } catch (e) {
    state.loading = false;
    state.error = e.message;
    render();
  }
}

async function handleViewResults(code) {
  state.error = "";
  state.loading = true;
  render();
  try {
    const data = await api(`/api/admin/games/${code}/results`, { auth: true });
    state.resultsGame = data.game;
    state.leaderboard = data.players.slice().sort((a, b) => b.score - a.score);
    state.loading = false;
    state.view = "gameResults";
    render();
  } catch (e) {
    state.loading = false;
    state.error = e.message;
    render();
  }
}

async function handleDeleteGame(code) {
  state.loading = true;
  render();
  try {
    await api(`/api/admin/games/${code}`, { method: "DELETE", auth: true });
    await loadGamesIndex();
  } catch (e) {
    state.error = e.message;
  }
  state.deleteConfirmCode = "";
  state.loading = false;
  render();
}

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    state.copiedCode = code;
    render();
    setTimeout(() => {
      if (state.copiedCode === code) {
        state.copiedCode = "";
        render();
      }
    }, 1500);
  } catch (e) {
    // clipboard API not available — silently ignore, the code is still on screen
  }
}

// ---------------------------------------------------------------------------
// Player: join & play
// ---------------------------------------------------------------------------

async function handleJoinGame(e) {
  e.preventDefault();
  state.error = "";
  const code = state.join.code.trim().toUpperCase();
  const name = state.join.name.trim();
  if (code.length < 4) {
    state.error = "Enter the 4-character game code your host gave you.";
    render();
    return;
  }
  if (!name) {
    state.error = "Enter a name or handle to play under.";
    render();
    return;
  }
  state.loading = true;
  render();
  try {
    const data = await api(`/api/games/${code}/join`, { method: "POST", body: { name } });
    state.play.game = data.game;
    state.play.playerId = data.playerId;
    state.play.playerName = name;
    state.play.qIndex = 0;
    state.play.score = 0;
    state.play.selectedOptionId = null;
    state.play.textAnswer = "";
    state.play.secondsLeft = data.game.timerSeconds;
    state.play.locking = false;
    state.join = { code: "", name: "" };
    state.loading = false;
    state.view = "playerGame";
    render();
    startTimer();
  } catch (e) {
    state.loading = false;
    state.error = e.message;
    render();
  }
}

function startTimer() {
  clearTimer();
  state.play.timerHandle = setInterval(() => {
    state.play.secondsLeft -= 1;
    if (state.play.secondsLeft <= 0) {
      handleTimeUp();
    } else {
      render();
    }
  }, 1000);
}
function clearTimer() {
  if (state.play.timerHandle) {
    clearInterval(state.play.timerHandle);
    state.play.timerHandle = null;
  }
}

async function handleTimeUp() {
  if (state.play.locking) return;
  state.play.locking = true;
  render();
  try {
    const g = state.play.game;
    const q = g.questions[state.play.qIndex];
    const body = { playerId: state.play.playerId, questionIndex: state.play.qIndex };
    if (q.type === "mc") body.optionId = state.play.selectedOptionId;
    else body.text = state.play.textAnswer;

    const res = await api(`/api/games/${g.code}/answer`, { method: "POST", body });
    state.play.score = res.score;

    if (res.finished) {
      clearTimer();
      const lb = await api(`/api/games/${g.code}/leaderboard`);
      state.leaderboard = lb.players;
      state.resultsGame = g;
      state.view = "playerResults";
    } else {
      state.play.qIndex = res.nextIndex;
      state.play.selectedOptionId = null;
      state.play.textAnswer = "";
      state.play.secondsLeft = g.timerSeconds;
    }
  } catch (e) {
    // Network hiccup — leave state as-is and the next tick will retry.
  } finally {
    state.play.locking = false;
    render();
  }
}

function playAgain() {
  clearTimer();
  state.play = {
    game: null,
    playerId: null,
    playerName: "",
    qIndex: 0,
    secondsLeft: 60,
    selectedOptionId: null,
    textAnswer: "",
    score: 0,
    timerHandle: null,
    locking: false,
  };
  state.view = "home";
  render();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  root.innerHTML = renderTopbar() + renderMain();
  bindEvents();
}

function renderTopbar() {
  if (state.view === "playerGame") return "";
  const isAdminArea = ["adminLogin", "adminSetup", "adminDashboard", "gameEditor", "gameCreated", "gameResults"].includes(state.view);
  let right = "";
  if (isAdminArea) {
    if (state.admin.authed) right = `Hosting <button id="btn-admin-logout">Log out</button>`;
  } else {
    right = `<button id="btn-host-login">Host login</button>`;
  }
  return `
    <div class="tv-topbar">
      <button class="tv-wordmark" id="btn-home">Trivia Night</button>
      <div class="tv-topbar-right">${right}</div>
    </div>
  `;
}

function renderMain() {
  switch (state.view) {
    case "adminSetup":
      return renderAdminSetup();
    case "adminLogin":
      return renderAdminLogin();
    case "adminDashboard":
      return renderAdminDashboard();
    case "gameEditor":
      return renderGameEditor();
    case "gameCreated":
      return renderGameCreated();
    case "gameResults":
      return renderGameResults();
    case "playerJoin":
      return renderPlayerJoin();
    case "playerGame":
      return renderPlayerGame();
    case "playerResults":
      return renderPlayerResults();
    case "home":
    default:
      return renderHome();
  }
}

function renderHome() {
  return `
    <div class="tv-main">
      <div>
        <h1 class="tv-hero-title">Trivia Night</h1>
        <p class="tv-hero-sub">Host a round, or join one with a code.</p>
        <div class="tv-ticket">
          <div class="tv-ticket-half">
            <div class="tv-ticket-kicker">For hosts</div>
            <h2 class="tv-h2">Run a game</h2>
            <p class="tv-desc">Build a round with as many questions as you like, mix multiple-choice and open-text, and set how long each question stays on screen.</p>
            <button class="tv-btn tv-btn-primary" id="btn-host">Host a game</button>
          </div>
          <div class="tv-ticket-divider"></div>
          <div class="tv-ticket-half">
            <div class="tv-ticket-kicker">For players</div>
            <h2 class="tv-h2">Join a game</h2>
            <p class="tv-desc">Got a 4-character code from your host? Enter it with a name or handle and jump straight in.</p>
            <button class="tv-btn tv-btn-gold" id="btn-join">Join a game</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAdminSetup() {
  return `
    <div class="tv-main">
      <div class="tv-card">
        <h1 class="tv-h1">Set a host password</h1>
        <p class="tv-sub">No password is set up yet. Choose one to protect the host tools — you'll use it every time you come back to host.</p>
        ${state.error ? `<div class="tv-error">${escapeHtml(state.error)}</div>` : ""}
        <form id="form-admin-setup">
          <div class="tv-field">
            <label class="tv-label">New password</label>
            <input class="tv-input" type="password" id="input-new-password" autocomplete="new-password" />
          </div>
          <div class="tv-field">
            <label class="tv-label">Confirm password</label>
            <input class="tv-input" type="password" id="input-confirm-password" autocomplete="new-password" />
          </div>
          <button class="tv-btn tv-btn-primary" type="submit" ${state.loading ? "disabled" : ""}>${state.loading ? "Saving…" : "Set password and continue"}</button>
        </form>
        <p class="tv-hint" style="margin-top:14px">This protects the host tools on this site but isn't a full account system — don't reuse a sensitive password here.</p>
      </div>
    </div>
  `;
}

function renderAdminLogin() {
  return `
    <div class="tv-main">
      <div class="tv-card">
        <h1 class="tv-h1">Host login</h1>
        <p class="tv-sub">Enter the host password to create and manage games.</p>
        ${state.error ? `<div class="tv-error">${escapeHtml(state.error)}</div>` : ""}
        <form id="form-admin-login">
          <div class="tv-field">
            <label class="tv-label">Password</label>
            <input class="tv-input" type="password" id="input-password" autocomplete="current-password" />
          </div>
          <button class="tv-btn tv-btn-primary" type="submit" ${state.loading ? "disabled" : ""}>${state.loading ? "Checking…" : "Log in"}</button>
        </form>
      </div>
    </div>
  `;
}

function renderAdminDashboard() {
  const gamesHtml = state.games
    .map(
      (g) => `
    <div class="tv-game-row">
      <div class="tv-game-row-main">
        <div class="tv-game-title">${escapeHtml(g.title)}</div>
        <div class="tv-game-meta">${g.questionCount} question${g.questionCount === 1 ? "" : "s"} · ${g.timerSeconds}s per question</div>
      </div>
      <div class="tv-game-code">${g.code}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="tv-btn tv-btn-ghost tv-btn-sm btn-copy" data-code="${g.code}">${state.copiedCode === g.code ? "Copied!" : "Copy code"}</button>
        <button class="tv-btn tv-btn-ghost tv-btn-sm btn-results" data-code="${g.code}">Results</button>
        ${
          state.deleteConfirmCode === g.code
            ? `<button class="tv-btn tv-btn-danger tv-btn-sm btn-confirm-delete" data-code="${g.code}">Confirm delete</button>
               <button class="tv-btn tv-btn-ghost tv-btn-sm btn-cancel-delete">Cancel</button>`
            : `<button class="tv-btn tv-btn-danger tv-btn-sm btn-ask-delete" data-code="${g.code}">Delete</button>`
        }
      </div>
    </div>
  `
    )
    .join("");

  return `
    <div class="tv-main tv-align-top">
      <div class="tv-card tv-card-wide">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <h1 class="tv-h1" style="margin-bottom:0">Your games</h1>
          <button class="tv-btn tv-btn-primary tv-btn-sm" id="btn-new-game">+ New game</button>
        </div>
        <p class="tv-sub">Anyone with a game's code can join it from the home screen.</p>
        ${state.error ? `<div class="tv-error">${escapeHtml(state.error)}</div>` : ""}
        ${state.loading ? `<p class="tv-sub">Loading…</p>` : ""}
        ${
          !state.loading && state.games.length === 0
            ? `<div class="tv-empty">
                 <p>You haven't created any trivia games yet.</p>
                 <button class="tv-btn tv-btn-primary" style="max-width:220px;margin:12px auto 0" id="btn-first-game">Create your first game</button>
               </div>`
            : ""
        }
        ${!state.loading ? gamesHtml : ""}
      </div>
    </div>
  `;
}

function renderQuestionCard(q, i) {
  if (q.type === "mc") {
    const optionsHtml = q.options
      .map(
        (o) => `
      <div class="tv-option-row">
        <input type="radio" name="correct-${q.id}" data-qid="${q.id}" data-oid="${o.id}" class="radio-correct" ${q.correctOptionId === o.id ? "checked" : ""} />
        <input class="tv-input tv-input-dark option-text" data-qid="${q.id}" data-oid="${o.id}" placeholder="Answer choice" value="${escapeHtml(o.text)}" />
        ${q.options.length > 2 ? `<button class="tv-remove-btn btn-remove-option" data-qid="${q.id}" data-oid="${o.id}" aria-label="Remove choice">×</button>` : ""}
      </div>
    `
      )
      .join("");
    return `
      <div class="tv-qcard">
        <div class="tv-qcard-head">
          <span class="tv-qtype-badge">Multiple choice · Q${i + 1}</span>
          <button class="tv-remove-btn btn-remove-question" data-qid="${q.id}" aria-label="Remove question">×</button>
        </div>
        <div class="tv-field">
          <input class="tv-input tv-input-dark question-prompt" data-qid="${q.id}" placeholder="Question prompt" value="${escapeHtml(q.prompt)}" />
        </div>
        ${optionsHtml}
        ${q.options.length < 6 ? `<button class="tv-add-row-btn btn-add-option" data-qid="${q.id}">+ Add another choice</button>` : ""}
        <p class="tv-hint">Select the circle next to the correct choice.</p>
      </div>
    `;
  }
  const answersHtml = q.acceptableAnswers
    .map(
      (a, idx) => `
    <div class="tv-option-row">
      <input class="tv-input tv-input-dark acceptable-text" data-qid="${q.id}" data-idx="${idx}" placeholder="An answer that counts as correct" value="${escapeHtml(a)}" />
      ${q.acceptableAnswers.length > 1 ? `<button class="tv-remove-btn btn-remove-acceptable" data-qid="${q.id}" data-idx="${idx}" aria-label="Remove accepted answer">×</button>` : ""}
    </div>
  `
    )
    .join("");
  return `
    <div class="tv-qcard">
      <div class="tv-qcard-head">
        <span class="tv-qtype-badge">Open text · Q${i + 1}</span>
        <button class="tv-remove-btn btn-remove-question" data-qid="${q.id}" aria-label="Remove question">×</button>
      </div>
      <div class="tv-field">
        <input class="tv-input tv-input-dark question-prompt" data-qid="${q.id}" placeholder="Question prompt" value="${escapeHtml(q.prompt)}" />
      </div>
      <label class="tv-label tv-label-light" style="margin-top:4px">Accepted answers</label>
      ${answersHtml}
      <button class="tv-add-row-btn btn-add-acceptable" data-qid="${q.id}">+ Add another accepted answer</button>
      <p class="tv-hint">A player's typed answer is checked against this list — not case-sensitive, extra spaces ignored.</p>
    </div>
  `;
}

function renderGameEditor() {
  const ed = state.editor;
  const questionsHtml = ed.questions.map((q, i) => renderQuestionCard(q, i)).join("");
  return `
    <div class="tv-main tv-align-top">
      <div class="tv-card tv-card-wide" style="background:var(--ink-2);color:var(--text-light)">
        <h1 class="tv-h1">Create a game</h1>
        <p class="tv-sub-light">Add as many questions as you need. Players see one at a time, each for the number of seconds you set below.</p>
        ${state.error ? `<div class="tv-error tv-error-dark">${escapeHtml(state.error)}</div>` : ""}
        <div class="tv-field">
          <label class="tv-label tv-label-light">Game title</label>
          <input class="tv-input tv-input-dark" id="input-title" value="${escapeHtml(ed.title)}" placeholder="Friday Office Trivia" />
        </div>
        <div class="tv-field" style="max-width:220px">
          <label class="tv-label tv-label-light">Seconds per question</label>
          <input class="tv-input tv-input-dark" id="input-timer" type="number" min="5" max="600" value="${ed.timerSeconds}" />
          <p class="tv-hint">Default is 60 seconds. Applies to every question in this game.</p>
        </div>
        <h2 class="tv-h2" style="margin-top:28px;color:var(--text-light)">Questions (${ed.questions.length})</h2>
        ${questionsHtml}
        <div class="tv-add-question-row">
          <button class="tv-btn tv-btn-ghost-light" id="btn-add-mc">+ Multiple choice</button>
          <button class="tv-btn tv-btn-ghost-light" id="btn-add-text">+ Open text</button>
        </div>
        <div class="tv-btn-row">
          <button class="tv-btn tv-btn-ghost-light" id="btn-editor-cancel">Cancel</button>
          <button class="tv-btn tv-btn-gold" id="btn-save-game" ${state.loading ? "disabled" : ""}>${state.loading ? "Creating…" : "Create game"}</button>
        </div>
      </div>
    </div>
  `;
}

function renderGameCreated() {
  return `
    <div class="tv-main">
      <div class="tv-card">
        <h1 class="tv-h1">Game created</h1>
        <p class="tv-sub">Share this code with your players. They'll enter it on the home screen along with their name.</p>
        <div style="text-align:center;margin:24px 0">
          <div class="tv-game-code" style="font-size:40px;padding:16px 28px;display:inline-block">${state.createdCode}</div>
        </div>
        <div class="tv-btn-row" style="margin-bottom:12px">
          <button class="tv-btn tv-btn-ghost" id="btn-copy-created">${state.copiedCode === state.createdCode ? "Copied!" : "Copy code"}</button>
          <button class="tv-btn tv-btn-primary" id="btn-view-created-results">View results</button>
        </div>
        <button class="tv-link-btn" id="btn-back-dashboard">Back to your games</button>
      </div>
    </div>
  `;
}

function renderGameResults() {
  const g = state.resultsGame;
  if (!g) return `<div class="tv-main"><p class="tv-sub-light">Loading…</p></div>`;
  const rowsHtml = state.leaderboard
    .map(
      (p, i) => `
    <div class="tv-leader-row">
      <span class="tv-leader-rank">${i + 1}</span>
      <span class="tv-leader-name">${escapeHtml(p.name)}${!p.finished ? `<span style="color:var(--text-dim);font-weight:400"> · playing…</span>` : ""}</span>
      <span class="tv-leader-score">${p.score}/${p.total}</span>
    </div>
  `
    )
    .join("");
  return `
    <div class="tv-main tv-align-top">
      <div class="tv-card tv-card-wide" style="background:var(--ink-2);color:var(--text-light)">
        <h1 class="tv-h1">${escapeHtml(g.title)}</h1>
        <p class="tv-sub-light">Code <strong style="color:var(--gold)">${g.code}</strong> · ${g.questionCount} questions · ${g.timerSeconds}s each</p>
        ${state.leaderboard.length === 0 ? `<div class="tv-empty">No one's joined this game yet. Share the code to get players in.</div>` : rowsHtml}
        <button class="tv-link-btn tv-link-btn-light" style="margin-top:20px" id="btn-back-dashboard-2">Back to your games</button>
      </div>
    </div>
  `;
}

function renderPlayerJoin() {
  return `
    <div class="tv-main">
      <div class="tv-card">
        <h1 class="tv-h1">Join a game</h1>
        <p class="tv-sub">Enter the code your host gave you.</p>
        ${state.error ? `<div class="tv-error">${escapeHtml(state.error)}</div>` : ""}
        <form id="form-join">
          <div class="tv-field">
            <label class="tv-label">Game code</label>
            <input class="tv-input tv-code-input" id="input-code" value="${escapeHtml(state.join.code)}" placeholder="XXXX" maxlength="4" autocomplete="off" />
          </div>
          <div class="tv-field">
            <label class="tv-label">Your name or handle</label>
            <input class="tv-input" id="input-name" value="${escapeHtml(state.join.name)}" placeholder="e.g. Robert" maxlength="24" autocomplete="off" />
          </div>
          <button class="tv-btn tv-btn-gold" type="submit" ${state.loading ? "disabled" : ""}>${state.loading ? "Joining…" : "Join game"}</button>
        </form>
      </div>
    </div>
  `;
}

function renderPlayerGame() {
  const p = state.play;
  const g = p.game;
  if (!g) return `<div class="tv-main"><p class="tv-sub-light">Loading…</p></div>`;
  const q = g.questions[p.qIndex];
  const timerPct = Math.max(0, Math.min(100, (p.secondsLeft / g.timerSeconds) * 100));
  const bodyHtml =
    q.type === "mc"
      ? q.options
          .map(
            (o) => `
        <button class="tv-option-btn btn-option ${p.selectedOptionId === o.id ? "tv-selected" : ""}" data-oid="${o.id}" ${p.locking ? "disabled" : ""}>${escapeHtml(o.text)}</button>
      `
          )
          .join("")
      : `<input class="tv-input" id="input-text-answer" placeholder="Type your answer" value="${escapeHtml(p.textAnswer)}" ${p.locking ? "disabled" : ""} autocomplete="off" />`;

  return `
    <div class="tv-main">
      <div class="tv-play-wrap">
        <div class="tv-name-chip">Playing as ${escapeHtml(p.playerName)}</div>
        <div class="tv-play-meta">
          <span class="tv-play-progress">Question ${p.qIndex + 1} of ${g.questions.length}</span>
          <span class="tv-timer-num">${Math.max(0, p.secondsLeft)}s</span>
        </div>
        <div class="tv-timer-track"><div class="tv-timer-fill" style="width:${timerPct}%"></div></div>
        <div class="tv-play-card">
          <p class="tv-play-prompt">${escapeHtml(q.prompt)}</p>
          ${bodyHtml}
          <p class="tv-play-hint">${p.locking ? "Locking in your answer…" : "Your answer locks in automatically when the timer runs out."}</p>
        </div>
      </div>
    </div>
  `;
}

function renderPlayerResults() {
  const p = state.play;
  const totalFallback = state.leaderboard.find((x) => x.name === p.playerName);
  const total = p.game ? p.game.questions.length : totalFallback ? totalFallback.total : "";
  const rowsHtml = state.leaderboard
    .map(
      (pl, i) => `
    <div class="tv-leader-row tv-leader-row-light">
      <span class="tv-leader-rank tv-leader-rank-light">${i + 1}</span>
      <span class="tv-leader-name" style="font-weight:${pl.name === p.playerName ? 700 : 600}">${escapeHtml(pl.name)}</span>
      <span class="tv-leader-score tv-leader-score-light">${pl.score}/${pl.total}</span>
    </div>
  `
    )
    .join("");
  return `
    <div class="tv-main">
      <div class="tv-card">
        <h1 class="tv-h1">${state.resultsGame ? escapeHtml(state.resultsGame.title) : "Game finished"}</h1>
        <div class="tv-score-hero">
          <span class="tv-num">${p.score}/${total}</span>
          <span class="tv-label">your score, ${escapeHtml(p.playerName)}</span>
        </div>
        ${state.leaderboard.length > 0 ? `<h2 class="tv-h2">Leaderboard</h2>${rowsHtml}` : ""}
        <button class="tv-btn tv-btn-primary" style="margin-top:20px" id="btn-play-again">Back to home</button>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Event binding
// ---------------------------------------------------------------------------

function bindEvents() {
  document.getElementById("btn-home")?.addEventListener("click", goHome);
  document.getElementById("btn-host-login")?.addEventListener("click", goAdmin);
  document.getElementById("btn-admin-logout")?.addEventListener("click", handleAdminLogout);

  switch (state.view) {
    case "home":
      bindHome();
      break;
    case "adminSetup":
      bindAdminSetup();
      break;
    case "adminLogin":
      bindAdminLogin();
      break;
    case "adminDashboard":
      bindAdminDashboard();
      break;
    case "gameEditor":
      bindGameEditor();
      break;
    case "gameCreated":
      bindGameCreated();
      break;
    case "gameResults":
      bindGameResults();
      break;
    case "playerJoin":
      bindPlayerJoin();
      break;
    case "playerGame":
      bindPlayerGame();
      break;
    case "playerResults":
      bindPlayerResults();
      break;
  }
}

function bindHome() {
  document.getElementById("btn-host")?.addEventListener("click", goAdmin);
  document.getElementById("btn-join")?.addEventListener("click", () => {
    state.view = "playerJoin";
    render();
  });
}

function bindAdminSetup() {
  document.getElementById("form-admin-setup")?.addEventListener("submit", handleAdminSetup);
  document.getElementById("input-new-password")?.focus();
}

function bindAdminLogin() {
  document.getElementById("form-admin-login")?.addEventListener("submit", handleAdminLogin);
  document.getElementById("input-password")?.focus();
}

function bindAdminDashboard() {
  document.getElementById("btn-new-game")?.addEventListener("click", openNewGameEditor);
  document.getElementById("btn-first-game")?.addEventListener("click", openNewGameEditor);
  document.querySelectorAll(".btn-copy").forEach((btn) => btn.addEventListener("click", () => copyCode(btn.dataset.code)));
  document.querySelectorAll(".btn-results").forEach((btn) => btn.addEventListener("click", () => handleViewResults(btn.dataset.code)));
  document.querySelectorAll(".btn-ask-delete").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.deleteConfirmCode = btn.dataset.code;
      render();
    })
  );
  document.querySelectorAll(".btn-confirm-delete").forEach((btn) => btn.addEventListener("click", () => handleDeleteGame(btn.dataset.code)));
  document.querySelectorAll(".btn-cancel-delete").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.deleteConfirmCode = "";
      render();
    })
  );
}

function bindGameEditor() {
  document.getElementById("input-title")?.addEventListener("input", (e) => {
    state.editor.title = e.target.value;
  });
  document.getElementById("input-timer")?.addEventListener("input", (e) => {
    state.editor.timerSeconds = e.target.value;
  });
  document.getElementById("btn-add-mc")?.addEventListener("click", addMC);
  document.getElementById("btn-add-text")?.addEventListener("click", addText);
  document.getElementById("btn-editor-cancel")?.addEventListener("click", () => {
    state.view = "adminDashboard";
    render();
  });
  document.getElementById("btn-save-game")?.addEventListener("click", handleSaveGame);

  document.querySelectorAll(".btn-remove-question").forEach((btn) => btn.addEventListener("click", () => removeQuestion(btn.dataset.qid)));
  document.querySelectorAll(".question-prompt").forEach((input) =>
    input.addEventListener("input", (e) => {
      const q = state.editor.questions.find((q) => q.id === input.dataset.qid);
      if (q) q.prompt = e.target.value;
    })
  );
  document.querySelectorAll(".radio-correct").forEach((radio) =>
    radio.addEventListener("change", () => {
      const q = state.editor.questions.find((q) => q.id === radio.dataset.qid);
      if (q) q.correctOptionId = radio.dataset.oid;
    })
  );
  document.querySelectorAll(".option-text").forEach((input) =>
    input.addEventListener("input", (e) => {
      const q = state.editor.questions.find((q) => q.id === input.dataset.qid);
      const o = q && q.options.find((o) => o.id === input.dataset.oid);
      if (o) o.text = e.target.value;
    })
  );
  document.querySelectorAll(".btn-remove-option").forEach((btn) => btn.addEventListener("click", () => removeOption(btn.dataset.qid, btn.dataset.oid)));
  document.querySelectorAll(".btn-add-option").forEach((btn) => btn.addEventListener("click", () => addOption(btn.dataset.qid)));
  document.querySelectorAll(".acceptable-text").forEach((input) =>
    input.addEventListener("input", (e) => {
      const q = state.editor.questions.find((q) => q.id === input.dataset.qid);
      if (q) q.acceptableAnswers[Number(input.dataset.idx)] = e.target.value;
    })
  );
  document.querySelectorAll(".btn-remove-acceptable").forEach((btn) => btn.addEventListener("click", () => removeAcceptable(btn.dataset.qid, Number(btn.dataset.idx))));
  document.querySelectorAll(".btn-add-acceptable").forEach((btn) => btn.addEventListener("click", () => addAcceptable(btn.dataset.qid)));
}

function bindGameCreated() {
  document.getElementById("btn-copy-created")?.addEventListener("click", () => copyCode(state.createdCode));
  document.getElementById("btn-view-created-results")?.addEventListener("click", () => handleViewResults(state.createdCode));
  document.getElementById("btn-back-dashboard")?.addEventListener("click", () => {
    state.view = "adminDashboard";
    render();
  });
}

function bindGameResults() {
  document.getElementById("btn-back-dashboard-2")?.addEventListener("click", () => {
    state.view = "adminDashboard";
    render();
  });
}

function bindPlayerJoin() {
  const codeInput = document.getElementById("input-code");
  codeInput?.addEventListener("input", (e) => {
    state.join.code = e.target.value.toUpperCase().slice(0, 4);
    e.target.value = state.join.code;
  });
  document.getElementById("input-name")?.addEventListener("input", (e) => {
    state.join.name = e.target.value.slice(0, 24);
  });
  document.getElementById("form-join")?.addEventListener("submit", handleJoinGame);
  if (!state.join.code) codeInput?.focus();
}

function bindPlayerGame() {
  document.querySelectorAll(".btn-option").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.play.selectedOptionId = btn.dataset.oid;
      render();
    })
  );
  document.getElementById("input-text-answer")?.addEventListener("input", (e) => {
    state.play.textAnswer = e.target.value;
  });
}

function bindPlayerResults() {
  document.getElementById("btn-play-again")?.addEventListener("click", playAgain);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
  const params = new URLSearchParams(window.location.search);
  const codeParam = params.get("code");
  if (codeParam) {
    state.join.code = codeParam.toUpperCase().slice(0, 4);
    state.view = "playerJoin";
  }
  render();
}

init();

import {
  STORAGE_KEY,
  formatScore,
  loadState,
  saveState
} from "./store.js";

const AUTO_REFRESH_INTERVAL = 1000;

const tableRoot = document.querySelector("#table-root");
const saveStatus = document.querySelector("#save-status");
const storageMode = document.querySelector("#storage-mode");
const refreshButton = document.querySelector("#refresh-button");
const saveButton = document.querySelector("#save-button");

let state = null;
let currentMode = "local";
let stateSignature = "";
let layoutSignature = "";
let hasUnsavedChanges = false;
const dirtyScoreKeys = new Set();

init();

async function init() {
  await reloadState({ forceRender: true });

  refreshButton.addEventListener("click", refreshState);
  saveButton.addEventListener("click", persistState);
  window.addEventListener("storage", handleStorageUpdate);
  window.addEventListener("beforeunload", warnAboutUnsavedChanges);
  window.setInterval(refreshVisibleBoard, AUTO_REFRESH_INTERVAL);
}

async function reloadState(options = {}) {
  const { forceRender = false, silent = false } = options;

  if (!silent) {
    setStatus("Загрузка");
  }

  const result = await loadState();
  applyLoadedState(result, { forceRender });

  if (!silent) {
    setStatus(hasUnsavedChanges ? "Есть изменения" : "Готово");
  }
}

async function refreshState() {
  await reloadState();
}

async function refreshVisibleBoard() {
  if (document.visibilityState !== "visible") {
    return;
  }

  const result = await loadState();
  applyLoadedState(result);
}

function handleStorageUpdate(event) {
  if (event.key !== STORAGE_KEY) {
    return;
  }

  reloadState({ silent: true });
}

function warnAboutUnsavedChanges(event) {
  if (!hasUnsavedChanges) {
    return;
  }

  event.preventDefault();
  event.returnValue = "";
}

function applyLoadedState(result, options = {}) {
  const { forceRender = false } = options;
  const nextState = hasUnsavedChanges ? mergeDirtyScores(result.state) : result.state;
  const nextSignature = JSON.stringify(nextState);
  const nextLayoutSignature = getLayoutSignature(nextState);
  const shouldRender = forceRender || !state || nextLayoutSignature !== layoutSignature;
  const shouldUpdateScores = !shouldRender && nextSignature !== stateSignature;

  state = nextState;
  currentMode = result.mode;
  stateSignature = nextSignature;
  layoutSignature = nextLayoutSignature;

  if (shouldRender) {
    renderBoard();
  } else if (shouldUpdateScores) {
    updateScoreInputs();
  }

  updateModeLabel();
  updateSaveButton();
}

function renderBoard() {
  tableRoot.replaceChildren();

  if (!state.players.length || !state.games.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";

    const label = document.createElement("strong");
    label.textContent = "Таблица пустая";

    empty.append(label);
    tableRoot.append(empty);
    return;
  }

  const scroller = document.createElement("div");
  scroller.className = "table-scroller";

  const board = document.createElement("div");
  board.className = "scoreboard-grid";
  board.style.setProperty("--game-count", state.games.length);
  board.style.setProperty("--player-count", state.players.length);

  const gamesStrip = document.createElement("div");
  gamesStrip.className = "games-strip";
  gamesStrip.setAttribute("aria-label", "Игры");

  for (const game of state.games) {
    gamesStrip.append(createGameCard(game));
  }

  const body = document.createElement("div");
  body.className = "scoreboard-body";

  const playerLabels = document.createElement("div");
  playerLabels.className = "player-labels";
  playerLabels.setAttribute("aria-label", "Игроки");

  for (const player of state.players) {
    playerLabels.append(createPlayerLabel(player));
  }

  const scoreGrid = document.createElement("div");
  scoreGrid.className = "score-grid";
  scoreGrid.setAttribute("role", "table");
  scoreGrid.setAttribute("aria-label", "Очки по играм");

  for (const player of state.players) {
    for (const game of state.games) {
      scoreGrid.append(createScoreCell(player, game));
    }
  }

  body.append(playerLabels, scoreGrid);
  board.append(gamesStrip, body);
  scroller.append(board);
  tableRoot.append(scroller);
}

function createGameCard(game) {
  const card = document.createElement("div");
  card.className = "game-card";
  card.style.setProperty("--game-color", game.color);

  const icon = document.createElement("img");
  icon.className = "game-icon";
  icon.src = game.icon;
  icon.alt = game.title;

  const title = document.createElement("span");
  title.className = "game-title";
  title.textContent = game.title;

  card.append(icon, title);
  return card;
}

function createPlayerLabel(player) {
  const label = document.createElement("div");
  label.className = "player-label";
  label.textContent = player.name;
  return label;
}

function createScoreCell(player, game) {
  const cell = document.createElement("div");
  cell.className = "score-cell";
  cell.style.setProperty("--game-color", game.color);
  cell.setAttribute("role", "cell");

  const input = document.createElement("input");
  input.className = "score-input";
  input.type = "number";
  input.step = "1";
  input.inputMode = "decimal";
  input.min = "0";
  input.value = formatScore(state.scores[player.id]?.[game.id]);
  input.dataset.playerId = player.id;
  input.dataset.gameId = game.id;
  input.setAttribute("aria-label", `${player.name}, ${game.title}`);

  input.addEventListener("input", () => {
    updateScore(player.id, game.id, input.value);
    markDirty(player.id, game.id);
  });

  cell.append(input);
  return cell;
}

function updateScore(playerId, gameId, rawValue) {
  state.scores[playerId] ||= {};

  if (rawValue === "") {
    delete state.scores[playerId][gameId];
    return;
  }

  const value = Number(rawValue);

  if (Number.isFinite(value)) {
    state.scores[playerId][gameId] = value;
  }
}

function markDirty(playerId, gameId) {
  dirtyScoreKeys.add(createScoreKey(playerId, gameId));
  hasUnsavedChanges = true;
  setStatus("Есть изменения");
  updateSaveButton();
}

async function persistState() {
  if (!state) {
    return;
  }

  setStatus("Сохранение");
  saveButton.disabled = true;

  const latest = await loadState();
  const stateToSave = hasUnsavedChanges ? mergeDirtyScores(latest.state) : state;
  const result = await saveState(stateToSave);
  dirtyScoreKeys.clear();
  hasUnsavedChanges = false;
  applyLoadedState(result, { forceRender: true });
  setStatus(statusReadyText());
}

function updateScoreInputs() {
  for (const input of tableRoot.querySelectorAll(".score-input")) {
    const { playerId, gameId } = input.dataset;

    if (!playerId || !gameId || dirtyScoreKeys.has(createScoreKey(playerId, gameId))) {
      continue;
    }

    input.value = formatScore(state.scores[playerId]?.[gameId]);
  }
}

function mergeDirtyScores(nextState) {
  if (!state || !dirtyScoreKeys.size) {
    return nextState;
  }

  const playerIds = new Set(nextState.players.map((player) => player.id));
  const gameIds = new Set(nextState.games.map((game) => game.id));

  for (const key of [...dirtyScoreKeys]) {
    const { playerId, gameId } = parseScoreKey(key);

    if (!playerIds.has(playerId) || !gameIds.has(gameId)) {
      dirtyScoreKeys.delete(key);
      continue;
    }

    nextState.scores[playerId] ||= {};

    if (Object.prototype.hasOwnProperty.call(state.scores[playerId] || {}, gameId)) {
      nextState.scores[playerId][gameId] = state.scores[playerId][gameId];
    } else {
      delete nextState.scores[playerId][gameId];
    }
  }

  hasUnsavedChanges = dirtyScoreKeys.size > 0;
  return nextState;
}

function getLayoutSignature(nextState) {
  return JSON.stringify({
    players: nextState.players,
    games: nextState.games
  });
}

function createScoreKey(playerId, gameId) {
  return `${playerId}:${gameId}`;
}

function parseScoreKey(key) {
  const separatorIndex = key.indexOf(":");

  return {
    playerId: key.slice(0, separatorIndex),
    gameId: key.slice(separatorIndex + 1)
  };
}

function updateModeLabel() {
  storageMode.textContent = currentMode === "cloud" ? "Cloudflare KV" : "localStorage";
}

function updateSaveButton() {
  saveButton.disabled = !hasUnsavedChanges;
}

function statusReadyText() {
  return currentMode === "cloud" ? "Сохранено" : "Локально";
}

function setStatus(text) {
  saveStatus.textContent = text;
}

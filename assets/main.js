import {
  STORAGE_KEY,
  calculatePlayerTotal,
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

  state.players.forEach((player, playerIndex) => {
    playerLabels.append(createPlayerLabel(player, playerIndex === state.players.length - 1));
  });

  const scoreGrid = document.createElement("div");
  scoreGrid.className = "score-grid";
  scoreGrid.setAttribute("role", "table");
  scoreGrid.setAttribute("aria-label", "Очки по играм");

  state.players.forEach((player, playerIndex) => {
    const isLastRow = playerIndex === state.players.length - 1;

    for (const game of state.games) {
      scoreGrid.append(createScoreCell(player, game, { isLastRow }));
    }

    scoreGrid.append(createTotalCell(player, { isLastRow }));
  });

  body.append(playerLabels, scoreGrid);
  board.append(gamesStrip, body);
  scroller.append(board);
  tableRoot.append(scroller);
}

function createGameCard(game) {
  const card = document.createElement("div");
  card.className = "game-card";
  card.classList.toggle("has-title", game.showTitle === true);
  card.style.setProperty("--game-color", game.color);
  card.style.setProperty("--game-rgb", hexToRgb(game.color));
  card.style.setProperty("--game-logo-size", `${73 * ((game.scale || 100) / 100)}px`);
  card.style.setProperty("--game-logo-title-size", `${62 * ((game.scale || 100) / 100)}px`);
  card.style.setProperty("--game-logo-offset-y", `${game.offsetY || 0}px`);
  card.title = game.title;

  const icon = document.createElement("img");
  icon.className = "game-icon";
  icon.src = game.icon;
  icon.alt = game.title;

  card.append(icon);

  if (game.showTitle === true) {
    const title = document.createElement("span");
    title.className = "game-title";
    title.textContent = game.title;
    card.append(title);
  }

  return card;
}

function hexToRgb(hex) {
  if (typeof hex !== "string") {
    return "255, 255, 255";
  }

  const value = hex.replace("#", "");
  const number = Number.parseInt(value, 16);

  if (!Number.isFinite(number)) {
    return "255, 255, 255";
  }

  return `${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}`;
}

function createPlayerLabel(player, isLastRow = false) {
  const label = document.createElement("div");
  label.className = "player-label";
  label.classList.toggle("is-last-row", isLastRow);
  label.textContent = player.name;
  return label;
}

function createScoreCell(player, game, options = {}) {
  const { isLastRow = false } = options;
  const cell = document.createElement("div");
  cell.className = "score-cell";
  cell.classList.toggle("is-last-row", isLastRow);
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
    updatePlayerTotal(player.id);
    markDirty(player.id, game.id);
  });

  cell.append(input);
  return cell;
}

function createTotalCell(player, options = {}) {
  const { isLastRow = false } = options;
  const cell = document.createElement("div");
  cell.className = "total-cell";
  cell.classList.toggle("is-last-row", isLastRow);
  cell.dataset.totalFor = player.id;
  cell.setAttribute("role", "cell");
  cell.setAttribute("aria-label", `Итог ${player.name}`);
  cell.textContent = formatScore(calculatePlayerTotal(state, player.id));
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

  updateAllTotals();
}

function updatePlayerTotal(playerId) {
  const totalCell = tableRoot.querySelector(`[data-total-for="${CSS.escape(playerId)}"]`);

  if (totalCell) {
    totalCell.textContent = formatScore(calculatePlayerTotal(state, playerId));
  }
}

function updateAllTotals() {
  for (const player of state.players) {
    updatePlayerTotal(player.id);
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
  if (storageMode) {
    storageMode.textContent = "";
  }
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

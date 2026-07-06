import {
  STORAGE_KEY,
  calculatePlayerTotal,
  formatScore,
  loadState,
  saveScorePatch
} from "./store.js";

const AUTO_REFRESH_INTERVAL = 1000;
const AUTO_SAVE_DELAY = 700;
const SORT_APPLY_DELAY = 10000;
const STATUS_HIDE_DELAY = 4000;
const TABLE_SCALE_STORAGE_KEY = "goodwin-cup-table-scale-v1";
const DEFAULT_TABLE_SCALE = 100;
const MIN_TABLE_SCALE = 60;
const MAX_TABLE_SCALE = 160;

const tableRoot = document.querySelector("#table-root");
const saveStatus = document.querySelector("#save-status");
const storageMode = document.querySelector("#storage-mode");
const refreshButton = document.querySelector("#refresh-button");
const saveButton = document.querySelector("#save-button");
const tableScaleInput = document.querySelector("#table-scale");
const tableScaleValue = document.querySelector("#table-scale-value");

let state = null;
let currentMode = "local";
let latestRevision = 0;
let stateSignature = "";
let layoutSignature = "";
let hasUnsavedChanges = false;
let statusHideTimer = 0;
let autoSaveTimer = 0;
let sortApplyTimer = 0;
let sortingPausedUntil = 0;
let currentTableScale = DEFAULT_TABLE_SCALE;
let isSaveInFlight = false;
let saveAgainAfterCurrent = false;
let refreshInFlight = false;
let visiblePlayerOrder = [];
const dirtyScoreKeys = new Set();

init();

async function init() {
  initTableScale();
  await reloadState({ forceRender: true });

  refreshButton.addEventListener("click", refreshState);
  saveButton.addEventListener("click", persistState);
  tableScaleInput?.addEventListener("input", handleTableScaleInput);
  window.addEventListener("storage", handleStorageUpdate);
  window.addEventListener("resize", updateTableScaleLayout);
  window.addEventListener("beforeunload", warnAboutUnsavedChanges);
  document.addEventListener("visibilitychange", refreshVisibleBoard);
  window.setInterval(refreshVisibleBoard, AUTO_REFRESH_INTERVAL);
}

function initTableScale() {
  if (tableScaleInput) {
    tableScaleInput.min = String(MIN_TABLE_SCALE);
    tableScaleInput.max = String(MAX_TABLE_SCALE);
    tableScaleInput.step = "5";
  }

  applyTableScale(readStoredTableScale());
}

function handleTableScaleInput() {
  const scale = normalizeTableScale(tableScaleInput?.value);
  applyTableScale(scale);
  writeStoredTableScale(scale);
}

function applyTableScale(scale) {
  const normalizedScale = normalizeTableScale(scale);

  currentTableScale = normalizedScale;
  tableRoot.style.setProperty("--table-scale", String(normalizedScale / 100));
  updateTableScaleLayout();
  updateGameLogoScaleVariables();

  if (tableScaleInput) {
    tableScaleInput.value = String(normalizedScale);
  }

  if (tableScaleValue) {
    tableScaleValue.value = `${normalizedScale}%`;
    tableScaleValue.textContent = `${normalizedScale}%`;
  }
}

function updateTableScaleLayout() {
  const factor = currentTableScale / 100;
  const metrics = getTableScaleMetrics();

  tableRoot.style.setProperty("--score-cell-size-scaled", `${roundCssPx(metrics.scoreCellSize * factor)}px`);
  tableRoot.style.setProperty("--total-cell-width-scaled", `${roundCssPx(metrics.totalCellWidth * factor)}px`);
  tableRoot.style.setProperty("--player-label-width-scaled", `${roundCssPx(metrics.playerLabelWidth * factor)}px`);
  tableRoot.style.setProperty("--player-label-font-size-scaled", `${roundCssPx(metrics.playerLabelFontSize * factor)}px`);
  tableRoot.style.setProperty("--score-number-font-size-scaled", `${roundCssPx(metrics.scoreNumberFontSize * factor)}px`);
  tableRoot.style.setProperty("--game-title-font-size-scaled", `${roundCssPx(metrics.gameTitleFontSize * factor)}px`);
  tableRoot.style.setProperty("--scoreboard-shadow-height-scaled", `${roundCssPx(64 * factor)}px`);
}

function updateGameLogoScaleVariables() {
  if (!state?.games?.length) {
    return;
  }

  const gameCards = tableRoot.querySelectorAll(".game-card");

  state.games.forEach((game, index) => {
    const card = gameCards[index];

    if (card) {
      setGameLogoScaleVariables(card, game);
    }
  });
}

function getTableScaleMetrics() {
  const viewportWidth = window.innerWidth;

  if (viewportWidth <= 640) {
    return {
      scoreCellSize: 68,
      totalCellWidth: 94,
      playerLabelWidth: 150,
      ...getResponsiveFontMetrics(viewportWidth)
    };
  }

  if (viewportWidth <= 980) {
    return {
      scoreCellSize: 78,
      totalCellWidth: 104,
      playerLabelWidth: 180,
      ...getResponsiveFontMetrics(viewportWidth)
    };
  }

  return {
    scoreCellSize: clampNumber(viewportWidth * 0.078, 72, 104),
    totalCellWidth: clampNumber(viewportWidth * 0.09, 92, 132),
    playerLabelWidth: clampNumber(viewportWidth * 0.2, 160, 260),
    ...getResponsiveFontMetrics(viewportWidth)
  };
}

function getResponsiveFontMetrics(viewportWidth) {
  return {
    playerLabelFontSize: clampNumber(viewportWidth * 0.03, 24, 42),
    scoreNumberFontSize: clampNumber(viewportWidth * 0.045, 33, 51),
    gameTitleFontSize: clampNumber(viewportWidth * 0.015, 12, 18)
  };
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundCssPx(value) {
  return Math.round(value * 100) / 100;
}

function readStoredTableScale() {
  try {
    return normalizeTableScale(localStorage.getItem(TABLE_SCALE_STORAGE_KEY));
  } catch (error) {
    console.debug("Could not read local table scale.", error);
    return DEFAULT_TABLE_SCALE;
  }
}

function writeStoredTableScale(scale) {
  try {
    localStorage.setItem(TABLE_SCALE_STORAGE_KEY, String(normalizeTableScale(scale)));
  } catch (error) {
    console.debug("Could not write local table scale.", error);
  }
}

function normalizeTableScale(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return DEFAULT_TABLE_SCALE;
  }

  const stepped = Math.round(number / 5) * 5;
  return Math.min(MAX_TABLE_SCALE, Math.max(MIN_TABLE_SCALE, stepped));
}

async function reloadState(options = {}) {
  const { forceRender = false, silent = false, completeMessage = "Готово" } = options;

  if (!silent) {
    setStatus("Загрузка", "info", { autoHide: false });
  }

  try {
    const result = await loadState();
    applyLoadedState(result, { forceRender });

    if (!silent) {
      setStatus(hasUnsavedChanges ? "Есть несохранённые изменения" : completeMessage, hasUnsavedChanges ? "warning" : "success");
    }
  } catch (error) {
    console.error("Could not load tournament state.", error);

    if (!silent) {
      setStatus("Ошибка загрузки", "error");
    }
  }
}

async function refreshState() {
  await reloadState({ completeMessage: "Обновлено" });
}

async function refreshVisibleBoard() {
  if (document.visibilityState !== "visible" || refreshInFlight) {
    return;
  }

  refreshInFlight = true;

  try {
    const result = await loadState();
    applyLoadedState(result);
  } catch (error) {
    console.debug("Could not refresh tournament state.", error);
  } finally {
    refreshInFlight = false;
  }
}

function handleStorageUpdate(event) {
  if (event.key === TABLE_SCALE_STORAGE_KEY) {
    applyTableScale(readStoredTableScale());
    return;
  }

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

  if (isStaleResult(result)) {
    return;
  }

  latestRevision = Math.max(latestRevision, result.revision || 0);

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
    visiblePlayerOrder = [];

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
  const visiblePlayers = getVisiblePlayers(state);
  visiblePlayerOrder = visiblePlayers.map((player) => player.id);

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

  visiblePlayers.forEach((player, playerIndex) => {
    playerLabels.append(createPlayerLabel(player, playerIndex === visiblePlayers.length - 1));
  });

  const scoreGrid = document.createElement("div");
  scoreGrid.className = "score-grid";
  scoreGrid.setAttribute("role", "table");
  scoreGrid.setAttribute("aria-label", "Очки по играм");

  visiblePlayers.forEach((player, playerIndex) => {
    const isLastRow = playerIndex === visiblePlayers.length - 1;

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
  setGameLogoScaleVariables(card, game);
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

function setGameLogoScaleVariables(card, game) {
  const gameScale = (game.scale || 100) / 100;
  const tableScale = currentTableScale / 100;

  card.style.setProperty("--game-logo-size", `${roundCssPx(73 * gameScale * tableScale)}px`);
  card.style.setProperty("--game-logo-title-size", `${roundCssPx(62 * gameScale * tableScale)}px`);
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
  scheduleSortApply();
  scheduleAutoSave();
  updateSaveButton();
}

async function persistState(options = {}) {
  const { silent = false } = options;

  window.clearTimeout(autoSaveTimer);

  if (!state || !dirtyScoreKeys.size) {
    return;
  }

  if (isSaveInFlight) {
    saveAgainAfterCurrent = true;
    return;
  }

  if (!silent) {
    setStatus("Сохранение", "info", { autoHide: false });
  }

  saveButton.disabled = true;
  isSaveInFlight = true;

  const { patch, savedValues } = buildDirtyScorePatch();

  if (!savedValues.size) {
    isSaveInFlight = false;
    hasUnsavedChanges = dirtyScoreKeys.size > 0;
    updateSaveButton();
    return;
  }

  try {
    const result = await saveScorePatch(patch, state);
    removeSavedDirtyKeys(savedValues);
    hasUnsavedChanges = dirtyScoreKeys.size > 0;
    applyLoadedState(result);

    if (!silent) {
      setStatus(statusReadyText(), currentMode === "cloud" ? "success" : "warning");
    }
  } catch (error) {
    console.error("Could not save tournament state.", error);
    setStatus("Ошибка сохранения", "error");
  } finally {
    isSaveInFlight = false;
    updateSaveButton();

    if (saveAgainAfterCurrent || dirtyScoreKeys.size) {
      saveAgainAfterCurrent = false;
      scheduleAutoSave();
    }
  }
}

function scheduleAutoSave() {
  window.clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(() => persistState({ silent: true }), AUTO_SAVE_DELAY);
}

function scheduleSortApply() {
  sortingPausedUntil = Date.now() + SORT_APPLY_DELAY;
  window.clearTimeout(sortApplyTimer);
  sortApplyTimer = window.setTimeout(applyDeferredSorting, SORT_APPLY_DELAY);
}

function applyDeferredSorting() {
  sortingPausedUntil = 0;

  if (!state) {
    return;
  }

  const nextLayoutSignature = getLayoutSignature(state);

  if (nextLayoutSignature !== layoutSignature) {
    layoutSignature = nextLayoutSignature;
    renderBoard();
  }
}

function buildDirtyScorePatch() {
  const patch = {};
  const savedValues = new Map();
  const playerIds = new Set(state.players.map((player) => player.id));
  const gameIds = new Set(state.games.map((game) => game.id));

  for (const key of dirtyScoreKeys) {
    const { playerId, gameId } = parseScoreKey(key);

    if (!playerIds.has(playerId) || !gameIds.has(gameId)) {
      dirtyScoreKeys.delete(key);
      continue;
    }

    const value = getCurrentScorePatchValue(playerId, gameId);
    patch[playerId] ||= {};
    patch[playerId][gameId] = value;
    savedValues.set(key, value);
  }

  return { patch, savedValues };
}

function getCurrentScorePatchValue(playerId, gameId) {
  if (Object.prototype.hasOwnProperty.call(state.scores[playerId] || {}, gameId)) {
    return state.scores[playerId][gameId];
  }

  return null;
}

function removeSavedDirtyKeys(savedValues) {
  for (const [key, savedValue] of savedValues) {
    const { playerId, gameId } = parseScoreKey(key);

    if (getCurrentScorePatchValue(playerId, gameId) === savedValue) {
      dirtyScoreKeys.delete(key);
    }
  }
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

function isStaleResult(result) {
  return result?.mode === "cloud"
    && result.revision > 0
    && latestRevision > 0
    && result.revision < latestRevision;
}

function getPlayersSortedByTotal(nextState) {
  return nextState.players
    .map((player, index) => ({
      player,
      index,
      total: calculatePlayerTotal(nextState, player.id)
    }))
    .sort((left, right) => right.total - left.total || left.index - right.index)
    .map(({ player }) => player);
}

function getVisiblePlayers(nextState) {
  const sortedPlayers = getPlayersSortedByTotal(nextState);

  if (!isSortingPaused() || !visiblePlayerOrder.length) {
    return sortedPlayers;
  }

  const playersById = new Map(nextState.players.map((player) => [player.id, player]));
  const orderedPlayers = visiblePlayerOrder
    .map((playerId) => playersById.get(playerId))
    .filter(Boolean);
  const orderedIds = new Set(orderedPlayers.map((player) => player.id));

  for (const player of sortedPlayers) {
    if (!orderedIds.has(player.id)) {
      orderedPlayers.push(player);
    }
  }

  return orderedPlayers;
}

function isSortingPaused() {
  return sortingPausedUntil > Date.now();
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
    games: nextState.games,
    playerOrder: getVisiblePlayers(nextState).map((player) => player.id)
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
  saveButton.disabled = !hasUnsavedChanges || isSaveInFlight;
  saveButton.classList.toggle("has-unsaved", hasUnsavedChanges);
}

function statusReadyText() {
  return currentMode === "cloud" ? "Сохранено" : "Сохранено локально";
}

function setStatus(text, type = "info", options = {}) {
  const { autoHide = true } = options;

  window.clearTimeout(statusHideTimer);
  saveStatus.textContent = text;
  saveStatus.className = `status-toast status-${type} is-visible`;

  if (autoHide) {
    statusHideTimer = window.setTimeout(hideStatus, STATUS_HIDE_DELAY);
  }
}

function hideStatus() {
  saveStatus.classList.remove("is-visible");
}

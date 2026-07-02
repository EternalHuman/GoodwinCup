import {
  DEFAULT_COLORS,
  STORAGE_KEY,
  createId,
  fileToDataUrl,
  loadState,
  makeDefaultIcon,
  saveState
} from "./store.js";

const STATUS_HIDE_DELAY = 4000;

const saveStatus = document.querySelector("#save-status");
const saveButton = document.querySelector("#save-button");
const playersCount = document.querySelector("#players-count");
const gamesCount = document.querySelector("#games-count");
const playerForm = document.querySelector("#player-form");
const playerName = document.querySelector("#player-name");
const playersList = document.querySelector("#players-list");
const gameForm = document.querySelector("#game-form");
const gameTitle = document.querySelector("#game-title");
const gameColor = document.querySelector("#game-color");
const gameIconUrl = document.querySelector("#game-icon-url");
const gameIconFile = document.querySelector("#game-icon-file");
const gameShowTitle = document.querySelector("#game-show-title");
const gameScale = document.querySelector("#game-scale");
const gameOffsetY = document.querySelector("#game-offset-y");
const gamesList = document.querySelector("#games-list");

let state = null;
let currentMode = "local";
let hasUnsavedChanges = false;
let statusHideTimer = 0;

init();

async function init() {
  await reloadState();

  saveButton.addEventListener("click", persistState);
  playerForm.addEventListener("submit", addPlayer);
  gameForm.addEventListener("submit", addGame);
  window.addEventListener("storage", handleStorageUpdate);
  window.addEventListener("beforeunload", warnAboutUnsavedChanges);
}

async function reloadState(options = {}) {
  const { silent = false } = options;

  if (!silent) {
    setStatus("Загрузка", "info", { autoHide: false });
  }

  try {
    const result = await loadState();
    state = result.state;
    currentMode = result.mode;
    hasUnsavedChanges = false;
    renderAdmin();
    if (!silent) {
      setStatus(statusReadyText(), currentMode === "cloud" ? "success" : "warning");
    }
    updateSaveButton();
  } catch (error) {
    console.error("Could not load tournament state.", error);

    if (!silent) {
      setStatus("Ошибка загрузки", "error");
    }
  }
}

function handleStorageUpdate(event) {
  if (event.key !== STORAGE_KEY || hasUnsavedChanges) {
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

function renderAdmin() {
  playersCount.textContent = `${state.players.length}`;
  gamesCount.textContent = `${state.games.length}`;
  renderPlayers();
  renderGames();
}

function renderPlayers() {
  playersList.replaceChildren();

  if (!state.players.length) {
    playersList.append(createEmptyRow("Никнеймов нет"));
    return;
  }

  for (const player of state.players) {
    const row = document.createElement("div");
    row.className = "list-row";

    const input = document.createElement("input");
    input.className = "row-input";
    input.type = "text";
    input.maxLength = 32;
    input.value = player.name;
    input.setAttribute("aria-label", "Никнейм");
    input.addEventListener("change", () => {
      player.name = input.value.trim() || player.name;
      input.value = player.name;
      markDirty();
    });

    const removeButton = document.createElement("button");
    removeButton.className = "danger-button";
    removeButton.type = "button";
    removeButton.textContent = "Удалить";
    removeButton.addEventListener("click", () => removePlayer(player.id));

    row.append(input, removeButton);
    playersList.append(row);
  }
}

function renderGames() {
  gamesList.replaceChildren();

  if (!state.games.length) {
    gamesList.append(createEmptyRow("Игр нет"));
    return;
  }

  state.games.forEach((game, index) => {
    const row = document.createElement("div");
    row.className = "list-row game-row";

    const orderActions = document.createElement("div");
    orderActions.className = "row-actions order-actions";
    orderActions.append(
      createIconButton("↑", `Поднять игру ${game.title}`, () => moveGame(game.id, -1), index === 0),
      createIconButton("↓", `Опустить игру ${game.title}`, () => moveGame(game.id, 1), index === state.games.length - 1)
    );

    const preview = document.createElement("img");
    preview.className = "row-game-icon";
    preview.src = game.icon;
    preview.alt = game.title;

    const titleInput = document.createElement("input");
    titleInput.className = "row-input";
    titleInput.type = "text";
    titleInput.maxLength = 32;
    titleInput.value = game.title;
    titleInput.setAttribute("aria-label", "Название игры");
    titleInput.addEventListener("change", () => {
      game.title = titleInput.value.trim() || game.title;
      titleInput.value = game.title;
      markDirty();
    });

    const colorInput = document.createElement("input");
    colorInput.className = "compact-color";
    colorInput.type = "color";
    colorInput.value = game.color;
    colorInput.setAttribute("aria-label", "Цвет игры");
    colorInput.addEventListener("input", () => {
      game.color = colorInput.value;
      markDirty();
    });

    const fileInput = document.createElement("input");
    fileInput.className = "compact-file";
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.setAttribute("aria-label", "Иконка игры");
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];

      if (!file) {
        return;
      }

      if (!checkIconSize(file)) {
        fileInput.value = "";
        return;
      }

      game.icon = await fileToDataUrl(file);
      preview.src = game.icon;
      markDirty();
    });

    const showTitleLabel = document.createElement("label");
    showTitleLabel.className = "row-checkbox";

    const showTitleInput = document.createElement("input");
    showTitleInput.type = "checkbox";
    showTitleInput.checked = game.showTitle === true;
    showTitleInput.setAttribute("aria-label", "Отображать название игры");
    showTitleInput.addEventListener("change", () => {
      game.showTitle = showTitleInput.checked;
      markDirty();
    });

    const showTitleText = document.createElement("span");
    showTitleText.textContent = "Название";

    showTitleLabel.append(showTitleInput, showTitleText);

    const scaleInput = document.createElement("input");
    scaleInput.className = "compact-scale";
    scaleInput.type = "number";
    scaleInput.min = "25";
    scaleInput.max = "200";
    scaleInput.step = "1";
    scaleInput.value = String(game.scale || 100);
    scaleInput.setAttribute("aria-label", "Scale логотипа, процентов");
    scaleInput.addEventListener("change", () => {
      game.scale = clampScale(scaleInput.value);
      scaleInput.value = String(game.scale);
      markDirty();
    });

    const offsetInput = document.createElement("input");
    offsetInput.className = "compact-offset";
    offsetInput.type = "number";
    offsetInput.min = "-100";
    offsetInput.max = "100";
    offsetInput.step = "1";
    offsetInput.value = String(game.offsetY || 0);
    offsetInput.setAttribute("aria-label", "Смещение логотипа по вертикали, пикселей");
    offsetInput.addEventListener("change", () => {
      game.offsetY = clampOffset(offsetInput.value);
      offsetInput.value = String(game.offsetY);
      markDirty();
    });

    const copyButton = document.createElement("button");
    copyButton.className = "ghost-button compact-action";
    copyButton.type = "button";
    copyButton.textContent = "Копия";
    copyButton.addEventListener("click", () => copyGame(game.id));

    const removeButton = document.createElement("button");
    removeButton.className = "danger-button";
    removeButton.type = "button";
    removeButton.textContent = "Удалить";
    removeButton.addEventListener("click", () => removeGame(game.id));

    row.append(orderActions, preview, titleInput, colorInput, fileInput, showTitleLabel, scaleInput, offsetInput, copyButton, removeButton);
    gamesList.append(row);
  });
}

function createIconButton(text, label, onClick, disabled = false) {
  const button = document.createElement("button");
  button.className = "icon-button";
  button.type = "button";
  button.textContent = text;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function createEmptyRow(text) {
  const empty = document.createElement("div");
  empty.className = "empty-row";
  empty.textContent = text;
  return empty;
}

function addPlayer(event) {
  event.preventDefault();
  const name = playerName.value.trim();

  if (!name) {
    return;
  }

  const player = {
    id: createId("player"),
    name
  };

  state.players.push(player);
  state.scores[player.id] = {};
  playerForm.reset();
  renderAdmin();
  markDirty();
}

async function addGame(event) {
  event.preventDefault();
  const title = gameTitle.value.trim();

  if (!title) {
    return;
  }

  const uploadedFile = gameIconFile.files?.[0];
  let icon = gameIconUrl.value.trim();

  if (uploadedFile) {
    if (!checkIconSize(uploadedFile)) {
      return;
    }

    icon = await fileToDataUrl(uploadedFile);
  }

  const color = gameColor.value || DEFAULT_COLORS[state.games.length % DEFAULT_COLORS.length];

  state.games.push({
    id: createId("game"),
    title,
    color,
    icon: icon || makeDefaultIcon(title.slice(0, 3), color),
    offsetY: clampOffset(gameOffsetY.value),
    scale: clampScale(gameScale.value),
    showTitle: gameShowTitle.checked
  });

  gameForm.reset();
  gameColor.value = DEFAULT_COLORS[state.games.length % DEFAULT_COLORS.length];
  gameScale.value = "100";
  gameOffsetY.value = "0";
  renderAdmin();
  markDirty();
}

function removePlayer(playerId) {
  const player = state.players.find((item) => item.id === playerId);

  if (!player || !confirm(`Удалить никнейм "${player.name}"?`)) {
    return;
  }

  state.players = state.players.filter((item) => item.id !== playerId);
  delete state.scores[playerId];
  renderAdmin();
  markDirty();
}

function removeGame(gameId) {
  const game = state.games.find((item) => item.id === gameId);

  if (!game || !confirm(`Удалить игру "${game.title}"?`)) {
    return;
  }

  state.games = state.games.filter((item) => item.id !== gameId);

  for (const playerScores of Object.values(state.scores)) {
    delete playerScores[gameId];
  }

  renderAdmin();
  markDirty();
}

function moveGame(gameId, direction) {
  const currentIndex = state.games.findIndex((game) => game.id === gameId);
  const nextIndex = currentIndex + direction;

  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= state.games.length) {
    return;
  }

  const [game] = state.games.splice(currentIndex, 1);
  state.games.splice(nextIndex, 0, game);
  renderAdmin();
  markDirty();
}

function copyGame(gameId) {
  const currentIndex = state.games.findIndex((game) => game.id === gameId);

  if (currentIndex < 0) {
    return;
  }

  const source = state.games[currentIndex];
  const copy = {
    ...source,
    id: createId("game"),
    title: makeCopyTitle(source.title)
  };

  state.games.splice(currentIndex + 1, 0, copy);
  renderAdmin();
  markDirty();
}

function makeCopyTitle(title) {
  const suffix = " копия";
  const base = title.slice(0, 32 - suffix.length);
  return `${base}${suffix}`;
}

function clampScale(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 100;
  }

  return Math.min(200, Math.max(25, Math.round(number)));
}

function clampOffset(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.min(100, Math.max(-100, Math.round(number)));
}

function markDirty() {
  hasUnsavedChanges = true;
  updateSaveButton();
}

async function persistState() {
  if (!state) {
    return;
  }

  setStatus("Сохранение", "info", { autoHide: false });
  saveButton.disabled = true;

  try {
    const result = await saveState(state);
    state = result.state;
    currentMode = result.mode;
    hasUnsavedChanges = false;
    renderAdmin();
    setStatus(statusReadyText(), currentMode === "cloud" ? "success" : "warning");
    updateSaveButton();
  } catch (error) {
    console.error("Could not save tournament state.", error);
    setStatus("Ошибка сохранения", "error");
    updateSaveButton();
  }
}

function checkIconSize(file) {
  const maxSize = 750 * 1024;

  if (file.size <= maxSize) {
    return true;
  }

  setStatus("Иконка должна быть меньше 750 КБ", "error");
  return false;
}

function updateSaveButton() {
  saveButton.disabled = !hasUnsavedChanges;
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

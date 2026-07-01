import {
  DEFAULT_COLORS,
  createId,
  fileToDataUrl,
  loadState,
  saveState
} from "./store.js";

const saveStatus = document.querySelector("#save-status");
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
const gamesList = document.querySelector("#games-list");

let state = null;
let currentMode = "local";
let saveTimer = 0;

init();

async function init() {
  setStatus("Загрузка");
  const result = await loadState();
  state = result.state;
  currentMode = result.mode;
  renderAdmin();
  setStatus(statusReadyText());

  playerForm.addEventListener("submit", addPlayer);
  gameForm.addEventListener("submit", addGame);
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
      scheduleSave();
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

  for (const game of state.games) {
    const row = document.createElement("div");
    row.className = "list-row game-row";

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
      scheduleSave();
    });

    const colorInput = document.createElement("input");
    colorInput.className = "compact-color";
    colorInput.type = "color";
    colorInput.value = game.color;
    colorInput.setAttribute("aria-label", "Цвет игры");
    colorInput.addEventListener("input", () => {
      game.color = colorInput.value;
      scheduleSave();
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
      scheduleSave();
    });

    const removeButton = document.createElement("button");
    removeButton.className = "danger-button";
    removeButton.type = "button";
    removeButton.textContent = "Удалить";
    removeButton.addEventListener("click", () => removeGame(game.id));

    row.append(preview, titleInput, colorInput, fileInput, removeButton);
    gamesList.append(row);
  }
}

function createEmptyRow(text) {
  const empty = document.createElement("div");
  empty.className = "empty-row";
  empty.textContent = text;
  return empty;
}

async function addPlayer(event) {
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
  await persistState();
  renderAdmin();
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
    icon: icon || ""
  });

  gameForm.reset();
  gameColor.value = DEFAULT_COLORS[state.games.length % DEFAULT_COLORS.length];
  await persistState();
  renderAdmin();
}

async function removePlayer(playerId) {
  const player = state.players.find((item) => item.id === playerId);

  if (!player || !confirm(`Удалить никнейм "${player.name}"?`)) {
    return;
  }

  state.players = state.players.filter((item) => item.id !== playerId);
  delete state.scores[playerId];
  await persistState();
  renderAdmin();
}

async function removeGame(gameId) {
  const game = state.games.find((item) => item.id === gameId);

  if (!game || !confirm(`Удалить игру "${game.title}"?`)) {
    return;
  }

  state.games = state.games.filter((item) => item.id !== gameId);

  for (const playerScores of Object.values(state.scores)) {
    delete playerScores[gameId];
  }

  await persistState();
  renderAdmin();
}

function scheduleSave() {
  setStatus("Сохранение");
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    await persistState();
  }, 350);
}

async function persistState() {
  const result = await saveState(state);
  state = result.state;
  currentMode = result.mode;
  setStatus(statusReadyText());
}

function checkIconSize(file) {
  const maxSize = 750 * 1024;

  if (file.size <= maxSize) {
    return true;
  }

  alert("Иконка должна быть меньше 750 КБ.");
  return false;
}

function statusReadyText() {
  return currentMode === "cloud" ? "Сохранено" : "Локально";
}

function setStatus(text) {
  saveStatus.textContent = text;
}

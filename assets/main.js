import {
  calculatePlayerTotal,
  formatScore,
  loadState,
  saveState
} from "./store.js";

const tableRoot = document.querySelector("#table-root");
const saveStatus = document.querySelector("#save-status");
const storageMode = document.querySelector("#storage-mode");
const refreshButton = document.querySelector("#refresh-button");

let state = null;
let currentMode = "local";
let saveTimer = 0;

init();

async function init() {
  await reloadState();
  refreshButton.addEventListener("click", reloadState);
}

async function reloadState() {
  setStatus("Загрузка");
  const result = await loadState();
  state = result.state;
  currentMode = result.mode;
  renderBoard();
  updateModeLabel();
  setStatus("Готово");
}

function renderBoard() {
  tableRoot.replaceChildren();

  if (!state.players.length || !state.games.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";

    const label = document.createElement("strong");
    label.textContent = "Таблица пустая";

    const link = document.createElement("a");
    link.className = "solid-button";
    link.href = "/admin/";
    link.textContent = "Открыть админку";

    empty.append(label, link);
    tableRoot.append(empty);
    return;
  }

  const scroller = document.createElement("div");
  scroller.className = "table-scroller";

  const table = document.createElement("div");
  table.className = "score-table";
  table.setAttribute("role", "table");
  table.style.gridTemplateColumns = `minmax(170px, 1.45fr) repeat(${state.games.length}, minmax(98px, .8fr)) minmax(104px, .72fr)`;

  table.append(createHeaderCell("Никнейм", "sticky-left corner-cell"));

  for (const game of state.games) {
    table.append(createGameHeader(game));
  }

  table.append(createHeaderCell("Итого", "sticky-right total-head"));

  for (const player of state.players) {
    table.append(createPlayerCell(player));

    for (const game of state.games) {
      table.append(createScoreCell(player, game));
    }

    table.append(createTotalCell(player));
  }

  scroller.append(table);
  tableRoot.append(scroller);
}

function createHeaderCell(text, extraClass = "") {
  const cell = document.createElement("div");
  cell.className = `table-cell header-cell ${extraClass}`;
  cell.setAttribute("role", "columnheader");
  cell.textContent = text;
  return cell;
}

function createGameHeader(game) {
  const cell = document.createElement("div");
  cell.className = "table-cell header-cell game-head";
  cell.style.setProperty("--game-color", game.color);
  cell.setAttribute("role", "columnheader");

  const icon = document.createElement("img");
  icon.className = "game-icon";
  icon.src = game.icon;
  icon.alt = game.title;

  const title = document.createElement("span");
  title.className = "game-title";
  title.textContent = game.title;

  cell.append(icon, title);
  return cell;
}

function createPlayerCell(player) {
  const cell = document.createElement("div");
  cell.className = "table-cell player-cell sticky-left";
  cell.setAttribute("role", "rowheader");
  cell.textContent = player.name;
  return cell;
}

function createScoreCell(player, game) {
  const cell = document.createElement("div");
  cell.className = "table-cell score-cell";
  cell.style.setProperty("--game-color", game.color);
  cell.setAttribute("role", "cell");

  const input = document.createElement("input");
  input.className = "score-input";
  input.type = "number";
  input.step = "1";
  input.inputMode = "decimal";
  input.min = "0";
  input.value = formatScore(state.scores[player.id]?.[game.id]);
  input.setAttribute("aria-label", `${player.name}, ${game.title}`);

  input.addEventListener("input", () => {
    updateScore(player.id, game.id, input.value);
    updatePlayerTotal(player.id);
    scheduleSave();
  });

  cell.append(input);
  return cell;
}

function createTotalCell(player) {
  const cell = document.createElement("div");
  cell.className = "table-cell total-cell sticky-right";
  cell.dataset.totalFor = player.id;
  cell.setAttribute("role", "cell");
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

function updatePlayerTotal(playerId) {
  const totalCell = tableRoot.querySelector(`[data-total-for="${CSS.escape(playerId)}"]`);

  if (totalCell) {
    totalCell.textContent = formatScore(calculatePlayerTotal(state, playerId));
  }
}

function scheduleSave() {
  setStatus("Сохранение");
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persistState, 350);
}

async function persistState() {
  const result = await saveState(state);
  state = result.state;
  currentMode = result.mode;
  updateModeLabel();
  setStatus(currentMode === "cloud" ? "Сохранено" : "Локально");
}

function updateModeLabel() {
  storageMode.textContent = currentMode === "cloud" ? "Cloudflare KV" : "localStorage";
}

function setStatus(text) {
  saveStatus.textContent = text;
}

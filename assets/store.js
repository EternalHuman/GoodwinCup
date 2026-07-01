const API_ENDPOINT = "/api/state";
const STORAGE_KEY = "goodwin-cup-state-v1";

export const DEFAULT_COLORS = [
  "#d7083a",
  "#236ad5",
  "#78d93f",
  "#f2a900",
  "#f58b23",
  "#18b4a7",
  "#b65cff",
  "#f04f75"
];

const DEFAULT_STATE = {
  version: 1,
  players: [
    { id: "player-1", name: "PlayerOne" },
    { id: "player-2", name: "GoodWin" },
    { id: "player-3", name: "NightRun" },
    { id: "player-4", name: "Ace" },
    { id: "player-5", name: "Vector" },
    { id: "player-6", name: "Nova" }
  ],
  games: [
    {
      id: "game-1",
      title: "CS2",
      color: DEFAULT_COLORS[0],
      icon: makeDefaultIcon("CS", DEFAULT_COLORS[0])
    },
    {
      id: "game-2",
      title: "Dota",
      color: DEFAULT_COLORS[1],
      icon: makeDefaultIcon("D2", DEFAULT_COLORS[1])
    },
    {
      id: "game-3",
      title: "Race",
      color: DEFAULT_COLORS[2],
      icon: makeDefaultIcon("RC", DEFAULT_COLORS[2])
    },
    {
      id: "game-4",
      title: "FIFA",
      color: DEFAULT_COLORS[3],
      icon: makeDefaultIcon("FC", DEFAULT_COLORS[3])
    },
    {
      id: "game-5",
      title: "MK",
      color: DEFAULT_COLORS[4],
      icon: makeDefaultIcon("MK", DEFAULT_COLORS[4])
    }
  ],
  scores: {}
};

export function createDefaultState() {
  return normalizeState(clone(DEFAULT_STATE));
}

export async function loadState() {
  const localState = readLocalState();

  try {
    const response = await fetch(API_ENDPOINT, {
      cache: "no-store",
      headers: { "Accept": "application/json" }
    });

    if (response.ok) {
      const remoteState = normalizeState(await response.json());
      writeLocalState(remoteState);
      return { state: remoteState, mode: "cloud" };
    }
  } catch (error) {
    console.debug("Cloudflare state is unavailable, using local storage.", error);
  }

  const fallbackState = localState || createDefaultState();
  writeLocalState(fallbackState);
  return { state: fallbackState, mode: "local" };
}

export async function saveState(nextState) {
  const state = normalizeState(nextState);
  writeLocalState(state);

  try {
    const response = await fetch(API_ENDPOINT, {
      method: "PUT",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(state)
    });

    if (response.ok) {
      const remoteState = normalizeState(await response.json());
      writeLocalState(remoteState);
      return { state: remoteState, mode: "cloud" };
    }
  } catch (error) {
    console.debug("Cloudflare save is unavailable, using local storage.", error);
  }

  return { state, mode: "local" };
}

export function createId(prefix) {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeState(input) {
  const source = input && typeof input === "object" ? input : {};
  const players = normalizePlayers(source.players);
  const games = normalizeGames(source.games);
  const playerIds = new Set(players.map((player) => player.id));
  const gameIds = new Set(games.map((game) => game.id));
  const scores = normalizeScores(source.scores, playerIds, gameIds);

  return {
    version: 1,
    players,
    games,
    scores
  };
}

export function calculatePlayerTotal(state, playerId) {
  const playerScores = state.scores[playerId] || {};

  return state.games.reduce((sum, game) => {
    const value = Number(playerScores[game.id]);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

export function formatScore(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "";
  }

  if (Number.isInteger(number)) {
    return String(number);
  }

  return number.toFixed(2).replace(/\.?0+$/, "");
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function normalizePlayers(players) {
  const seen = new Set();

  return Array.isArray(players)
    ? players
        .map((player, index) => ({
          id: cleanId(player?.id, `player-${index + 1}`),
          name: cleanText(player?.name, 32) || `Игрок ${index + 1}`
        }))
        .filter((player) => {
          if (seen.has(player.id)) {
            return false;
          }

          seen.add(player.id);
          return true;
        })
    : [];
}

function normalizeGames(games) {
  const seen = new Set();

  return Array.isArray(games)
    ? games
        .map((game, index) => {
          const color = cleanColor(game?.color) || DEFAULT_COLORS[index % DEFAULT_COLORS.length];

          return {
            id: cleanId(game?.id, `game-${index + 1}`),
            title: cleanText(game?.title, 32) || `Игра ${index + 1}`,
            color,
            icon: cleanIcon(game?.icon) || makeDefaultIcon(String(index + 1), color)
          };
        })
        .filter((game) => {
          if (seen.has(game.id)) {
            return false;
          }

          seen.add(game.id);
          return true;
        })
    : [];
}

function normalizeScores(scores, playerIds, gameIds) {
  const normalizedScores = {};

  if (!scores || typeof scores !== "object") {
    return normalizedScores;
  }

  for (const [playerId, gameScores] of Object.entries(scores)) {
    if (!playerIds.has(playerId) || !gameScores || typeof gameScores !== "object") {
      continue;
    }

    for (const [gameId, score] of Object.entries(gameScores)) {
      if (!gameIds.has(gameId)) {
        continue;
      }

      const number = Number(score);
      if (!Number.isFinite(number)) {
        continue;
      }

      normalizedScores[playerId] ||= {};
      normalizedScores[playerId][gameId] = number;
    }
  }

  return normalizedScores;
}

function readLocalState() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? normalizeState(JSON.parse(value)) : null;
  } catch (error) {
    console.debug("Could not read local tournament state.", error);
    return null;
  }
}

function writeLocalState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state)));
  } catch (error) {
    console.debug("Could not write local tournament state.", error);
  }
}

function cleanId(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || fallback;
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanColor(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : "";
}

function cleanIcon(value) {
  const text = typeof value === "string" ? value.trim() : "";

  if (/^data:image\//.test(text) || /^https?:\/\//.test(text) || text.startsWith("/")) {
    return text.slice(0, 750000);
  }

  return "";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeDefaultIcon(label, color) {
  const safeLabel = String(label).slice(0, 3).replace(/[<>&"]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="18" fill="${color}"/><circle cx="48" cy="48" r="30" fill="rgba(255,255,255,.16)"/><text x="48" y="56" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="white">${safeLabel}</text></svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const STATE_KEY = "goodwin-cup-state";

const DEFAULT_COLORS = [
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
    { id: "game-1", title: "CS2", color: DEFAULT_COLORS[0], icon: makeDefaultIcon("CS", DEFAULT_COLORS[0]), offsetY: 0, scale: 100, showTitle: false },
    { id: "game-2", title: "Dota", color: DEFAULT_COLORS[1], icon: makeDefaultIcon("D2", DEFAULT_COLORS[1]), offsetY: 0, scale: 100, showTitle: false },
    { id: "game-3", title: "Race", color: DEFAULT_COLORS[2], icon: makeDefaultIcon("RC", DEFAULT_COLORS[2]), offsetY: 0, scale: 100, showTitle: false },
    { id: "game-4", title: "FIFA", color: DEFAULT_COLORS[3], icon: makeDefaultIcon("FC", DEFAULT_COLORS[3]), offsetY: 0, scale: 100, showTitle: false },
    { id: "game-5", title: "MK", color: DEFAULT_COLORS[4], icon: makeDefaultIcon("MK", DEFAULT_COLORS[4]), offsetY: 0, scale: 100, showTitle: false }
  ],
  scores: {}
};

export async function onRequestGet({ env }) {
  if (!env.GOODWIN_CUP_KV) {
    return json({ error: "GOODWIN_CUP_KV binding is not configured." }, 501);
  }

  const storedState = await env.GOODWIN_CUP_KV.get(STATE_KEY, "json");
  return json(normalizeState(storedState || DEFAULT_STATE));
}

export async function onRequestPut({ request, env }) {
  if (!env.GOODWIN_CUP_KV) {
    return json({ error: "GOODWIN_CUP_KV binding is not configured." }, 501);
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }

  const state = normalizeState(payload);
  await env.GOODWIN_CUP_KV.put(STATE_KEY, JSON.stringify(state));

  return json(state);
}

export async function onRequestPost(context) {
  return onRequestPut(context);
}

function normalizeState(input) {
  const source = input && typeof input === "object" ? input : {};
  const players = normalizePlayers(source.players);
  const games = normalizeGames(source.games);
  const playerIds = new Set(players.map((player) => player.id));
  const gameIds = new Set(games.map((game) => game.id));

  return {
    version: 1,
    players,
    games,
    scores: normalizeScores(source.scores, playerIds, gameIds)
  };
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
            icon: cleanIcon(game?.icon) || makeDefaultIcon(String(index + 1), color),
            offsetY: cleanOffset(game?.offsetY),
            scale: cleanScale(game?.scale),
            showTitle: game?.showTitle === true
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

function cleanScale(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 100;
  }

  return Math.min(200, Math.max(25, Math.round(number)));
}

function cleanOffset(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.min(100, Math.max(-100, Math.round(number)));
}

function makeDefaultIcon(label, color) {
  const safeLabel = String(label).slice(0, 3).replace(/[<>&"]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="18" fill="${color}"/><circle cx="48" cy="48" r="30" fill="rgba(255,255,255,.16)"/><text x="48" y="56" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="white">${safeLabel}</text></svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

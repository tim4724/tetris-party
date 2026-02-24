'use strict';

// --- State ---
let currentScreen = 'lobby';
let gameState = null;
let ws = null;
let players = new Map(); // playerId -> { playerName, playerColor, playerIndex }
let playerOrder = [];    // ordered player IDs for layout
let boardRenderers = [];
let uiRenderers = [];
let animations = null;
let music = null;
let selectedMode = MODE.COMPETITIVE;
let canvas = null;
let ctx = null;
let lastFrameTime = 0;
let playerIndexCounter = 0;

// --- DOM References ---
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const resultsScreen = document.getElementById('results-screen');
const qrCode = document.getElementById('qr-code');
const roomCodeEl = document.getElementById('room-code');
const joinUrlEl = document.getElementById('join-url');
const playerListEl = document.getElementById('player-list');
const startBtn = document.getElementById('start-btn');
const countdownOverlay = document.getElementById('countdown-overlay');
const resultsList = document.getElementById('results-list');
const lobbyBtn = document.getElementById('lobby-btn');

// --- Screen Management ---
function showScreen(name) {
  currentScreen = name;
  lobbyScreen.classList.toggle('hidden', name !== 'lobby');
  gameScreen.classList.toggle('hidden', name !== 'game');
  resultsScreen.classList.toggle('hidden', name !== 'results');

  if (name === 'game') {
    initCanvas();
    calculateLayout();
  }
}

// --- Canvas Setup ---
function initCanvas() {
  canvas = document.getElementById('game-canvas');
  ctx = canvas.getContext('2d');
  resizeCanvas();
}

function resizeCanvas() {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (currentScreen === 'game') {
    calculateLayout();
  }
}

// --- Layout Calculation ---
function calculateLayout() {
  if (!ctx || playerOrder.length === 0) return;

  const n = playerOrder.length;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const padding = 20;

  // Determine grid arrangement
  let gridCols, gridRows;
  if (n === 1) { gridCols = 1; gridRows = 1; }
  else if (n === 2) { gridCols = 2; gridRows = 1; }
  else if (n === 3) { gridCols = 3; gridRows = 1; }
  else { gridCols = 2; gridRows = 2; }

  // Each player needs: board (10 cells wide, 20 tall) + side panels (~5 cells each side)
  const totalCellsWide = 10 + 5 + 5; // board + hold panel + next panel
  const totalCellsTall = 20 + 3;       // board + name + score

  const availW = (w - padding * (gridCols + 1)) / gridCols;
  const availH = (h - padding * (gridRows + 1)) / gridRows;

  const cellFromW = availW / totalCellsWide;
  const cellFromH = availH / totalCellsTall;
  const cellSize = Math.floor(Math.min(cellFromW, cellFromH));

  const boardWidthPx = 10 * cellSize;
  const boardHeightPx = 20 * cellSize;

  boardRenderers = [];
  uiRenderers = [];

  // Create Animations instance with the current context
  animations = new Animations(ctx);

  for (let i = 0; i < n; i++) {
    const col = i % gridCols;
    const row = Math.floor(i / gridCols);

    // Center each player's area within its grid cell
    const cellAreaW = w / gridCols;
    const cellAreaH = h / gridRows;
    const boardX = cellAreaW * col + (cellAreaW - boardWidthPx) / 2;
    const boardY = cellAreaH * row + (cellAreaH - boardHeightPx) / 2 + 10; // offset for name

    const playerIndex = players.get(playerOrder[i])?.playerIndex ?? i;

    boardRenderers.push(new BoardRenderer(ctx, boardX, boardY, cellSize, playerIndex));
    uiRenderers.push(new UIRenderer(ctx, boardX, boardY, cellSize, boardWidthPx, boardHeightPx, playerIndex));
  }
}

// --- WebSocket ---
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = function() {
    ws.send(JSON.stringify({ type: MSG.CREATE_ROOM }));
  };

  ws.onmessage = function(event) {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };

  ws.onclose = function() {
    // Attempt reconnect after delay
    setTimeout(connect, 2000);
  };
}

function send(type, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...data }));
  }
}

// --- Message Handlers ---
function handleMessage(msg) {
  switch (msg.type) {
    case MSG.ROOM_CREATED:
      onRoomCreated(msg);
      break;
    case MSG.PLAYER_JOINED:
      onPlayerJoined(msg);
      break;
    case MSG.PLAYER_LEFT:
      onPlayerLeft(msg);
      break;
    case MSG.COUNTDOWN:
      onCountdown(msg);
      break;
    case MSG.GAME_STATE:
      onGameState(msg);
      break;
    case MSG.LINE_CLEAR:
      onLineClear(msg);
      break;
    case MSG.GARBAGE_SENT:
      onGarbageSent(msg);
      break;
    case MSG.PLAYER_KO:
      onPlayerKO(msg);
      break;
    case MSG.GAME_END:
      onGameEnd(msg);
      break;
  }
}

function onRoomCreated(msg) {
  qrCode.src = msg.qrDataUrl;
  roomCodeEl.textContent = msg.roomCode;
  joinUrlEl.textContent = msg.joinUrl;
  showScreen('lobby');
}

function onPlayerJoined(msg) {
  const index = playerIndexCounter++;
  players.set(msg.playerId, {
    playerName: msg.playerName,
    playerColor: msg.playerColor,
    playerIndex: index
  });
  playerOrder.push(msg.playerId);
  updatePlayerList();
  updateStartButton();
}

function onPlayerLeft(msg) {
  players.delete(msg.playerId);
  playerOrder = playerOrder.filter(id => id !== msg.playerId);
  updatePlayerList();
  updateStartButton();
}

function onCountdown(msg) {
  showScreen('game');
  countdownOverlay.classList.remove('hidden');
  countdownOverlay.textContent = msg.value;
  // Re-trigger animation
  countdownOverlay.style.animation = 'none';
  countdownOverlay.offsetHeight; // force reflow
  countdownOverlay.style.animation = '';

  if (msg.value === 'GO') {
    if (music && !music.playing) music.start();
    setTimeout(() => {
      countdownOverlay.classList.add('hidden');
      countdownOverlay.textContent = '';
    }, 400);
  }
}

function onGameState(msg) {
  gameState = msg;

  // Ensure player order matches game state players
  if (msg.players) {
    for (const p of msg.players) {
      if (!playerOrder.includes(p.id)) {
        playerOrder.push(p.id);
      }
    }
  }

  // Recalculate layout if renderers don't match player count
  if (msg.players && boardRenderers.length !== msg.players.length) {
    calculateLayout();
  }

  // Speed up music with the highest player level
  if (music && music.playing && msg.players && msg.players.length > 0) {
    const maxLevel = Math.max(...msg.players.map(p => p.level || 1));
    music.setSpeed(maxLevel);
  }
}

function onLineClear(msg) {
  if (!animations || !boardRenderers.length) return;
  const idx = playerOrder.indexOf(msg.playerId);
  if (idx < 0 || !boardRenderers[idx]) return;

  const br = boardRenderers[idx];
  animations.addLineClear(
    br.x, br.y, br.cellSize,
    msg.lines, msg.isTetris, msg.isTSpin
  );

  if (msg.combo >= 2) {
    animations.addCombo(
      br.x + br.boardWidth / 2,
      br.y + br.boardHeight / 2 - 30,
      msg.combo
    );
  }

  if (msg.backToBack) {
    animations.addBackToBack(
      br.x + br.boardWidth / 2,
      br.y + br.boardHeight / 2 + 20
    );
  }
}

function onGarbageSent(msg) {
  if (!animations || !boardRenderers.length) return;
  const idx = playerOrder.indexOf(msg.toId);
  if (idx < 0 || !boardRenderers[idx]) return;

  const br = boardRenderers[idx];
  animations.addGarbageShake(br.x, br.y);
}

function onPlayerKO(msg) {
  if (!animations || !boardRenderers.length) return;
  const idx = playerOrder.indexOf(msg.playerId);
  if (idx < 0 || !boardRenderers[idx]) return;

  const br = boardRenderers[idx];
  animations.addKO(br.x, br.y, br.boardWidth, br.boardHeight);
}

function onGameEnd(msg) {
  if (music) music.stop();
  showScreen('results');
  renderResults(msg.results);
}

// --- Lobby UI ---
function updatePlayerList() {
  playerListEl.innerHTML = '';
  for (const [id, info] of players) {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.dataset.playerId = id;

    const dot = document.createElement('span');
    dot.className = 'color-dot';
    dot.style.backgroundColor = info.playerColor || PLAYER_COLORS[info.playerIndex] || '#fff';

    const name = document.createElement('span');
    name.textContent = info.playerName || PLAYER_NAMES[info.playerIndex] || 'Player';

    card.appendChild(dot);
    card.appendChild(name);
    playerListEl.appendChild(card);
  }
}

function updateStartButton() {
  const hasPlayers = players.size > 0;
  startBtn.disabled = !hasPlayers;
  startBtn.textContent = hasPlayers
    ? `START (${players.size} player${players.size > 1 ? 's' : ''})`
    : 'Waiting for players...';
}

// Mode select buttons
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMode = btn.dataset.mode;
  });
});

// Start button
startBtn.addEventListener('click', () => {
  if (startBtn.disabled) return;
  // Init music on user gesture to satisfy browser autoplay policy
  if (!music) {
    music = new Music();
  }
  music.init();
  const settings = {};
  if (selectedMode === MODE.RACE) {
    settings.lineGoal = 40;
  }
  send(MSG.START_GAME, { mode: selectedMode, settings });
});

// --- Results UI ---
function renderResults(results) {
  resultsList.innerHTML = '';
  if (!results) return;

  const sorted = [...results].sort((a, b) => a.rank - b.rank);
  for (const r of sorted) {
    const row = document.createElement('div');
    row.className = `result-row rank-${r.rank}`;

    const rank = document.createElement('span');
    rank.className = 'result-rank';
    rank.textContent = r.rank <= 3 ? ['', '1st', '2nd', '3rd'][r.rank] : `${r.rank}th`;

    const nameEl = document.createElement('span');
    nameEl.className = 'result-name';
    const pInfo = players.get(r.playerId);
    nameEl.textContent = pInfo?.playerName || `Player ${r.playerId}`;
    if (pInfo) {
      nameEl.style.color = pInfo.playerColor || PLAYER_COLORS[pInfo.playerIndex];
    }

    const stats = document.createElement('div');
    stats.className = 'result-stats';
    stats.innerHTML = `<span>Score: ${r.score || 0}</span><span>Lines: ${r.lines || 0}</span><span>Lv ${r.level || 1}</span>`;

    row.appendChild(rank);
    row.appendChild(nameEl);
    row.appendChild(stats);
    resultsList.appendChild(row);
  }
}

// Back to lobby
lobbyBtn.addEventListener('click', () => {
  if (music) music.stop();
  send(MSG.RETURN_TO_LOBBY);
  gameState = null;
  boardRenderers = [];
  uiRenderers = [];
  playerIndexCounter = 0;
  players.clear();
  playerOrder = [];
  updatePlayerList();
  updateStartButton();
  showScreen('lobby');
  // Re-create the room
  send(MSG.CREATE_ROOM);
});

// --- Render Loop ---
function renderLoop(timestamp) {
  requestAnimationFrame(renderLoop);

  if (currentScreen !== 'game' || !ctx || !gameState) return;

  const deltaMs = timestamp - lastFrameTime;
  lastFrameTime = timestamp;

  // Clear canvas
  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  // Render each player
  if (gameState.players) {
    for (let i = 0; i < gameState.players.length; i++) {
      const playerData = gameState.players[i];
      if (!boardRenderers[i] || !uiRenderers[i]) continue;

      // Apply shake offset if active
      const shake = animations
        ? animations.getShakeOffsetForBoard(boardRenderers[i].x, boardRenderers[i].y)
        : { x: 0, y: 0 };

      if (shake.x !== 0 || shake.y !== 0) {
        ctx.save();
        ctx.translate(shake.x, shake.y);
      }

      // Augment player data with name info from our players map
      const pInfo = players.get(playerData.id);
      const enriched = {
        ...playerData,
        playerName: pInfo?.playerName || PLAYER_NAMES[i],
        playerColor: pInfo?.playerColor || PLAYER_COLORS[i]
      };

      boardRenderers[i].render(enriched);
      uiRenderers[i].render(enriched);

      if (shake.x !== 0 || shake.y !== 0) {
        ctx.restore();
      }
    }
  }

  // Update and render animations
  if (animations) {
    animations.update(deltaMs);
    animations.render();
  }

  // Draw game timer
  if (gameState.elapsed != null) {
    drawTimer(gameState.elapsed);
  }
}

function drawTimer(elapsedMs) {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.font = '16px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(timeStr, window.innerWidth / 2, 8);
}

// --- Window Resize ---
window.addEventListener('resize', () => {
  resizeCanvas();
});

// --- Initialize ---
connect();
requestAnimationFrame(renderLoop);

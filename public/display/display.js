'use strict';

// --- State ---
let currentScreen = 'welcome';
let gameState = null;
let ws = null;
let players = new Map(); // playerId -> { playerName, playerColor, playerIndex }
let playerOrder = [];    // ordered player IDs for layout
let boardRenderers = [];
let uiRenderers = [];
let animations = null;
let music = null;
let canvas = null;
let ctx = null;
let lastFrameTime = null;
let playerIndexCounter = 0;
let disconnectedQRs = new Map(); // playerId -> Image

// --- DOM References ---
const welcomeScreen = document.getElementById('welcome-screen');
const newGameBtn = document.getElementById('new-game-btn');
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
const playAgainBtn = document.getElementById('play-again-btn');
const newGameResultsBtn = document.getElementById('new-game-results-btn');
const gameToolbar = document.getElementById('game-toolbar');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const pauseBtn = document.getElementById('pause-btn');
const pauseOverlay = document.getElementById('pause-overlay');
const pauseContinueBtn = document.getElementById('pause-continue-btn');
const pauseNewGameBtn = document.getElementById('pause-newgame-btn');

// --- Screen Management ---
function showScreen(name) {
  currentScreen = name;
  welcomeScreen.classList.toggle('hidden', name !== 'welcome');
  lobbyScreen.classList.toggle('hidden', name !== 'lobby');
  // Keep game screen visible behind results and pause overlays
  gameScreen.classList.toggle('hidden', name !== 'game' && name !== 'results');
  resultsScreen.classList.toggle('hidden', name !== 'results');
  // Keep fullscreen available after entering the display flow; pause remains game-only.
  gameToolbar.classList.toggle('hidden', name === 'welcome');
  pauseBtn.classList.toggle('hidden', name !== 'game');
  // Hide pause overlay when switching away from game
  if (name !== 'game') {
    pauseOverlay.classList.add('hidden');
  }

  if (name === 'game' || name === 'results') {
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
  const padding = 5;

  // Each player needs: board (10 cells wide, 20 tall) + side panels (~3 cells each side)
  const totalCellsWide = 10 + 3 + 3; // board + hold panel + next panel
  const totalCellsTall = 20 + 3;       // board + name + score

  // Compute cell size for a given grid arrangement
  function cellSizeFor(cols, rows) {
    const aw = (w - padding * (cols + 1)) / cols;
    const ah = (h - padding * (rows + 1)) / rows;
    return Math.floor(Math.min(aw / totalCellsWide, ah / totalCellsTall));
  }

  // Determine grid arrangement — pick layout that maximizes cell size
  let gridCols, gridRows;
  if (n === 1) { gridCols = 1; gridRows = 1; }
  else if (n === 2) { gridCols = 2; gridRows = 1; }
  else if (n === 3) { gridCols = 3; gridRows = 1; }
  else {
    // 4 players: compare 4x1 row vs 2x2 grid
    if (cellSizeFor(4, 1) >= cellSizeFor(2, 2)) {
      gridCols = 4; gridRows = 1;
    } else {
      gridCols = 2; gridRows = 2;
    }
  }

  const cellSize = cellSizeFor(gridCols, gridRows);

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
    case MSG.ROOM_RESET:
      onRoomReset();
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
    case MSG.PLAYER_DISCONNECTED:
      onPlayerDisconnected(msg);
      break;
    case MSG.PLAYER_RECONNECTED:
      onPlayerReconnected(msg);
      break;
    case MSG.GAME_PAUSED:
      onGamePaused();
      break;
    case MSG.GAME_RESUMED:
      onGameResumed();
      break;
    case MSG.RETURN_TO_LOBBY:
      if (music) music.stop();
      gameState = null;
      disconnectedQRs.clear();
      showScreen('lobby');
      updateStartButton();
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

function onRoomReset() {
  if (music) music.stop();
  gameState = null;
  boardRenderers = [];
  uiRenderers = [];
  playerIndexCounter = 0;
  players.clear();
  playerOrder = [];
  updatePlayerList();
  updateStartButton();
  showScreen('lobby');
}

function onCountdown(msg) {
  gameState = null;
  showScreen('game');
  countdownOverlay.classList.remove('hidden');
  countdownOverlay.textContent = msg.value;

  playCountdownBeep(msg.value === 'GO');

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
  const isTetris = msg.lines === 4;
  animations.addLineClear(
    br.x, br.y, br.cellSize,
    msg.rows || [], isTetris, msg.isTSpin
  );

  if (msg.combo >= 2) {
    animations.addCombo(
      br.x + br.boardWidth / 2,
      br.y + br.boardHeight / 2 - 30,
      msg.combo
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
  disconnectedQRs.clear();
  showScreen('results');
  // Retrigger fade-in animation
  resultsScreen.style.animation = 'none';
  resultsScreen.offsetHeight;
  resultsScreen.style.animation = '';
  renderResults(msg.results);
}

function onPlayerDisconnected(msg) {
  if (msg.qrDataUrl) {
    const img = new Image();
    img.src = msg.qrDataUrl;
    disconnectedQRs.set(msg.playerId, img);
  } else {
    disconnectedQRs.set(msg.playerId, null);
  }
}

function onPlayerReconnected(msg) {
  disconnectedQRs.delete(msg.playerId);
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

// Init music helper
function initMusic() {
  if (!music) {
    music = new Music();
  }
  music.init();
}

// Countdown beep using Web Audio API
function playCountdownBeep(isGo) {
  if (!music || !music.ctx) return;
  const actx = music.ctx;
  if (actx.state === 'suspended') actx.resume();

  const osc = actx.createOscillator();
  const gain = actx.createGain();
  osc.connect(gain);
  gain.connect(actx.destination);

  if (isGo) {
    // Higher pitch, longer sweep for "GO"
    osc.type = 'square';
    osc.frequency.setValueAtTime(600, actx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, actx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.18, actx.currentTime);
    gain.gain.linearRampToValueAtTime(0, actx.currentTime + 0.3);
    osc.start(actx.currentTime);
    osc.stop(actx.currentTime + 0.3);
  } else {
    // Short tick for 3, 2, 1
    osc.type = 'square';
    osc.frequency.value = 440;
    gain.gain.setValueAtTime(0.15, actx.currentTime);
    gain.gain.linearRampToValueAtTime(0, actx.currentTime + 0.12);
    osc.start(actx.currentTime);
    osc.stop(actx.currentTime + 0.12);
  }
}

// Welcome screen button: unlocks audio, enters fullscreen, connects, enters lobby
newGameBtn.addEventListener('click', () => {
  initMusic();
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
  connect();
  showScreen('lobby');
});

// Start button
startBtn.addEventListener('click', () => {
  if (startBtn.disabled) return;
  initMusic(); // safety net
  send(MSG.START_GAME);
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

// Play Again — restart with same players
playAgainBtn.addEventListener('click', () => {
  initMusic();
  send(MSG.PLAY_AGAIN);
});

// New Game — return to lobby so new players can join
newGameResultsBtn.addEventListener('click', () => {
  send(MSG.RETURN_TO_LOBBY);
});

// --- Fullscreen ---
fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});

// --- Pause ---
function onGamePaused() {
  pauseOverlay.classList.remove('hidden');
  gameToolbar.classList.add('hidden');
  if (music) music.stop();
}

function onGameResumed() {
  pauseOverlay.classList.add('hidden');
  if (currentScreen === 'game') {
    gameToolbar.classList.remove('hidden');
  }
  if (music) music.start();
}

pauseBtn.addEventListener('click', () => {
  send(MSG.PAUSE_GAME);
});

pauseContinueBtn.addEventListener('click', () => {
  send(MSG.RESUME_GAME);
});

pauseNewGameBtn.addEventListener('click', () => {
  send(MSG.RETURN_TO_LOBBY);
});

// --- Render Loop ---
function renderLoop(timestamp) {
  requestAnimationFrame(renderLoop);

  if ((currentScreen !== 'game' && currentScreen !== 'results') || !ctx) return;

  if (lastFrameTime === null) lastFrameTime = timestamp;
  const deltaMs = timestamp - lastFrameTime;
  lastFrameTime = timestamp;

  // Clear canvas — deep space background with subtle radial vignette
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, w, h);

  // Subtle vignette (cached)
  if (!renderLoop._vignette || renderLoop._vw !== w || renderLoop._vh !== h) {
    renderLoop._vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.8);
    renderLoop._vignette.addColorStop(0, 'rgba(15, 15, 40, 0.3)');
    renderLoop._vignette.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
    renderLoop._vw = w;
    renderLoop._vh = h;
  }
  ctx.fillStyle = renderLoop._vignette;
  ctx.fillRect(0, 0, w, h);

  // No game state yet (e.g. during countdown) — render empty boards
  if (!gameState) {
    for (let i = 0; i < playerOrder.length; i++) {
      if (!boardRenderers[i] || !uiRenderers[i]) continue;
      const pInfo = players.get(playerOrder[i]);
      const empty = {
        id: playerOrder[i],
        alive: true,
        score: 0,
        lines: 0,
        level: 1,
        playerName: pInfo?.playerName || PLAYER_NAMES[i],
        playerColor: pInfo?.playerColor || PLAYER_COLORS[i]
      };
      boardRenderers[i].render(empty);
      uiRenderers[i].render(empty);
    }
    return;
  }

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

      // Draw QR overlay for disconnected players
      if (disconnectedQRs.has(playerData.id)) {
        const br = boardRenderers[i];
        const bx = br.x;
        const by = br.y;
        const bw = 10 * br.cellSize;
        const bh = 20 * br.cellSize;

        // Semi-transparent dark overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(bx, by, bw, bh);

        const qrImg = disconnectedQRs.get(playerData.id);
        const labelSize = Math.max(10, br.cellSize * 0.55);
        const labelGap = labelSize * 1.2;
        const qrSize = Math.min(bw, bh) * 0.5;
        const radius = qrSize * 0.08;
        const pad = qrSize * 0.06;
        const outerSize = qrSize + pad * 2;
        // Center QR + label group vertically
        const totalH = outerSize + labelGap + labelSize;
        const groupY = by + (bh - totalH) / 2;
        const outerX = bx + (bw - outerSize) / 2;
        const outerY = groupY;

        // Rounded white background (matches lobby QR style)
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(outerX, outerY, outerSize, outerSize, radius);
        ctx.fill();

        // Subtle border
        ctx.strokeStyle = 'rgba(0, 200, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Draw QR image clipped to rounded rect
        if (qrImg && qrImg.complete && qrImg.naturalWidth > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(outerX + pad, outerY + pad, qrSize, qrSize, Math.max(1, radius - pad));
          ctx.clip();
          ctx.drawImage(qrImg, outerX + pad, outerY + pad, qrSize, qrSize);
          ctx.restore();
        }

        // "Scan to rejoin" label directly below QR (in player color)
        ctx.fillStyle = enriched.playerColor || 'rgba(0, 200, 255, 0.7)';
        ctx.font = `600 ${labelSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.letterSpacing = '0.1em';
        ctx.fillText('SCAN TO REJOIN', bx + bw / 2, outerY + outerSize + labelGap);
        ctx.letterSpacing = '0px';
      }

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

let _timerFontReady = false;
function drawTimer(elapsedMs) {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  if (!_timerFontReady) {
    _timerFontReady = document.fonts?.check?.('14px Orbitron') ?? false;
  }
  const font = _timerFontReady ? 'Orbitron' : '"Courier New", monospace';

  const cellSize = boardRenderers.length > 0 ? boardRenderers[0].cellSize : 24;
  const labelSize = Math.max(9, cellSize * 0.38);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.font = `700 ${labelSize}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.letterSpacing = '0.15em';
  ctx.fillText(timeStr, window.innerWidth / 2, 10);
  ctx.letterSpacing = '0px';
}

// --- Window Resize ---
window.addEventListener('resize', () => {
  resizeCanvas();
});

// --- Initialize ---
requestAnimationFrame(renderLoop);

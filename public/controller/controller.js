'use strict';

(function () {
  // State
  let ws = null;
  let playerId = null;
  let playerColor = null;
  let roomCode = null;
  let inputSeq = 0;
  let touchInput = null;
  let currentScreen = 'waiting';
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_INTERVAL = 2000;
  let reconnectTimer = null;
  let isHost = false;
  let playerCount = 0;
  let gameCancelled = false;

  // DOM refs
  const waitingScreen = document.getElementById('waiting-screen');
  const gameScreen = document.getElementById('game-screen');
  const gameoverScreen = document.getElementById('gameover-screen');
  const lobbyTitle = document.getElementById('lobby-title');
  const roomCodeBox = document.getElementById('room-code-box');
  const roomCodeValue = document.getElementById('room-code-value');
  const playerCountEl = document.getElementById('player-count');
  const playerIdentity = document.getElementById('player-identity');
  const startBtn = document.getElementById('start-btn');
  const statusText = document.getElementById('status-text');
  const statusDetail = document.getElementById('status-detail');
  const rejoinBtn = document.getElementById('rejoin-btn');
  const playerNameEl = document.getElementById('player-name');
  const playerIndicator = document.getElementById('player-indicator');
  const playerIdentityName = document.getElementById('player-identity-name');
  const scoreDisplay = document.getElementById('score-display');
  const touchArea = document.getElementById('touch-area');
  const feedbackLayer = document.getElementById('feedback-layer');
  const garbageBar = document.getElementById('garbage-bar');
  const levelDisplay = document.getElementById('level-display');
  const linesDisplay = document.getElementById('lines-display');
  const linesProgressFill = document.getElementById('lines-progress-fill');
  const rankDisplay = document.getElementById('rank-display');
  const statsDisplay = document.getElementById('stats-display');

  // Screen management
  function showScreen(name) {
    currentScreen = name;
    waitingScreen.classList.toggle('hidden', name !== 'waiting');
    gameScreen.classList.toggle('hidden', name !== 'game');
    gameoverScreen.classList.toggle('hidden', name !== 'gameover');
  }

  // Extract room code from URL
  roomCode = location.pathname.split('/').filter(Boolean)[0] || null;
  if (!roomCode) {
    statusText.textContent = 'No Room Code';
    statusDetail.textContent = 'Scan a QR code or use a join link';
    return;
  }

  function vibrate(pattern) {
    if (!navigator.vibrate) return;
    navigator.vibrate(pattern);
  }

  // Prime the Vibration API.  On Android Chrome the first-ever vibrate()
  // call in a page silently fails; vibration only works starting from the
  // *next* user gesture.  We therefore need at least one completed touch
  // interaction that calls vibrate() BEFORE the game's first gesture.
  // The waiting screen prompts the user to tap, which primes the API.
  let vibrationPrimed = false;

  function primeVibration() {
    if (vibrationPrimed) return;
    vibrationPrimed = true;
    vibrate(1);
  }

  // Capture-phase listener so it fires before any other pointer handler.
  document.addEventListener('pointerdown', function onFirstPointer() {
    primeVibration();
    document.removeEventListener('pointerdown', onFirstPointer, true);
  }, { capture: true, passive: true });

  // WebSocket connection
  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(protocol + '//' + location.host);

    ws.onopen = function () {
      reconnectAttempts = 0;
      // Best-effort "connected" haptic feedback.
      vibrate(10);
      const token = sessionStorage.getItem('reconnectToken_' + roomCode);
      if (token) {
        send(MSG.REJOIN, { roomCode: roomCode, reconnectToken: token });
      } else {
        send(MSG.JOIN, { roomCode: roomCode });
      }
    };

    ws.onmessage = function (e) {
      let data;
      try {
        data = JSON.parse(e.data);
      } catch (_) {
        return;
      }
      handleMessage(data);
    };

    ws.onclose = function () {
      if (currentScreen === 'gameover' || gameCancelled) return;
      attemptReconnect();
    };

    ws.onerror = function () {
      // onclose will fire after this
    };
  }

  function send(type, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(Object.assign({ type: type }, payload)));
  }

  function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      statusText.textContent = 'Disconnected';
      statusDetail.textContent = 'Could not reconnect.';
      rejoinBtn.classList.remove('hidden');
      showScreen('waiting');
      return;
    }

    reconnectAttempts++;
    statusText.textContent = 'Reconnecting...';
    statusDetail.textContent = 'Attempt ' + reconnectAttempts + ' of ' + MAX_RECONNECT_ATTEMPTS;
    showScreen('waiting');

    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, RECONNECT_INTERVAL);
  }

  // Message handling
  function handleMessage(data) {
    switch (data.type) {
      case MSG.JOINED:
        onJoined(data);
        break;
      case MSG.LOBBY_UPDATE:
        onLobbyUpdate(data);
        break;
      case MSG.GAME_START:
        onGameStart();
        break;
      case MSG.COUNTDOWN:
        onCountdown(data);
        break;
      case MSG.PLAYER_STATE:
        onPlayerState(data);
        break;
      case MSG.GAME_OVER:
        onGameOver(data);
        break;
      case MSG.GAME_END:
        onGameEnd(data);
        break;
      case MSG.INPUT_ACK:
        // Could track unacked inputs here for prediction rollback
        break;
      case MSG.ERROR:
        onError(data);
        break;
    }
  }

  function onJoined(data) {
    playerId = data.playerId;
    playerColor = data.playerColor || PLAYER_COLORS[playerId - 1] || PLAYER_COLORS[0];
    isHost = !!data.isHost;
    playerCount = data.playerCount || 1;
    gameCancelled = false;

    if (data.reconnectToken) {
      sessionStorage.setItem('reconnectToken_' + roomCode, data.reconnectToken);
    }
    sessionStorage.setItem('playerId_' + roomCode, data.playerId);

    const name = PLAYER_NAMES[playerId - 1] || ('Player ' + playerId);
    playerNameEl.textContent = name;
    playerIndicator.style.background = playerColor;
    playerIndicator.style.color = playerColor;

    // Reconnected into an active game — jump straight to game screen
    if (data.reconnected && (data.roomState === 'playing' || data.roomState === 'countdown')) {
      hideLobbyElements();
      gameScreen.classList.remove('dead');
      gameScreen.style.setProperty('--player-color', playerColor);
      removeKoOverlay();
      removeCountdownOverlay();
      showScreen('game');
      initTouchInput();
      return;
    }

    // Show lobby UI
    lobbyTitle.classList.remove('hidden');
    roomCodeBox.classList.remove('hidden');
    roomCodeValue.textContent = roomCode;
    playerCountEl.classList.remove('hidden');
    rejoinBtn.classList.add('hidden');
    updatePlayerCount();

    // Show player identity card
    playerIdentity.style.setProperty('--id-color', playerColor);
    playerIdentityName.textContent = name;
    playerIdentity.classList.remove('hidden');

    if (isHost) {
      startBtn.classList.remove('hidden');
      startBtn.disabled = false;
      updateStartButton();
      statusText.textContent = '';
      statusDetail.textContent = '';
    } else {
      startBtn.classList.add('hidden');
      statusText.textContent = 'Waiting for host to start...';
      statusDetail.textContent = '';
    }

    showScreen('waiting');
  }

  function onLobbyUpdate(data) {
    playerCount = data.playerCount;
    updatePlayerCount();
    if (isHost) updateStartButton();
  }

  function updatePlayerCount() {
    playerCountEl.textContent = playerCount + (playerCount === 1 ? ' player' : ' players');
  }

  function updateStartButton() {
    startBtn.textContent = 'START (' + playerCount + (playerCount === 1 ? ' player)' : ' players)');
  }

  function hideLobbyElements() {
    lobbyTitle.classList.add('hidden');
    roomCodeBox.classList.add('hidden');
    playerCountEl.classList.add('hidden');
    playerIdentity.classList.add('hidden');
    startBtn.classList.add('hidden');
  }

  function onGameStart() {
    // Best-effort start signal for mobile controllers.
    vibrate([15, 25, 20]);
    inputSeq = 0;
    scoreDisplay.textContent = '0';
    levelDisplay.textContent = 'LVL 1';
    linesDisplay.textContent = '0 lines';
    linesProgressFill.style.width = '0%';
    garbageBar.innerHTML = '';
    garbageBar.classList.remove('garbage-bar-active', 'garbage-bar-critical');
    gameScreen.classList.remove('dead');
    gameScreen.style.setProperty('--player-color', playerColor);
    removeKoOverlay();
    removeCountdownOverlay();
    hideLobbyElements();
    showScreen('game');
    initTouchInput();
  }

  function onCountdown(data) {
    showScreen('game');
    removeCountdownOverlay();

    if (data.value === 0 || data.value === 'GO') {
      // Show brief "GO" then clear
      const overlay = document.createElement('div');
      overlay.className = 'countdown-overlay go';
      overlay.textContent = 'GO!';
      gameScreen.appendChild(overlay);
      setTimeout(removeCountdownOverlay, 400);
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'countdown-overlay';
    overlay.textContent = data.value;
    gameScreen.appendChild(overlay);
  }

  function removeCountdownOverlay() {
    const overlays = gameScreen.querySelectorAll('.countdown-overlay');
    overlays.forEach(function(el) { el.remove(); });
  }

  function onPlayerState(data) {
    if (data.score !== undefined) {
      scoreDisplay.textContent = data.score;
    }
    if (data.level !== undefined) {
      levelDisplay.textContent = 'LVL ' + data.level;
    }
    if (data.lines !== undefined) {
      linesDisplay.textContent = data.lines + (data.lines === 1 ? ' line' : ' lines');
      linesProgressFill.style.width = ((data.lines % 10) / 10 * 100) + '%';
    }
    if (data.alive === false && !gameScreen.classList.contains('dead')) {
      gameScreen.classList.add('dead');
      showKoOverlay();
    }
    if (data.garbageIncoming !== undefined) {
      renderGarbage(data.garbageIncoming);
    }
  }

  function onGameOver(data) {
    const rank = data.rank;
    const stats = data.stats || {};

    let suffix = 'th';
    if (rank === 1) suffix = 'st';
    else if (rank === 2) suffix = 'nd';
    else if (rank === 3) suffix = 'rd';

    rankDisplay.textContent = '#' + rank;

    let statsHtml = '';
    if (stats.score !== undefined) statsHtml += 'Score: ' + stats.score + '<br>';
    if (stats.lines !== undefined) statsHtml += 'Lines: ' + stats.lines + '<br>';
    if (stats.level !== undefined) statsHtml += 'Level: ' + stats.level + '<br>';
    statsDisplay.innerHTML = statsHtml;

    showScreen('gameover');
  }

  function onGameEnd(data) {
    // If we haven't already shown gameover, show it now
    if (currentScreen !== 'gameover') {
      rankDisplay.textContent = 'Game Over';
      statsDisplay.innerHTML = '';
      showScreen('gameover');
    }
  }

  function onError(data) {
    if (data.code === 'HOST_DISCONNECTED') {
      gameCancelled = true;
      hideLobbyElements();
      statusText.textContent = 'Game Cancelled';
      statusDetail.textContent = 'Host disconnected.';
      rejoinBtn.classList.remove('hidden');
      showScreen('waiting');
      return;
    }
    hideLobbyElements();
    statusText.textContent = 'Error';
    statusDetail.textContent = data.message || 'Unknown error';
    if (data.message === 'Reconnection failed') {
      rejoinBtn.classList.remove('hidden');
    }
    showScreen('waiting');
  }

  // Garbage bar rendering
  function renderGarbage(count) {
    garbageBar.innerHTML = '';
    garbageBar.classList.toggle('garbage-bar-active', count > 0);
    garbageBar.classList.toggle('garbage-bar-critical', count >= 4);
    for (let i = 0; i < count; i++) {
      const seg = document.createElement('div');
      seg.className = 'garbage-segment';
      seg.style.width = (100 / Math.max(count, 1)) + '%';
      garbageBar.appendChild(seg);
    }
  }

  // KO overlay
  function showKoOverlay() {
    removeKoOverlay();
    const ko = document.createElement('div');
    ko.id = 'ko-overlay';
    ko.textContent = 'KO';
    touchArea.appendChild(ko);
  }

  function removeKoOverlay() {
    const el = document.getElementById('ko-overlay');
    if (el) el.remove();
  }

  // Gesture feedback
  let lastTouchX = 0, lastTouchY = 0;
  let coordTracker = null;
  let softDropActive = false;
  let softDropWash = null;
  let buildupEl = null;
  let buildupDir = null;

  function createFeedback(type, x, y) {
    var el = document.createElement('div');
    el.className = 'feedback-' + type;
    if (x !== undefined && y !== undefined) {
      var rect = feedbackLayer.getBoundingClientRect();
      el.style.left = (x - rect.left) + 'px';
      el.style.top = (y - rect.top) + 'px';
    }
    feedbackLayer.appendChild(el);
    el.addEventListener('animationend', function () { el.remove(); });
  }

  function createWash(direction) {
    var el = document.createElement('div');
    el.className = 'feedback-wash feedback-wash-' + direction;
    feedbackLayer.appendChild(el);
    el.addEventListener('animationend', function () { el.remove(); });
  }

  // Buildup wash manager
  function removeBuildupEl() {
    if (buildupEl) {
      buildupEl.remove();
      buildupEl = null;
      buildupDir = null;
    }
  }

  function flashBuildup() {
    if (buildupEl) {
      buildupEl.classList.add('flash');
      var el = buildupEl;
      buildupEl = null;
      buildupDir = null;
      el.addEventListener('animationend', function () { el.remove(); });
    }
  }

  function onDragProgress(direction, progress) {
    if (!direction || progress <= 0) {
      removeBuildupEl();
      return;
    }

    // Direction changed — recreate element
    if (buildupDir !== direction) {
      removeBuildupEl();
      // Map drag direction to wash gradient (drag right = wash from left edge)
      var washDir = direction;
      if (direction === 'left') washDir = 'right';
      else if (direction === 'right') washDir = 'left';
      else if (direction === 'down') washDir = 'up';
      else if (direction === 'up') washDir = 'down';
      buildupEl = document.createElement('div');
      buildupEl.className = 'feedback-buildup feedback-wash-' + washDir;
      feedbackLayer.appendChild(buildupEl);
      buildupDir = direction;
    }

    buildupEl.style.opacity = progress * 0.15;
  }

  // Touch input
  function initTouchInput() {
    if (touchInput) {
      touchInput.destroy();
    }

    // Track pointer coordinates for positioned feedback (remove previous to avoid leak)
    if (coordTracker) touchArea.removeEventListener('pointerdown', coordTracker);
    coordTracker = function (e) {
      lastTouchX = e.clientX;
      lastTouchY = e.clientY;
    };
    touchArea.addEventListener('pointerdown', coordTracker, { passive: true });

    touchInput = new TouchInput(touchArea, function (action, data) {
      // Gesture feedback
      if (action === 'rotate_cw') {
        createFeedback('ripple', lastTouchX, lastTouchY);
      } else if (action === 'left' || action === 'right') {
        // Flash the horizontal buildup wash on ratchet step
        if (buildupEl) {
          flashBuildup();
        } else {
          createWash(action === 'left' ? 'right' : 'left');
        }
      } else if (action === 'hard_drop' || action === 'hold') {
        // Flick gestures — clear any stale buildup, use fresh directional wash
        removeBuildupEl();
        createWash(action === 'hard_drop' ? 'up' : 'down');
      }

      if (action === 'soft_drop_start') {
        if (!softDropActive) {
          softDropActive = true;
          removeBuildupEl();
          softDropWash = document.createElement('div');
          softDropWash.className = 'feedback-wash feedback-wash-up feedback-wash-hold';
          feedbackLayer.appendChild(softDropWash);
        }
        send(MSG.SOFT_DROP_START, { speed: data.speed });
      } else if (action === 'soft_drop_end') {
        softDropActive = false;
        if (softDropWash) {
          var el = softDropWash;
          softDropWash = null;
          el.classList.add('fade-out');
          el.addEventListener('animationend', function () { el.remove(); });
        }
        send(MSG.SOFT_DROP_END);
      } else {
        // Regular input: left, right, rotate_cw, hard_drop, hold
        send(MSG.INPUT, { action: action, seq: inputSeq++ });
      }
    }, onDragProgress);
  }

  // Rejoin button
  rejoinBtn.addEventListener('click', function () {
    sessionStorage.removeItem('reconnectToken_' + roomCode);
    sessionStorage.removeItem('playerId_' + roomCode);
    gameCancelled = false;
    reconnectAttempts = 0;
    clearTimeout(reconnectTimer);
    rejoinBtn.classList.add('hidden');
    statusText.textContent = 'Connecting...';
    statusDetail.textContent = '';
    connect();
  });

  // Start button (host only)
  startBtn.addEventListener('click', function () {
    if (!isHost || startBtn.disabled) return;
    send(MSG.START_GAME, { mode: MODE.COMPETITIVE });
  });

  // Start connection
  connect();
})();

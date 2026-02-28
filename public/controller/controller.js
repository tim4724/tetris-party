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
  let hintHidden = false;
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
  const startBtn = document.getElementById('start-btn');
  const statusText = document.getElementById('status-text');
  const statusDetail = document.getElementById('status-detail');
  const playerNameEl = document.getElementById('player-name');
  const playerIndicator = document.getElementById('player-indicator');
  const scoreDisplay = document.getElementById('score-display');
  const touchArea = document.getElementById('touch-area');
  const touchHint = document.getElementById('touch-hint');
  const garbageBar = document.getElementById('garbage-bar');
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

  // Capture-phase listener so it fires before any other touch handler.
  document.addEventListener('touchstart', function onFirstTouch() {
    primeVibration();
    document.removeEventListener('touchstart', onFirstTouch, true);
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
      statusDetail.textContent = 'Could not reconnect. Refresh to try again.';
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

    const name = PLAYER_NAMES[playerId - 1] || ('Player ' + playerId);
    playerNameEl.textContent = name;
    playerIndicator.style.background = playerColor;

    // Show lobby UI
    lobbyTitle.classList.remove('hidden');
    roomCodeBox.classList.remove('hidden');
    roomCodeValue.textContent = roomCode;
    playerCountEl.classList.remove('hidden');
    updatePlayerCount();

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

  function onGameStart() {
    // Best-effort start signal for mobile controllers.
    vibrate([15, 25, 20]);
    inputSeq = 0;
    scoreDisplay.textContent = '0';
    garbageBar.innerHTML = '';
    gameScreen.classList.remove('dead');
    hintHidden = false;
    removeCountdownOverlay();

    // Hide lobby elements
    lobbyTitle.classList.add('hidden');
    roomCodeBox.classList.add('hidden');
    playerCountEl.classList.add('hidden');
    startBtn.classList.add('hidden');

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
    if (data.alive === false) {
      gameScreen.classList.add('dead');
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
      lobbyTitle.classList.add('hidden');
      roomCodeBox.classList.add('hidden');
      playerCountEl.classList.add('hidden');
      startBtn.classList.add('hidden');
      statusText.textContent = 'Game Cancelled';
      statusDetail.textContent = 'Host disconnected. Refresh to rejoin.';
      showScreen('waiting');
      return;
    }
    statusText.textContent = 'Error';
    statusDetail.textContent = data.message || 'Unknown error';
    showScreen('waiting');
  }

  // Garbage bar rendering
  function renderGarbage(count) {
    garbageBar.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const seg = document.createElement('div');
      seg.className = 'garbage-segment';
      seg.style.width = (100 / Math.max(count, 1)) + '%';
      garbageBar.appendChild(seg);
    }
  }

  // Touch input
  function initTouchInput() {
    if (touchInput) {
      touchInput.destroy();
    }

    touchInput = new TouchInput(touchArea, function (action, data) {
      // Hide hints on first input
      if (!hintHidden && touchHint) {
        touchHint.classList.add('fade-out');
        hintHidden = true;
      }

      if (action === 'soft_drop_start') {
        send(MSG.SOFT_DROP_START, { speed: data.speed });
      } else if (action === 'soft_drop_end') {
        send(MSG.SOFT_DROP_END);
      } else {
        // Regular input: left, right, rotate_cw, hard_drop, hold
        send(MSG.INPUT, { action: action, seq: inputSeq++ });
      }
    });
  }

  // Start button (host only)
  startBtn.addEventListener('click', function () {
    if (!isHost || startBtn.disabled) return;
    send(MSG.START_GAME, { mode: MODE.COMPETITIVE });
  });

  // Start connection
  connect();
})();

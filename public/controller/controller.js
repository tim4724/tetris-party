'use strict';

(function () {
  // State
  let ws = null;
  let playerId = null;
  let playerColor = null;
  let playerName = null;
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

  // Falling tetromino background
  const bgCanvas = document.getElementById('bg-canvas');
  let welcomeBg = null;
  if (bgCanvas) {
    welcomeBg = new WelcomeBackground(bgCanvas, 8);
    welcomeBg.resize(window.innerWidth, window.innerHeight);
    welcomeBg.start();
    window.addEventListener('resize', function () {
      welcomeBg.resize(window.innerWidth, window.innerHeight);
    });
  }

  // DOM refs
  const nameForm = document.getElementById('name-form');
  const nameInput = document.getElementById('name-input');
  const nameJoinBtn = document.getElementById('name-join-btn');
  const waitingScreen = document.getElementById('waiting-screen');
  const gameScreen = document.getElementById('game-screen');
  const gameoverScreen = document.getElementById('gameover-screen');
  const lobbyTitle = document.getElementById('lobby-title');
  const playerIdentity = document.getElementById('player-identity');
  const startBtn = document.getElementById('start-btn');
  const statusText = document.getElementById('status-text');
  const statusDetail = document.getElementById('status-detail');
  const rejoinBtn = document.getElementById('rejoin-btn');
  const playerNameEl = document.getElementById('player-name');
  const playerIdentityName = document.getElementById('player-identity-name');
  const touchArea = document.getElementById('touch-area');
  const feedbackLayer = document.getElementById('feedback-layer');
  const gameoverTitle = document.getElementById('gameover-title');
  const resultsList = document.getElementById('results-list');
  const gameoverButtons = document.getElementById('gameover-buttons');
  const playAgainBtn = document.getElementById('play-again-btn');
  const newGameBtn = document.getElementById('new-game-btn');
  const gameoverStatus = document.getElementById('gameover-status');
  const pauseBtn = document.getElementById('pause-btn');
  const pauseOverlay = document.getElementById('pause-overlay');
  const pauseContinueBtn = document.getElementById('pause-continue-btn');
  const pauseNewGameBtn = document.getElementById('pause-newgame-btn');
  const pauseStatus = document.getElementById('pause-status');
  const pauseButtons = document.getElementById('pause-buttons');
  const muteBtn = document.getElementById('mute-btn');
  let muted = localStorage.getItem('tetris_muted') === '1';

  // Apply initial mute state
  if (muted) {
    muteBtn.classList.add('muted');
    muteBtn.querySelector('.sound-waves').style.display = 'none';
  }

  muteBtn.addEventListener('click', function () {
    muted = !muted;
    localStorage.setItem('tetris_muted', muted ? '1' : '0');
    muteBtn.classList.toggle('muted', muted);
    muteBtn.querySelector('.sound-waves').style.display = muted ? 'none' : '';
  });

  // Edit mode state
  let editingName = false;

  // Screen management
  function showScreen(name) {
    currentScreen = name;
    waitingScreen.classList.toggle('hidden', name !== 'waiting');
    gameScreen.classList.toggle('hidden', name !== 'game');
    gameoverScreen.classList.toggle('hidden', name !== 'gameover');

    // Falling blocks on waiting screen only
    if (welcomeBg) {
      if (name === 'waiting') {
        welcomeBg.start();
      } else {
        welcomeBg.stop();
      }
    }
  }

  // Extract room code and optional rejoin ID from URL
  roomCode = location.pathname.split('/').filter(Boolean)[0] || null;
  const rejoinId = new URLSearchParams(location.search).get('rejoin');
  if (!roomCode) {
    showScreen('waiting');
    statusText.textContent = 'No Room Code';
    statusDetail.textContent = 'Scan a QR code or use a join link';
    return;
  }

  // --- Name input ---
  var savedName = localStorage.getItem('tetris_player_name') || '';

  function submitName() {
    var name = nameInput.value.trim();
    if (!name) return;

    if (editingName && ws && ws.readyState === WebSocket.OPEN) {
      // Already connected — send name change, exit edit mode
      send(MSG.CHANGE_NAME, { name: name });
      exitEditMode();
      return;
    }

    // Not connected yet — join flow
    playerName = name;
    localStorage.setItem('tetris_player_name', name);
    nameForm.classList.add('hidden');
    statusText.textContent = 'Connecting...';
    statusDetail.textContent = '';
    connect();
  }

  function enterEditMode() {
    editingName = true;
    nameInput.value = playerName || '';
    nameJoinBtn.textContent = 'SAVE';
    nameForm.classList.remove('hidden');
    playerIdentity.classList.add('hidden');
    nameInput.focus();
  }

  function exitEditMode() {
    editingName = false;
    nameJoinBtn.textContent = 'JOIN';
    nameForm.classList.add('hidden');
    playerIdentity.classList.remove('hidden');
  }

  nameJoinBtn.addEventListener('click', submitName);
  nameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') submitName();
  });

  // Tap player card to edit name
  document.getElementById('player-identity-card').addEventListener('click', function () {
    if (currentScreen !== 'waiting') return;
    enterEditMode();
  });

  function vibrate(pattern) {
    if (!navigator.vibrate) return;
    navigator.vibrate(pattern);
  }

  // --- Web Audio sound effects (works on iOS where vibrate doesn't) ---
  let audioCtx = null;

  function getAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // Short tactile tick — supplements vibrate for haptic-like feedback
  function playTick() {
    if (muted) return;
    var ctx = getAudioCtx();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 150;
    osc.type = 'sine';
    gain.gain.setValueAtTime(1.0, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.04);
  }

  // Line clear chime — pitch and duration scale with lines cleared
  function playLineClear(count) {
    if (muted) return;
    var ctx = getAudioCtx();
    var baseFreq = count >= 4 ? 600 : count >= 3 ? 500 : count >= 2 ? 440 : 380;
    var duration = count >= 4 ? 0.25 : 0.15;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, ctx.currentTime + duration);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  }

  // Hard drop — punchy impact with noise burst
  function playDrop() {
    if (muted) return;
    var ctx = getAudioCtx();
    var t = ctx.currentTime;
    // Low thud
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.1);
    gain.gain.setValueAtTime(0.9, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.start(t);
    osc.stop(t + 0.1);
    // Noise snap layer
    var buf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    var noise = ctx.createBufferSource();
    var nGain = ctx.createGain();
    noise.buffer = buf;
    noise.connect(nGain);
    nGain.connect(ctx.destination);
    nGain.gain.setValueAtTime(0.36, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    noise.start(t);
  }

  // Hold — quick two-tone swoosh (high→low)
  function playHold() {
    if (muted) return;
    var ctx = getAudioCtx();
    var t = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(500, t);
    osc.frequency.exponentialRampToValueAtTime(250, t + 0.08);
    gain.gain.setValueAtTime(0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  // Prime audio context + vibration on first user interaction (required by iOS)
  let audioPrimed = false;

  function primeAudio() {
    if (audioPrimed) return;
    audioPrimed = true;
    vibrate(1);
    var ctx = getAudioCtx();
    var buf = ctx.createBuffer(1, 1, ctx.sampleRate);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  }

  // Capture-phase listener so it fires before any other pointer handler.
  document.addEventListener('pointerdown', function onFirstPointer() {
    primeAudio();
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
      } else if (rejoinId) {
        send(MSG.JOIN, { roomCode: roomCode, rejoinId: rejoinId, name: playerName });
      } else {
        send(MSG.JOIN, { roomCode: roomCode, name: playerName });
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
      case MSG.NAME_CHANGED:
        playerName = data.name;
        playerIdentityName.textContent = data.name;
        playerNameEl.textContent = data.name;
        localStorage.setItem('tetris_player_name', data.name);
        break;
      case MSG.LOBBY_UPDATE:
        onLobbyUpdate(data);
        break;
      case MSG.GAME_START:
        onGameStart();
        break;
      case MSG.COUNTDOWN:
        // Show game screen in muted state during countdown (no overlay)
        if (currentScreen !== 'game') {
          gameScreen.classList.remove('dead');
          gameScreen.classList.remove('paused');
          gameScreen.classList.add('countdown');
          gameScreen.style.setProperty('--player-color', playerColor);
          pauseOverlay.classList.add('hidden');
          pauseBtn.disabled = false;
          pauseBtn.classList.toggle('hidden', !isHost);
          hideLobbyElements();
          showScreen('game');
        }
        break;
      case MSG.PLAYER_STATE:
        onPlayerState(data);
        break;
      case MSG.GAME_OVER:
        // Player KO'd mid-game — wait for GAME_END for results
        break;
      case MSG.GAME_END:
        onGameEnd(data);
        break;
      case MSG.GAME_PAUSED:
        onGamePaused();
        break;
      case MSG.GAME_RESUMED:
        onGameResumed();
        break;
      case MSG.RETURN_TO_LOBBY:
        playerCount = data.playerCount || playerCount;
        gameScreen.classList.remove('dead');
        gameScreen.classList.remove('paused');
        showLobbyUI();
        break;
      case MSG.ROOM_RESET:
        gameCancelled = true;
        hideLobbyElements();
        statusText.textContent = 'Game Over';
        statusDetail.textContent = '';
        showScreen('waiting');
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

    // Use server-confirmed name, falling back to local name or generic
    if (data.playerName) playerName = data.playerName;
    if (!playerName) playerName = PLAYER_NAMES[playerId - 1] || ('Player ' + playerId);

    playerNameEl.textContent = playerName;

    // Reconnected into an active game — jump straight to game screen
    if (data.reconnected && (data.roomState === 'playing' || data.roomState === 'countdown')) {
      hideLobbyElements();
      gameScreen.classList.remove('dead');
      gameScreen.classList.remove('paused');
      gameScreen.style.setProperty('--player-color', playerColor);
      removeKoOverlay();

      pauseOverlay.classList.add('hidden');
      pauseBtn.classList.toggle('hidden', !isHost);
      showScreen('game');
      initTouchInput();
      return;
    }

    showLobbyUI();
  }

  function onLobbyUpdate(data) {
    playerCount = data.playerCount;
    if (typeof data.isHost === 'boolean') {
      isHost = data.isHost;
    }
    if (isHost) updateStartButton();
  }

  function updateStartButton() {
    startBtn.textContent = 'START (' + playerCount + (playerCount === 1 ? ' player)' : ' players)');
  }

  function hideLobbyElements() {
    lobbyTitle.classList.add('hidden');
    nameForm.classList.add('hidden');
    playerIdentity.classList.add('hidden');
    startBtn.classList.add('hidden');
  }

  function showLobbyUI() {
    lobbyTitle.classList.remove('hidden');
    nameForm.classList.add('hidden');
    rejoinBtn.classList.add('hidden');
    editingName = false;
    nameJoinBtn.textContent = 'JOIN';

    playerIdentity.style.setProperty('--player-color', playerColor);
    playerIdentityName.textContent = playerName || ('Player ' + playerId);
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

  function onGameStart() {
    // Best-effort start signal for mobile controllers.
    vibrate([15, 25, 20]);
    playTick();
    inputSeq = 0;
    onPlayerState._lastLines = 0;
    gameScreen.classList.remove('dead');
    gameScreen.classList.remove('paused');
    gameScreen.classList.remove('countdown');
    gameScreen.style.setProperty('--player-color', playerColor);
    removeKoOverlay();
    pauseOverlay.classList.add('hidden');
    pauseBtn.disabled = false;
    pauseBtn.classList.toggle('hidden', !isHost);
    hideLobbyElements();
    showScreen('game');
    initTouchInput();
  }

  function onPlayerState(data) {
    // Fallback: if GAME_START was missed, init touch on first state update
    if (!touchInput) {
      gameScreen.classList.remove('countdown');
      pauseBtn.disabled = false;
      pauseBtn.classList.toggle('hidden', !isHost);
      initTouchInput();
    }
    if (data.lines !== undefined && data.lines > (onPlayerState._lastLines || 0)) {
      playLineClear(data.lines - (onPlayerState._lastLines || 0));
    }
    if (data.lines !== undefined) onPlayerState._lastLines = data.lines;
    if (data.alive === false && !gameScreen.classList.contains('dead')) {
      gameScreen.classList.add('dead');
      showKoOverlay();
    }
  }

  function onGameEnd(data) {
    renderGameResults(data.results);
    showScreen('gameover');
  }

  function renderGameResults(results) {
    resultsList.innerHTML = '';
    gameoverTitle.textContent = 'RESULTS';

    // Show buttons for host, status text for others
    gameoverButtons.classList.toggle('hidden', !isHost);
    gameoverStatus.textContent = isHost ? '' : 'Waiting for host...';

    // Set winner glow color on the screen
    var winnerColor = 'rgba(255, 215, 0, 0.06)';
    if (results && results.length) {
      var winner = results.find(function(r) { return r.rank === 1; });
      if (winner) {
        var wc = PLAYER_COLORS[(winner.playerId - 1) % PLAYER_COLORS.length];
        winnerColor = 'color-mix(in srgb, ' + wc + ' 8%, transparent)';
      }
    }
    gameoverScreen.style.setProperty('--winner-glow', winnerColor);

    // Set player's own color for highlight
    if (playerColor) {
      gameoverScreen.style.setProperty('--me-color', playerColor);
    }

    if (!results || !results.length) return;

    var sorted = results.slice().sort(function(a, b) { return a.rank - b.rank; });
    for (var i = 0; i < sorted.length; i++) {
      var r = sorted[i];
      var pColor = PLAYER_COLORS[(r.playerId - 1) % PLAYER_COLORS.length];

      var row = document.createElement('div');
      row.className = 'result-row rank-' + r.rank;
      row.style.setProperty('--row-delay', (0.2 + i * 0.08) + 's');
      if (r.playerId === playerId) row.classList.add('is-me');

      var rankEl = document.createElement('span');
      rankEl.className = 'result-rank';
      rankEl.textContent = r.rank <= 3 ? ['', '1st', '2nd', '3rd'][r.rank] : r.rank + 'th';

      var info = document.createElement('div');
      info.className = 'result-info';

      var nameEl = document.createElement('span');
      nameEl.className = 'result-name';
      nameEl.textContent = r.playerName || ('Player ' + r.playerId);
      nameEl.style.color = pColor;

      var scoreEl = document.createElement('span');
      scoreEl.className = 'result-score';
      scoreEl.textContent = (r.score || 0).toLocaleString() + ' pts';

      info.appendChild(nameEl);
      info.appendChild(scoreEl);
      row.appendChild(rankEl);
      row.appendChild(info);
      resultsList.appendChild(row);
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

  // Pause
  function onGamePaused() {
    gameScreen.classList.add('paused');
    pauseOverlay.classList.remove('hidden');
    pauseBtn.classList.add('hidden');
    if (isHost) {
      pauseButtons.classList.remove('hidden');
      pauseStatus.textContent = '';
    } else {
      pauseButtons.classList.add('hidden');
      pauseStatus.textContent = 'Game paused by host';
    }
  }

  function onGameResumed() {
    gameScreen.classList.remove('paused');
    pauseOverlay.classList.add('hidden');
    if (isHost) {
      pauseBtn.classList.remove('hidden');
    }
  }

  pauseBtn.addEventListener('click', function () {
    if (!isHost) return;
    send(MSG.PAUSE_GAME);
  });

  pauseContinueBtn.addEventListener('click', function () {
    if (!isHost) return;
    send(MSG.RESUME_GAME);
  });

  pauseNewGameBtn.addEventListener('click', function () {
    if (!isHost) return;
    send(MSG.RETURN_TO_LOBBY);
  });

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
      // Gesture feedback — audio + visual
      if (action === 'rotate_cw') {
        playTick();
        createFeedback('ripple', lastTouchX, lastTouchY);
      } else if (action === 'left' || action === 'right') {
        playTick();
        // Flash the horizontal buildup wash on ratchet step
        if (buildupEl) {
          flashBuildup();
        } else {
          createWash(action === 'left' ? 'right' : 'left');
        }
      } else if (action === 'hard_drop') {
        playDrop();
        removeBuildupEl();
        createWash('up');
      } else if (action === 'hold') {
        playHold();
        removeBuildupEl();
        createWash('down');
      }

      if (action === 'soft_drop_start') {
        if (!softDropActive) {
          softDropActive = true;
          playTick();
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
    send(MSG.START_GAME);
  });

  // Play Again button (host only, on gameover screen)
  playAgainBtn.addEventListener('click', function () {
    if (!isHost) return;
    send(MSG.PLAY_AGAIN);
  });

  // New Game button (host only, returns to lobby)
  newGameBtn.addEventListener('click', function () {
    if (!isHost) return;
    send(MSG.RETURN_TO_LOBBY);
  });

  // When the phone locks, the browser freezes the page and the WebSocket
  // goes stale.  Messages sent while frozen (like GAME_START) are lost.
  // Force a fresh reconnection when the page becomes visible again so the
  // controller picks up the current room state.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (currentScreen === 'gameover' || gameCancelled) return;
    // Don't reconnect if on waiting screen with no active connection (pre-join)
    if (currentScreen === 'waiting' && !playerId) return;
    // Tear down the (possibly stale) connection and reconnect immediately.
    reconnectAttempts = 0;
    clearTimeout(reconnectTimer);
    if (ws) {
      // Suppress the onclose→attemptReconnect chain; we're reconnecting ourselves.
      ws.onclose = null;
      ws.onerror = null;
      try { ws.close(); } catch (_) {}
      ws = null;
    }
    connect();
  });

  // Always start on the waiting screen
  var hasToken = sessionStorage.getItem('reconnectToken_' + roomCode);
  if (hasToken || rejoinId) {
    // Reconnect — hide name form, show connecting status
    playerName = savedName || null;
    nameForm.classList.add('hidden');
    statusText.textContent = 'Connecting...';
    statusDetail.textContent = '';
    showScreen('waiting');
    connect();
  } else {
    // Fresh join — show name form
    nameInput.value = savedName;
    statusText.textContent = '';
    statusDetail.textContent = '';
    showScreen('waiting');
    nameInput.focus();
  }
})();

'use strict';

const { MSG, ROOM_STATE } = require('../public/shared/protocol.js');
const QRCode = require('qrcode');
const Game = require('./Game.js');
const {
  MAX_PLAYERS,
  COUNTDOWN_SECONDS
} = require('./constants.js');
const { PLAYER_COLORS } = require('../public/shared/colors.js');

// Track active room codes to avoid collisions
const activeRoomCodes = new Set();

class Room {
  constructor(roomCode, displayWs) {
    this.roomCode = roomCode;
    this.displayWs = displayWs;
    this.state = ROOM_STATE.LOBBY;
    this.players = new Map(); // id -> { ws, name, color, reconnectToken, connected, graceTimer }
    this.game = null;
    this.countdownTimer = null;
    this.hostId = null;
    this.joinUrl = null;
    this.paused = false;
    this._goTimeout = null;
    this._displayGraceTimer = null;

    activeRoomCodes.add(roomCode);
  }

  static generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code;
    let attempts = 0;
    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      attempts++;
      if (attempts > 1000) throw new Error('Unable to generate unique room code');
    } while (activeRoomCodes.has(code));
    return code;
  }

  getNextPlayerId() {
    for (let id = 1; id <= MAX_PLAYERS; id++) {
      if (!this.players.has(id)) return id;
    }
    return null;
  }

  addPlayer(ws, name) {
    if (this.state !== ROOM_STATE.LOBBY) {
      send(ws, MSG.ERROR, { message: 'Game already in progress' });
      return null;
    }

    const playerId = this.getNextPlayerId();
    if (playerId === null) {
      send(ws, MSG.ERROR, { message: 'Room is full' });
      return null;
    }
    const color = PLAYER_COLORS[(playerId - 1) % PLAYER_COLORS.length];
    const reconnectToken = generateToken();
    const isHost = this.hostId === null;
    if (isHost) this.hostId = playerId;

    const cleanName = typeof name === 'string' ? name.trim().slice(0, 16) : '';
    const playerName = cleanName || `Player ${playerId}`;

    this.players.set(playerId, {
      ws,
      name: playerName,
      color,
      reconnectToken,
      connected: true,
      graceTimer: null
    });

    // Notify display
    this.sendToDisplay(MSG.PLAYER_JOINED, {
      playerId,
      playerName,
      playerColor: color,
      playerCount: this.players.size
    });

    this.broadcastLobbyUpdate();

    return { playerId, name: playerName, color, reconnectToken, isHost };
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;

    if (this.state === ROOM_STATE.LOBBY) {
      // Grace period: hold the slot briefly so a reconnecting controller
      // (e.g. visibilitychange race) can rejoin before we remove them.
      player.connected = false;
      player.ws = null;
      player.graceTimer = setTimeout(() => {
        const current = this.players.get(playerId);
        if (!current || current.connected) return; // reconnected during grace
        this.players.delete(playerId);

        if (playerId === this.hostId) {
          this.hostId = null;
          this.broadcastToControllers(MSG.ERROR, { code: 'HOST_DISCONNECTED', message: 'Host disconnected' });
          for (const [, p] of this.players) {
            if (p.ws) {
              try { p.ws.close(); } catch (e) { /* ignore */ }
            }
          }
          this.players.clear();
          this.sendToDisplay(MSG.ROOM_RESET);
        } else {
          this.broadcastLobbyUpdate();
          this.sendToDisplay(MSG.PLAYER_LEFT, {
            playerId,
            playerCount: this.players.size
          });
        }
      }, 5000);
    } else {
      // In game: mark disconnected, show QR on display for rejoin
      player.connected = false;
      player.ws = null;
      this._sendDisconnectQR(playerId);
    }
  }

  _sendDisconnectQR(playerId) {
    const player = this.players.get(playerId);
    if (player) {
      player._qrGeneration = (player._qrGeneration || 0) + 1;
    }
    const generation = player ? player._qrGeneration : 0;

    if (this.joinUrl) {
      const rejoinUrl = `${this.joinUrl}?player=${playerId}`;
      this.getQRUrl(rejoinUrl).then((qrDataUrl) => {
        const p = this.players.get(playerId);
        if (p && (p.connected || p._qrGeneration !== generation)) return;
        this.sendToDisplay(MSG.PLAYER_DISCONNECTED, { playerId, qrDataUrl });
      });
    } else {
      this.sendToDisplay(MSG.PLAYER_DISCONNECTED, { playerId, qrDataUrl: null });
    }
  }

  reconnectPlayer(playerId, ws, token) {
    const player = this.players.get(playerId);
    if (!player) return false;
    if (player.reconnectToken !== token) return false;

    player.ws = ws;
    player.connected = true;

    if (player.graceTimer) {
      clearTimeout(player.graceTimer);
      player.graceTimer = null;
    }

    this.sendToDisplay(MSG.PLAYER_RECONNECTED, { playerId });
    return true;
  }

  reconnectByToken(ws, token) {
    for (const [id, player] of this.players) {
      if (player.reconnectToken === token) {
        // Close old socket to prevent duplicate connections
        if (player.connected && player.ws && player.ws.readyState === 1) {
          try { player.ws.close(); } catch (e) { /* ignore */ }
        }
        player.ws = ws;
        player.connected = true;
        if (player.graceTimer) {
          clearTimeout(player.graceTimer);
          player.graceTimer = null;
        }
        this.sendToDisplay(MSG.PLAYER_RECONNECTED, { playerId: id });
        return id;
      }
    }
    return null;
  }

  rejoinById(playerId, ws) {
    const player = this.players.get(playerId);
    if (!player || player.connected) return null;

    player.ws = ws;
    player.connected = true;
    const reconnectToken = generateToken();
    player.reconnectToken = reconnectToken;

    if (player.graceTimer) {
      clearTimeout(player.graceTimer);
      player.graceTimer = null;
    }

    this.sendToDisplay(MSG.PLAYER_RECONNECTED, { playerId });

    return {
      playerId,
      name: player.name,
      color: player.color,
      reconnectToken,
      isHost: playerId === this.hostId
    };
  }

  getQRMatrix(text) {
    try {
      const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
      const size = qr.modules.size;
      const modules = Array.from(qr.modules.data);
      return { size, modules };
    } catch (err) {
      console.error('QR matrix generation failed:', err);
      return null;
    }
  }

  async getQRUrl(joinUrl) {
    try {
      return await QRCode.toDataURL(joinUrl, { width: 256, margin: 1 });
    } catch (err) {
      console.error('QR generation failed:', err);
      return null;
    }
  }

  startGame() {
    if (this.state !== ROOM_STATE.LOBBY) return;

    if (this.players.size < 1) {
      this.sendToDisplay(MSG.ERROR, { message: 'Need at least 1 player' });
      return;
    }

    this._startNewGame();
  }

  playAgain() {
    if (this.state !== ROOM_STATE.RESULTS) return;
    this._startNewGame();
  }

  _startNewGame() {
    if (this.game) {
      this.game.stop();
      this.game = null;
    }
    this.paused = false;

    this.state = ROOM_STATE.COUNTDOWN;

    this.startCountdown(() => {
      // Include ALL players (even disconnected) so they keep their slot
      const gamePlayers = new Map();
      for (const [id, p] of this.players) {
        gamePlayers.set(id, { ws: p.ws });
      }

      this.game = new Game(gamePlayers, {
        onGameState: (state) => {
          this.sendToDisplay(MSG.GAME_STATE, state);
          if (state.players) {
            for (const p of state.players) {
              this.sendToPlayer(p.id, MSG.PLAYER_STATE, {
                score: p.score,
                level: p.level,
                lines: p.lines,
                alive: p.alive,
                garbageIncoming: p.pendingGarbage || 0
              });
            }
          }
        },
        onEvent: (event) => {
          if (event.type === 'line_clear') {
            this.sendToDisplay(MSG.LINE_CLEAR, event);
          } else if (event.type === 'player_ko') {
            this.sendToDisplay(MSG.PLAYER_KO, event);
            this.sendToPlayer(event.playerId, MSG.GAME_OVER, { playerId: event.playerId });
          } else if (event.type === 'garbage_sent') {
            this.sendToDisplay(MSG.GARBAGE_SENT, event);
          }
        },
        onGameEnd: (results) => {
          this.onGameEnd(results);
        }
      });

      this.state = ROOM_STATE.PLAYING;
      this.broadcast(MSG.GAME_START, {});
      this.game.start();

      // Re-notify display about any still-disconnected players so QR overlays appear
      for (const [id, p] of this.players) {
        if (!p.connected) {
          this._sendDisconnectQR(id);
        }
      }
    });
  }

  startCountdown(onComplete, startFrom) {
    let count = startFrom || COUNTDOWN_SECONDS;
    this._countdownCallback = onComplete;
    this._countdownRemaining = count;

    this.broadcast(MSG.COUNTDOWN, { value: count });

    this.countdownTimer = setInterval(() => {
      count--;
      this._countdownRemaining = count;
      if (count > 0) {
        this.broadcast(MSG.COUNTDOWN, { value: count });
      } else {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        this._countdownRemaining = 0;
        // Send final "GO" so clients know to clear overlay
        this.broadcast(MSG.COUNTDOWN, { value: 'GO' });
        this._goTimeout = setTimeout(() => {
          this._goTimeout = null;
          onComplete();
        }, 500);
      }
    }, 1000);
  }

  pauseGame() {
    if (this.paused) return;
    if (this.state !== ROOM_STATE.PLAYING && this.state !== ROOM_STATE.COUNTDOWN) return;
    this.paused = true;
    if (this.state === ROOM_STATE.COUNTDOWN && this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.game) this.game.pause();
    this.broadcast(MSG.GAME_PAUSED, {});
  }

  resumeGame() {
    if (!this.paused) return;
    if (this.state !== ROOM_STATE.PLAYING && this.state !== ROOM_STATE.COUNTDOWN) return;
    this.paused = false;
    if (this.state === ROOM_STATE.COUNTDOWN && this._countdownCallback) {
      this.broadcast(MSG.GAME_RESUMED, {});
      this.startCountdown(this._countdownCallback, this._countdownRemaining);
      return;
    }
    if (this.game) this.game.resume();
    this.broadcast(MSG.GAME_RESUMED, {});
  }

  handleInput(playerId, action, seq) {
    if (this.game && this.state === ROOM_STATE.PLAYING && !this.paused) {
      this.game.processInput(playerId, action);
      this.sendToPlayer(playerId, MSG.INPUT_ACK, { seq });
    }
  }

  handleSoftDropStart(playerId, speed) {
    if (this.game && this.state === ROOM_STATE.PLAYING && !this.paused) {
      this.game.handleSoftDropStart(playerId, speed);
    }
  }

  handleSoftDropEnd(playerId) {
    if (this.game && this.state === ROOM_STATE.PLAYING && !this.paused) {
      this.game.handleSoftDropEnd(playerId);
    }
  }

  broadcast(type, data) {
    this.sendToDisplay(type, data);
    for (const [id, player] of this.players) {
      if (player.connected && player.ws) {
        send(player.ws, type, data);
      }
    }
  }

  sendToDisplay(type, data) {
    if (this.displayWs) {
      send(this.displayWs, type, data);
    }
  }

  sendToPlayer(playerId, type, data) {
    const player = this.players.get(playerId);
    if (player && player.connected && player.ws) {
      send(player.ws, type, data);
    }
  }

  broadcastToControllers(type, data) {
    for (const [, player] of this.players) {
      if (player.connected && player.ws) {
        send(player.ws, type, data);
      }
    }
  }

  broadcastLobbyUpdate() {
    for (const [id, player] of this.players) {
      if (player.connected && player.ws) {
        send(player.ws, MSG.LOBBY_UPDATE, {
          playerCount: this.players.size,
          isHost: id === this.hostId
        });
      }
    }
  }

  onGameEnd(results) {
    this.state = ROOM_STATE.RESULTS;
    // Enrich results with player names
    if (results && results.results) {
      for (const r of results.results) {
        const player = this.players.get(r.playerId);
        if (player) r.playerName = player.name;
      }
    }
    this.broadcast(MSG.GAME_END, results);
  }

  returnToLobby() {
    if (this.game) {
      this.game.stop();
      this.game = null;
    }

    const disconnectedIds = [];
    for (const [id, player] of this.players) {
      if (!player.connected) {
        disconnectedIds.push(id);
      }
    }

    if (this.hostId !== null && disconnectedIds.includes(this.hostId)) {
      this.state = ROOM_STATE.LOBBY;
      this.broadcastToControllers(MSG.ERROR, {
        code: 'HOST_DISCONNECTED',
        message: 'Host disconnected'
      });

      for (const [, player] of this.players) {
        if (player.ws) {
          try { player.ws.close(); } catch (e) { /* ignore */ }
        }
      }

      this.players.clear();
      this.hostId = null;
      this.sendToDisplay(MSG.ROOM_RESET);
      return;
    }

    for (const id of disconnectedIds) {
      this.players.delete(id);
    }
    this.paused = false;
    this.state = ROOM_STATE.LOBBY;

    for (const id of disconnectedIds) {
      this.sendToDisplay(MSG.PLAYER_LEFT, {
        playerId: id,
        playerCount: this.players.size
      });
    }

    this.broadcastLobbyUpdate();
    this.broadcast(MSG.RETURN_TO_LOBBY, { playerCount: this.players.size });
  }

  getConnectedCount() {
    let count = 0;
    for (const [, p] of this.players) {
      if (p.connected) count++;
    }
    return count;
  }

  resyncDisplay() {
    const qrMatrix = this.getQRMatrix(this.joinUrl);
    this.sendToDisplay(MSG.ROOM_CREATED, {
      roomCode: this.roomCode, qrMatrix, joinUrl: this.joinUrl
    });

    for (const [id, player] of this.players) {
      this.sendToDisplay(MSG.PLAYER_JOINED, {
        playerId: id,
        playerName: player.name,
        playerColor: player.color,
        playerCount: this.players.size
      });
    }

    if (this.state === ROOM_STATE.PLAYING || this.state === ROOM_STATE.COUNTDOWN) {
      this.sendToDisplay(MSG.GAME_START, {});
      if (this.paused) {
        this.sendToDisplay(MSG.GAME_PAUSED, {});
      }
      for (const [id, p] of this.players) {
        if (!p.connected) {
          this._sendDisconnectQR(id);
        }
      }
    }
  }

  destroy() {
    // Notify controllers before tearing down
    this.broadcastToControllers(MSG.ROOM_RESET);
    if (this._goTimeout) {
      clearTimeout(this._goTimeout);
      this._goTimeout = null;
    }
    if (this._displayGraceTimer) {
      clearTimeout(this._displayGraceTimer);
      this._displayGraceTimer = null;
    }
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.game) {
      this.game.stop();
      this.game = null;
    }
    for (const [, player] of this.players) {
      if (player.graceTimer) {
        clearTimeout(player.graceTimer);
      }
      if (player.ws) {
        try { player.ws.close(); } catch (e) { /* ignore */ }
      }
    }
    this.players.clear();
    activeRoomCodes.delete(this.roomCode);
  }
}

function send(ws, type, data) {
  if (ws && ws.readyState === 1) { // WebSocket.OPEN = 1
    ws.send(JSON.stringify({ type, ...data }));
  }
}

function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

module.exports = Room;

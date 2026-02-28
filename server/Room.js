'use strict';

const { MSG, MODE, ROOM_STATE } = require('../public/shared/protocol.js');
const QRCode = require('qrcode');
const Game = require('./Game.js');
const {
  MAX_PLAYERS,
  RECONNECT_GRACE_MS,
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

    this.players.set(playerId, {
      ws,
      name: name || `Player ${playerId}`,
      color,
      reconnectToken,
      connected: true,
      graceTimer: null
    });

    // Notify display
    this.sendToDisplay(MSG.PLAYER_JOINED, {
      playerId,
      playerName: name || `Player ${playerId}`,
      playerColor: color,
      playerCount: this.players.size
    });

    // Broadcast lobby update to all controllers
    this.broadcastToControllers(MSG.LOBBY_UPDATE, {
      playerCount: this.players.size
    });

    return { playerId, color, reconnectToken, isHost };
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;

    if (this.state === ROOM_STATE.LOBBY) {
      this.players.delete(playerId);

      if (playerId === this.hostId) {
        // Host disconnected — reset the session
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
        // Non-host left — update lobby
        this.broadcastToControllers(MSG.LOBBY_UPDATE, {
          playerCount: this.players.size
        });
        this.sendToDisplay(MSG.PLAYER_LEFT, {
          playerId,
          playerCount: this.players.size
        });
      }
    } else {
      // In game: mark disconnected, show QR on display for rejoin
      player.connected = false;
      player.ws = null;

      if (this.joinUrl) {
        const rejoinUrl = `${this.joinUrl}?rejoin=${playerId}`;
        this.getQRUrl(rejoinUrl).then((qrDataUrl) => {
          this.sendToDisplay(MSG.PLAYER_DISCONNECTED, { playerId, qrDataUrl });
        });
      } else {
        this.sendToDisplay(MSG.PLAYER_DISCONNECTED, { playerId, qrDataUrl: null });
      }
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

    return true;
  }

  reconnectByToken(ws, token) {
    for (const [id, player] of this.players) {
      if (player.reconnectToken === token) {
        player.ws = ws;
        player.connected = true;
        if (player.graceTimer) {
          clearTimeout(player.graceTimer);
          player.graceTimer = null;
        }
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
      color: player.color,
      reconnectToken,
      isHost: playerId === this.hostId
    };
  }

  async getQRUrl(joinUrl) {
    try {
      return await QRCode.toDataURL(joinUrl, { width: 256, margin: 1 });
    } catch (err) {
      console.error('QR generation failed:', err);
      return null;
    }
  }

  startGame(mode, settings) {
    if (this.state !== ROOM_STATE.LOBBY) return;

    if (this.players.size < 1) {
      this.sendToDisplay(MSG.ERROR, { message: 'Need at least 1 player' });
      return;
    }

    this._lastMode = mode;
    this._lastSettings = settings;
    this._startNewGame(mode, settings);
  }

  playAgain() {
    if (this.state !== ROOM_STATE.RESULTS) return;
    this._startNewGame(this._lastMode, this._lastSettings);
  }

  _startNewGame(mode, settings) {
    if (this.game) {
      this.game.stop();
      this.game = null;
    }

    this.state = ROOM_STATE.COUNTDOWN;
    const gameMode = mode || MODE.COMPETITIVE;
    const gameSettings = settings || {};

    this.startCountdown(() => {
      const gamePlayers = new Map();
      for (const [id, p] of this.players) {
        if (p.connected) {
          gamePlayers.set(id, { ws: p.ws });
        }
      }

      this.game = new Game(gamePlayers, gameMode, gameSettings, {
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
      this.broadcast(MSG.GAME_START, { mode: gameMode });
      this.game.start();
    });
  }

  startCountdown(onComplete) {
    let count = COUNTDOWN_SECONDS;

    this.broadcast(MSG.COUNTDOWN, { value: count });

    this.countdownTimer = setInterval(() => {
      count--;
      if (count > 0) {
        this.broadcast(MSG.COUNTDOWN, { value: count });
      } else {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        // Send final "GO" so clients know to clear overlay
        this.broadcast(MSG.COUNTDOWN, { value: 'GO' });
        setTimeout(() => onComplete(), 500);
      }
    }, 1000);
  }

  handleInput(playerId, action, seq) {
    if (this.game && this.state === ROOM_STATE.PLAYING) {
      this.game.processInput(playerId, action);
      this.sendToPlayer(playerId, MSG.INPUT_ACK, { seq });
    }
  }

  handleSoftDropStart(playerId, speed) {
    if (this.game && this.state === ROOM_STATE.PLAYING) {
      this.game.handleSoftDropStart(playerId, speed);
    }
  }

  handleSoftDropEnd(playerId) {
    if (this.game && this.state === ROOM_STATE.PLAYING) {
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

  onGameEnd(results) {
    this.state = ROOM_STATE.RESULTS;
    this.broadcast(MSG.GAME_END, results);
  }

  returnToLobby() {
    if (this.game) {
      this.game.stop();
      this.game = null;
    }
    this.state = ROOM_STATE.LOBBY;
  }

  getConnectedCount() {
    let count = 0;
    for (const [, p] of this.players) {
      if (p.connected) count++;
    }
    return count;
  }

  destroy() {
    // Notify controllers before tearing down
    this.broadcastToControllers(MSG.ROOM_RESET);
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

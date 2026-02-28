'use strict';

const { PlayerBoard } = require('./PlayerBoard.js');
const { GarbageManager } = require('./GarbageManager.js');
const { LOGIC_TICK_MS, BROADCAST_TICK_MS } = require('./constants.js');

class Game {
  constructor(players, callbacks) {
    this.callbacks = callbacks; // { onGameState, onEvent, onGameEnd }
    this.boards = new Map();
    this.playerIds = [];
    this.startTime = null;
    this.logicInterval = null;
    this.broadcastInterval = null;
    this.ended = false;
    this.paused = false;
    this.pausedAt = null;

    for (const [id] of players) {
      const board = new PlayerBoard(id);
      this.boards.set(id, board);
      this.playerIds.push(id);
    }

    this.garbageManager = new GarbageManager();
    for (const id of this.playerIds) {
      this.garbageManager.addPlayer(id);
    }
  }

  start() {
    this.startTime = Date.now();

    for (const [id, board] of this.boards) {
      board.spawnPiece();
    }

    this.logicInterval = setInterval(() => this.logicTick(), LOGIC_TICK_MS);
    this.broadcastInterval = setInterval(() => this.broadcastTick(), BROADCAST_TICK_MS);
  }

  stop() {
    if (this.logicInterval) {
      clearInterval(this.logicInterval);
      this.logicInterval = null;
    }
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }
  }

  pause() {
    if (this.paused || this.ended) return;
    this.paused = true;
    this.pausedAt = Date.now();
    this.stop();
  }

  resume() {
    if (!this.paused || this.ended) return;
    // Adjust startTime so elapsed doesn't include paused duration
    const pausedDuration = Date.now() - this.pausedAt;
    this.startTime += pausedDuration;
    this.paused = false;
    this.pausedAt = null;
    this.logicInterval = setInterval(() => this.logicTick(), LOGIC_TICK_MS);
    this.broadcastInterval = setInterval(() => this.broadcastTick(), BROADCAST_TICK_MS);
  }

  processInput(playerId, action) {
    const board = this.boards.get(playerId);
    if (!board || !board.alive || this.ended) return;

    let result = null;
    switch (action) {
      case 'left':
        board.moveLeft();
        break;
      case 'right':
        board.moveRight();
        break;
      case 'rotate_cw':
        board.rotateCW();
        break;
      case 'hard_drop':
        result = board.hardDrop();
        if (result && result.linesCleared > 0) {
          this.handleLineClear(playerId, result);
        }
        break;
      case 'hold':
        board.hold();
        break;
    }
  }

  handleSoftDropStart(playerId, speed) {
    const board = this.boards.get(playerId);
    if (!board || !board.alive || this.ended) return;
    board.softDropStart(speed);
  }

  handleSoftDropEnd(playerId) {
    const board = this.boards.get(playerId);
    if (!board || !board.alive || this.ended) return;
    board.softDropEnd();
  }

  logicTick() {
    if (this.ended) return;

    for (const [id, board] of this.boards) {
      if (!board.alive) continue;

      const result = board.tick(LOGIC_TICK_MS);

      if (result && result.linesCleared > 0) {
        this.handleLineClear(id, result);
      }

      // Apply pending garbage
      const incoming = this.garbageManager.getIncomingGarbage(id);
      if (incoming && incoming.length > 0) {
        for (const g of incoming) {
          board.addPendingGarbage(g.lines, g.gapColumn);
        }
      }

      // Check if player just died
      if (!board.alive) {
        this.callbacks.onEvent({
          type: 'player_ko',
          playerId: id
        });
      }
    }

    this.checkWinCondition();
  }

  broadcastTick() {
    if (this.ended) return;

    const playerArr = [];
    for (const [id, board] of this.boards) {
      const state = board.getState();
      state.id = id;
      playerArr.push(state);
    }

    const elapsed = Date.now() - this.startTime;

    this.callbacks.onGameState({
      players: playerArr,
      elapsed
    });
  }

  handleLineClear(playerId, clearResult) {
    const board = this.boards.get(playerId);
    const lines = clearResult.linesCleared;
    const isTSpin = clearResult.isTSpin || false;
    const combo = (clearResult.scoreResult && clearResult.scoreResult.combo) || 0;

    this.callbacks.onEvent({
      type: 'line_clear',
      playerId,
      lines,
      rows: clearResult.fullRows || [],
      isTSpin,
      combo
    });

    this.garbageManager.processLineClear(playerId, lines, isTSpin, combo);
  }

  checkWinCondition() {
    if (this.ended) return;

    const alive = this.playerIds.filter(id => this.boards.get(id).alive);

    // Multiplayer: last-man-standing
    if (this.playerIds.length >= 2 && alive.length <= 1) {
      this.ended = true;
      this.stop();
      this.callbacks.onGameEnd(this.getResults());
    }

    // Single player: end when they die
    if (this.playerIds.length === 1 && alive.length === 0) {
      this.ended = true;
      this.stop();
      this.callbacks.onGameEnd(this.getResults());
    }
  }

  getResults() {
    const results = [];

    for (const id of this.playerIds) {
      const board = this.boards.get(id);
      const state = board.scoring ? board.scoring.getState() : {};
      results.push({
        playerId: id,
        alive: board.alive,
        score: state.score || 0,
        lines: state.lines || 0,
        level: state.level || 0
      });
    }

    // Sort: alive first, then by score descending
    results.sort((a, b) => {
      if (a.alive !== b.alive) return b.alive ? 1 : -1;
      return b.score - a.score;
    });

    results.forEach((r, i) => { r.rank = i + 1; });

    return {
      elapsed: Date.now() - this.startTime,
      results
    };
  }
}

module.exports = Game;

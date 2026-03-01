'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Room = require('../server/Room');
const { ROOM_STATE, MSG } = require('../public/shared/protocol');

function mockWs() {
  const sent = [];
  return {
    readyState: 1,
    send(d) { sent.push(JSON.parse(d)); },
    close() { this.readyState = 3; },
    sent
  };
}

// Helper: set up a 2-player room in a given state
function setupRoom(state) {
  const displayWs = mockWs();
  const room = new Room('TEST', displayWs);
  room.joinUrl = 'http://localhost:4000/TEST';
  const ws1 = mockWs();
  const ws2 = mockWs();
  const r1 = room.addPlayer(ws1, 'Alice'); // host
  const r2 = room.addPlayer(ws2, 'Bob');
  if (state !== ROOM_STATE.LOBBY) {
    room.state = state;
  }
  return { room, displayWs, ws1, ws2, r1, r2 };
}

// ── PLAYING state reconnect ──────────────────────────────────

describe('Reconnect during PLAYING', () => {
  test('reconnectByToken succeeds after disconnect', () => {
    const { room, ws1, r1 } = setupRoom(ROOM_STATE.PLAYING);
    room.removePlayer(1);

    const ws3 = mockWs();
    const id = room.reconnectByToken(ws3, r1.reconnectToken);
    assert.equal(id, 1);
    const player = room.players.get(1);
    assert.equal(player.connected, true);
    assert.equal(player.ws, ws3);
  });

  test('rejoinById succeeds after disconnect', () => {
    const { room } = setupRoom(ROOM_STATE.PLAYING);
    room.removePlayer(2);

    const ws3 = mockWs();
    const result = room.rejoinById(2, ws3);
    assert.ok(result);
    assert.equal(result.playerId, 2);
    assert.equal(result.name, 'Bob');
    assert.equal(room.players.get(2).connected, true);
  });

  test('disconnect sends PLAYER_DISCONNECTED to display', () => {
    const { room, displayWs } = setupRoom(ROOM_STATE.PLAYING);
    room.joinUrl = null; // avoid async QR generation
    displayWs.sent.length = 0;

    room.removePlayer(1);

    const msg = displayWs.sent.find(m => m.type === MSG.PLAYER_DISCONNECTED);
    assert.ok(msg, 'display should get PLAYER_DISCONNECTED');
    assert.equal(msg.playerId, 1);
  });

  test('reconnect sends PLAYER_RECONNECTED to display', () => {
    const { room, displayWs, r1 } = setupRoom(ROOM_STATE.PLAYING);
    room.removePlayer(1);
    displayWs.sent.length = 0;

    room.reconnectByToken(mockWs(), r1.reconnectToken);

    const msg = displayWs.sent.find(m => m.type === MSG.PLAYER_RECONNECTED);
    assert.ok(msg);
    assert.equal(msg.playerId, 1);
  });

  test('reconnectByToken with stale WS (still marked connected)', () => {
    const { room, displayWs, ws1, r1 } = setupRoom(ROOM_STATE.PLAYING);
    // Don't call removePlayer — simulate stale WS race
    displayWs.sent.length = 0;
    const ws3 = mockWs();
    const id = room.reconnectByToken(ws3, r1.reconnectToken);
    assert.equal(id, 1);
    assert.equal(room.players.get(1).ws, ws3);
    // Old WS should be closed
    assert.equal(ws1.readyState, 3);
    // Display should NOT get PLAYER_RECONNECTED (it never saw a disconnect)
    const msg = displayWs.sent.find(m => m.type === MSG.PLAYER_RECONNECTED);
    assert.equal(msg, undefined);
  });
});

// ── RESULTS state — any disconnect returns to lobby ──────────

describe('Disconnect during RESULTS', () => {
  test('non-host disconnect returns to lobby and removes player', () => {
    const { room, displayWs, ws1 } = setupRoom(ROOM_STATE.RESULTS);
    displayWs.sent.length = 0;
    ws1.sent.length = 0;

    room.removePlayer(2);

    assert.equal(room.state, ROOM_STATE.LOBBY);
    assert.equal(room.players.has(2), false);
    assert.equal(room.players.has(1), true); // host stays
    assert.equal(room._lastResults, null);

    // Host gets lobby update
    const lobbyUpdate = ws1.sent.find(m => m.type === MSG.LOBBY_UPDATE);
    assert.ok(lobbyUpdate);

    // Display and controllers get RETURN_TO_LOBBY to leave results screen
    const returnMsg = displayWs.sent.find(m => m.type === MSG.RETURN_TO_LOBBY);
    assert.ok(returnMsg, 'display should get RETURN_TO_LOBBY');
    assert.equal(returnMsg.playerCount, 1);

    const ctrlReturn = ws1.sent.find(m => m.type === MSG.RETURN_TO_LOBBY);
    assert.ok(ctrlReturn, 'remaining controller should get RETURN_TO_LOBBY');
  });

  test('host disconnect resets room entirely', () => {
    const { room, displayWs, ws2 } = setupRoom(ROOM_STATE.RESULTS);
    displayWs.sent.length = 0;
    ws2.sent.length = 0;

    room.removePlayer(1); // host

    assert.equal(room.state, ROOM_STATE.LOBBY);
    assert.equal(room.players.size, 0);
    assert.equal(room.hostId, null);
    assert.equal(room._lastResults, null);

    const reset = displayWs.sent.find(m => m.type === MSG.ROOM_RESET);
    assert.ok(reset, 'display should get ROOM_RESET');

    const error = ws2.sent.find(m => m.type === MSG.ERROR);
    assert.ok(error);
    assert.equal(error.code, 'HOST_DISCONNECTED');
  });

  test('new players can join after results disconnect resets to lobby', () => {
    const { room } = setupRoom(ROOM_STATE.RESULTS);
    room.removePlayer(1); // host disconnects → LOBBY

    const ws3 = mockWs();
    const result = room.addPlayer(ws3, 'Charlie');
    assert.ok(result);
    assert.equal(result.playerId, 1);
    assert.equal(result.isHost, true);
  });
});

// ── rejoinById edge cases ────────────────────────────────────

describe('rejoinById edge cases', () => {
  test('rejects when player does not exist', () => {
    const { room } = setupRoom(ROOM_STATE.PLAYING);
    const result = room.rejoinById(99, mockWs());
    assert.equal(result, null);
  });

  test('rejects when player is genuinely connected (open WS)', () => {
    const { room } = setupRoom(ROOM_STATE.PLAYING);
    // Player 2 is connected with readyState=1
    const result = room.rejoinById(2, mockWs());
    assert.equal(result, null);
  });

  test('allows rejoin when WS is stale (closed)', () => {
    const { room, ws2 } = setupRoom(ROOM_STATE.PLAYING);
    // Simulate stale WS without server processing close event
    ws2.readyState = 3; // CLOSED
    const ws3 = mockWs();
    const result = room.rejoinById(2, ws3);
    assert.ok(result);
    assert.equal(result.playerId, 2);
    assert.equal(room.players.get(2).ws, ws3);
  });

  test('generates new reconnect token on rejoin', () => {
    const { room, r2 } = setupRoom(ROOM_STATE.PLAYING);
    const oldToken = r2.reconnectToken;
    room.removePlayer(2);

    const result = room.rejoinById(2, mockWs());
    assert.ok(result.reconnectToken);
    assert.notEqual(result.reconnectToken, oldToken);
  });
});

// ── Display resync ───────────────────────────────────────────

describe('Display resync', () => {
  test('resyncDisplay during RESULTS sends cached GAME_END', () => {
    const { room, displayWs } = setupRoom(ROOM_STATE.RESULTS);
    const fakeResults = { results: [{ playerId: 1, rank: 1 }] };
    room._lastResults = fakeResults;

    displayWs.sent.length = 0;
    room.resyncDisplay();

    const gameEnd = displayWs.sent.find(m => m.type === MSG.GAME_END);
    assert.ok(gameEnd, 'display should receive GAME_END on resync');
  });

  test('resyncDisplay during COUNTDOWN sends current countdown value', () => {
    const { room, displayWs } = setupRoom(ROOM_STATE.COUNTDOWN);
    room._countdownRemaining = 2;
    displayWs.sent.length = 0;

    room.resyncDisplay();

    const gameStart = displayWs.sent.find(m => m.type === MSG.GAME_START);
    assert.ok(gameStart, 'display should get GAME_START');
    const countdown = displayWs.sent.find(m => m.type === MSG.COUNTDOWN);
    assert.ok(countdown, 'display should get current COUNTDOWN value');
    assert.equal(countdown.value, 2);
  });

  test('resyncDisplay during PLAYING sends GAME_START', () => {
    const { room, displayWs } = setupRoom(ROOM_STATE.PLAYING);
    displayWs.sent.length = 0;
    room.resyncDisplay();

    const gameStart = displayWs.sent.find(m => m.type === MSG.GAME_START);
    assert.ok(gameStart);
  });

  test('resyncDisplay during PLAYING shows disconnect QR for disconnected players', () => {
    const { room, displayWs } = setupRoom(ROOM_STATE.PLAYING);
    room.joinUrl = null; // avoid async QR generation
    room.removePlayer(2);
    displayWs.sent.length = 0;

    room.resyncDisplay();

    const msg = displayWs.sent.find(m => m.type === MSG.PLAYER_DISCONNECTED);
    assert.ok(msg);
    assert.equal(msg.playerId, 2);
  });

  test('_lastResults is cleared on returnToLobby', () => {
    const { room } = setupRoom(ROOM_STATE.RESULTS);
    room._lastResults = { results: [] };
    room.returnToLobby();
    assert.equal(room._lastResults, null);
  });

  test('_lastResults is cleared on _startNewGame', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const { room } = setupRoom(ROOM_STATE.RESULTS);
    room._lastResults = { results: [] };
    room.playAgain();
    assert.equal(room._lastResults, null);

    // Cleanup timers
    if (room.countdownTimer) clearInterval(room.countdownTimer);
    if (room._goTimeout) clearTimeout(room._goTimeout);
    if (room.game) room.game.stop();
  });
});

// ── onGameEnd caching ────────────────────────────────────────

describe('onGameEnd', () => {
  test('caches results in _lastResults', () => {
    const { room } = setupRoom(ROOM_STATE.PLAYING);
    const results = { results: [{ playerId: 1, rank: 1, score: 100 }] };
    room.onGameEnd(results);

    assert.equal(room.state, ROOM_STATE.RESULTS);
    assert.equal(room._lastResults, results);
  });

  test('enriches results with player names', () => {
    const { room } = setupRoom(ROOM_STATE.PLAYING);
    const results = { results: [{ playerId: 1 }, { playerId: 2 }] };
    room.onGameEnd(results);

    assert.equal(results.results[0].playerName, 'Alice');
    assert.equal(results.results[1].playerName, 'Bob');
  });

  test('broadcasts GAME_END to display and controllers', () => {
    const { room, displayWs, ws1, ws2 } = setupRoom(ROOM_STATE.PLAYING);
    displayWs.sent.length = 0;
    ws1.sent.length = 0;
    ws2.sent.length = 0;

    room.onGameEnd({ results: [] });

    assert.ok(displayWs.sent.find(m => m.type === MSG.GAME_END));
    assert.ok(ws1.sent.find(m => m.type === MSG.GAME_END));
    assert.ok(ws2.sent.find(m => m.type === MSG.GAME_END));
  });
});

// ── Grace timer cleanup in destroy ───────────────────────────

describe('destroy', () => {
  test('clears grace timers and _lastResults', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { room } = setupRoom(ROOM_STATE.RESULTS);
    room._lastResults = { results: [] };
    room.removePlayer(2); // starts grace timer

    room.destroy();

    assert.equal(room._lastResults, null);
    assert.equal(room.players.size, 0);
  });
});

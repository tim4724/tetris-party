'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Room = require('../server/Room');
const { ROOM_STATE, MSG } = require('../public/shared/protocol');
const { MAX_PLAYERS } = require('../server/constants');

function mockWs() {
  const sent = [];
  return {
    readyState: 1,
    send(d) { sent.push(JSON.parse(d)); },
    close() { this.readyState = 3; },
    sent
  };
}

describe('Room - addPlayer()', () => {
  let room, displayWs;

  beforeEach(() => {
    displayWs = mockWs();
    room = new Room('TEST', displayWs);
  });

  test('first player gets id=1 and isHost=true', () => {
    const ws = mockWs();
    const result = room.addPlayer(ws, 'Alice');
    assert.equal(result.playerId, 1);
    assert.equal(result.isHost, true);
    assert.equal(room.hostId, 1);
  });

  test('second player gets id=2 and isHost=false', () => {
    room.addPlayer(mockWs(), 'Alice');
    const ws = mockWs();
    const result = room.addPlayer(ws, 'Bob');
    assert.equal(result.playerId, 2);
    assert.equal(result.isHost, false);
  });

  test('reuses smallest available ID after removal', () => {
    const ws1 = mockWs();
    const ws2 = mockWs();
    room.addPlayer(ws1, 'Alice'); // id=1
    room.addPlayer(ws2, 'Bob');   // id=2

    // Remove player 1 (host) — clears all players
    room.removePlayer(1);

    // Add two new players — should get id=1 and id=2
    const ws3 = mockWs();
    const ws4 = mockWs();
    const r3 = room.addPlayer(ws3, 'Charlie');
    const r4 = room.addPlayer(ws4, 'Diana');
    assert.equal(r3.playerId, 1);
    assert.equal(r4.playerId, 2);
  });

  test('reuses gap when non-host leaves', () => {
    // Need to avoid host disconnect (which clears all players)
    // Add 3 players, remove player 2, add new → should get id=2
    const ws1 = mockWs();
    const ws2 = mockWs();
    const ws3 = mockWs();
    room.addPlayer(ws1, 'Alice');   // id=1, host
    room.addPlayer(ws2, 'Bob');     // id=2
    room.addPlayer(ws3, 'Charlie'); // id=3

    room.removePlayer(2); // non-host removal

    const ws4 = mockWs();
    const r4 = room.addPlayer(ws4, 'Diana');
    assert.equal(r4.playerId, 2);
  });

  test('returns null when room is full', () => {
    for (let i = 0; i < MAX_PLAYERS; i++) {
      room.addPlayer(mockWs(), 'P' + (i + 1));
    }
    const ws = mockWs();
    const result = room.addPlayer(ws, 'Extra');
    assert.equal(result, null);
    // Should have sent an error to the ws
    assert.equal(ws.sent.length, 1);
    assert.equal(ws.sent[0].type, MSG.ERROR);
  });

  test('returns null when game in progress', () => {
    room.addPlayer(mockWs(), 'Alice');
    room.state = ROOM_STATE.PLAYING;
    const ws = mockWs();
    const result = room.addPlayer(ws, 'Bob');
    assert.equal(result, null);
    assert.equal(ws.sent[0].type, MSG.ERROR);
  });

  test('assigns reconnectToken to each player', () => {
    const ws = mockWs();
    const result = room.addPlayer(ws, 'Alice');
    assert.ok(result.reconnectToken);
    assert.equal(typeof result.reconnectToken, 'string');
    assert.equal(result.reconnectToken.length, 32);
  });
});

describe('Room - removePlayer()', () => {
  let room, displayWs;

  beforeEach(() => {
    displayWs = mockWs();
    room = new Room('TEST', displayWs);
  });

  test('non-host removal in lobby broadcasts LOBBY_UPDATE and PLAYER_LEFT', () => {
    const ws1 = mockWs();
    const ws2 = mockWs();
    room.addPlayer(ws1, 'Alice'); // host
    room.addPlayer(ws2, 'Bob');

    // Clear sent arrays to track new messages
    displayWs.sent.length = 0;
    ws1.sent.length = 0;

    room.removePlayer(2);

    assert.equal(room.players.size, 1);
    // Display should get PLAYER_LEFT
    const playerLeft = displayWs.sent.find(m => m.type === MSG.PLAYER_LEFT);
    assert.ok(playerLeft);
    assert.equal(playerLeft.playerId, 2);
    assert.equal(playerLeft.playerCount, 1);
    // Host controller should get LOBBY_UPDATE
    const lobbyUpdate = ws1.sent.find(m => m.type === MSG.LOBBY_UPDATE);
    assert.ok(lobbyUpdate);
    assert.equal(lobbyUpdate.playerCount, 1);
  });

  test('host removal in lobby kicks all and sends ROOM_RESET', () => {
    const ws1 = mockWs();
    const ws2 = mockWs();
    room.addPlayer(ws1, 'Alice');
    room.addPlayer(ws2, 'Bob');

    displayWs.sent.length = 0;
    ws2.sent.length = 0;

    room.removePlayer(1);

    assert.equal(room.players.size, 0);
    assert.equal(room.hostId, null);
    // Display gets ROOM_RESET
    const reset = displayWs.sent.find(m => m.type === MSG.ROOM_RESET);
    assert.ok(reset);
    // Non-host gets HOST_DISCONNECTED error
    const error = ws2.sent.find(m => m.type === MSG.ERROR);
    assert.ok(error);
    assert.equal(error.code, 'HOST_DISCONNECTED');
  });

  test('in-game removal marks player disconnected and sends PLAYER_DISCONNECTED to display', () => {
    const ws1 = mockWs();
    room.addPlayer(ws1, 'Alice');
    room.state = ROOM_STATE.PLAYING;

    room.removePlayer(1);

    const player = room.players.get(1);
    assert.equal(player.connected, false);
    assert.equal(player.ws, null);
    // No grace timer — slot stays reserved, QR is shown on display
    assert.equal(player.graceTimer, null);
  });
});

describe('Room - reconnectByToken()', () => {
  let room, displayWs;

  beforeEach(() => {
    displayWs = mockWs();
    room = new Room('TEST', displayWs);
  });

  test('valid token returns playerId and reconnects', () => {
    const ws1 = mockWs();
    const result = room.addPlayer(ws1, 'Alice');
    const token = result.reconnectToken;

    // Simulate disconnect
    room.state = ROOM_STATE.PLAYING;
    room.removePlayer(1);

    const ws2 = mockWs();
    const reconnectedId = room.reconnectByToken(ws2, token);
    assert.equal(reconnectedId, 1);

    const player = room.players.get(1);
    assert.equal(player.connected, true);
    assert.equal(player.ws, ws2);
    assert.equal(player.graceTimer, null);
  });

  test('invalid token returns null', () => {
    room.addPlayer(mockWs(), 'Alice');
    room.state = ROOM_STATE.PLAYING;
    room.removePlayer(1);

    const ws2 = mockWs();
    const result = room.reconnectByToken(ws2, 'bad-token');
    assert.equal(result, null);
  });

  test('reconnect sends PLAYER_RECONNECTED to display', () => {
    const ws1 = mockWs();
    const result = room.addPlayer(ws1, 'Alice');
    room.state = ROOM_STATE.PLAYING;
    room.removePlayer(1);

    const ws2 = mockWs();
    room.rejoinById(1, ws2);

    const reconnectMsg = displayWs.sent.find(m => m.type === MSG.PLAYER_RECONNECTED);
    assert.ok(reconnectMsg, 'display should receive PLAYER_RECONNECTED');
    assert.equal(reconnectMsg.playerId, 1);
  });
});

describe('Room - startGame()', () => {
  let room, displayWs;

  beforeEach(() => {
    displayWs = mockWs();
    room = new Room('TEST', displayWs);
  });

  test('does nothing if not in LOBBY state', () => {
    room.addPlayer(mockWs(), 'Alice');
    room.state = ROOM_STATE.PLAYING;
    const prevState = room.state;
    room.startGame();
    // State should not change
    assert.equal(room.state, prevState);
  });

  test('sends error if no players', () => {
    displayWs.sent.length = 0;
    room.startGame();
    const error = displayWs.sent.find(m => m.type === MSG.ERROR);
    assert.ok(error);
    assert.ok(error.message.includes('at least 1 player'));
  });

  test('starts countdown with players present', () => {
    room.addPlayer(mockWs(), 'Alice');
    displayWs.sent.length = 0;
    room.startGame();
    assert.equal(room.state, ROOM_STATE.COUNTDOWN);

    // Cleanup
    if (room.countdownTimer) clearInterval(room.countdownTimer);
    if (room.game) room.game.stop();
  });
});

describe('Room - getNextPlayerId()', () => {
  let room;

  beforeEach(() => {
    room = new Room('TEST', mockWs());
  });

  test('returns 1 for empty room', () => {
    assert.equal(room.getNextPlayerId(), 1);
  });

  test('returns next sequential ID', () => {
    room.addPlayer(mockWs(), 'Alice');
    assert.equal(room.getNextPlayerId(), 2);
  });

  test('fills gaps', () => {
    room.addPlayer(mockWs(), 'Alice');   // id=1
    room.addPlayer(mockWs(), 'Bob');     // id=2
    room.addPlayer(mockWs(), 'Charlie'); // id=3
    room.removePlayer(2);               // remove Bob
    assert.equal(room.getNextPlayerId(), 2);
  });

  test('returns null when full', () => {
    for (let i = 0; i < MAX_PLAYERS; i++) {
      room.addPlayer(mockWs(), 'P' + (i + 1));
    }
    assert.equal(room.getNextPlayerId(), null);
  });
});

'use strict';

// Message types for WebSocket communication
const MSG = {
  // Controller → Server
  JOIN: 'join',
  REJOIN: 'rejoin',
  INPUT: 'input',
  SOFT_DROP_START: 'soft_drop_start',
  SOFT_DROP_END: 'soft_drop_end',
  HEARTBEAT: 'heartbeat',

  // Server → Controller
  JOINED: 'joined',
  INPUT_ACK: 'input_ack',
  LOBBY_UPDATE: 'lobby_update',
  GAME_START: 'game_start',
  COUNTDOWN: 'countdown',
  PLAYER_STATE: 'player_state',
  GAME_OVER: 'game_over',
  GAME_END: 'game_end',
  ERROR: 'error',

  // Display / Controller (host) → Server
  CREATE_ROOM: 'create_room',
  START_GAME: 'start_game',
  RETURN_TO_LOBBY: 'return_to_lobby',
  PLAY_AGAIN: 'play_again',
  PAUSE_GAME: 'pause_game',
  RESUME_GAME: 'resume_game',

  // Server → Display
  ROOM_CREATED: 'room_created',
  ROOM_RESET: 'room_reset',
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  GAME_STATE: 'game_state',
  LINE_CLEAR: 'line_clear',
  GARBAGE_SENT: 'garbage_sent',
  PLAYER_KO: 'player_ko',
  PLAYER_DISCONNECTED: 'player_disconnected',
  PLAYER_RECONNECTED: 'player_reconnected',
  GAME_PAUSED: 'game_paused',
  GAME_RESUMED: 'game_resumed'
};

// Input action types
const INPUT = {
  LEFT: 'left',
  RIGHT: 'right',
  ROTATE_CW: 'rotate_cw',
  HARD_DROP: 'hard_drop',
  HOLD: 'hold'
};

// Room states
const ROOM_STATE = {
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  RESULTS: 'results'
};

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MSG, INPUT, ROOM_STATE };
}

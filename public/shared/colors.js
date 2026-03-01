'use strict';

// colors.js — re-exports from theme.js for backward compatibility

// In Node.js (server, tests): require from theme.js
// In browser: globals are already set by theme.js <script> loaded first
if (typeof module !== 'undefined' && module.exports) {
  const {
    PIECE_COLORS, GHOST_COLORS, PLAYER_COLORS, PLAYER_NAMES
  } = require('./theme.js');

  // Legacy board appearance tokens (kept for any existing consumers)
  const GRID_LINE_COLOR = '#1a1a2e';
  const BOARD_BG_COLOR = '#0f0f23';
  const BORDER_COLOR = '#333366';

  module.exports = {
    PIECE_COLORS, GHOST_COLORS, PLAYER_COLORS, PLAYER_NAMES,
    GRID_LINE_COLOR, BOARD_BG_COLOR, BORDER_COLOR
  };
}

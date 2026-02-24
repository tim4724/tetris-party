'use strict';

const BUFFER_ROWS = 4;
const VISIBLE_ROWS = 20;
const COLS = 10;

class BoardRenderer {
  constructor(ctx, x, y, cellSize, playerIndex) {
    this.ctx = ctx;
    this.x = x;
    this.y = y;
    this.cellSize = cellSize;
    this.playerIndex = playerIndex;
    this.accentColor = PLAYER_COLORS[playerIndex] || PLAYER_COLORS[0];
    this.boardWidth = COLS * cellSize;
    this.boardHeight = VISIBLE_ROWS * cellSize;
  }

  render(playerState) {
    const ctx = this.ctx;

    // 1. Board background
    ctx.fillStyle = BOARD_BG_COLOR;
    ctx.fillRect(this.x, this.y, this.boardWidth, this.boardHeight);

    // 2. Grid lines
    ctx.strokeStyle = GRID_LINE_COLOR;
    ctx.lineWidth = 0.5;
    for (let r = 0; r <= VISIBLE_ROWS; r++) {
      const py = this.y + r * this.cellSize;
      ctx.beginPath();
      ctx.moveTo(this.x, py);
      ctx.lineTo(this.x + this.boardWidth, py);
      ctx.stroke();
    }
    for (let c = 0; c <= COLS; c++) {
      const px = this.x + c * this.cellSize;
      ctx.beginPath();
      ctx.moveTo(px, this.y);
      ctx.lineTo(px, this.y + this.boardHeight);
      ctx.stroke();
    }

    // 3. Placed blocks from grid
    if (playerState.grid) {
      for (let r = 0; r < playerState.grid.length; r++) {
        for (let c = 0; c < playerState.grid[r].length; c++) {
          const cellVal = playerState.grid[r][c];
          if (cellVal > 0) {
            this.drawBlock(c, r, PIECE_COLORS[cellVal]);
          }
        }
      }
    }

    // 4. Ghost piece
    if (playerState.currentPiece && playerState.ghostY != null && playerState.alive !== false) {
      const piece = playerState.currentPiece;
      const ghostDisplayY = playerState.ghostY;
      const ghostColor = GHOST_COLORS[piece.typeId] || 'rgba(255,255,255,0.15)';
      if (piece.blocks) {
        for (const [bx, by] of piece.blocks) {
          const drawRow = ghostDisplayY + by;
          const drawCol = piece.x + bx;
          if (drawRow >= 0 && drawRow < VISIBLE_ROWS && drawCol >= 0 && drawCol < COLS) {
            this.drawGhostBlock(drawCol, drawRow, ghostColor);
          }
        }
      }
    }

    // 5. Current piece
    if (playerState.currentPiece && playerState.alive !== false) {
      const piece = playerState.currentPiece;
      const pieceDisplayY = piece.y;
      const color = PIECE_COLORS[piece.typeId] || '#ffffff';
      if (piece.blocks) {
        for (const [bx, by] of piece.blocks) {
          const drawRow = pieceDisplayY + by;
          const drawCol = piece.x + bx;
          if (drawRow >= 0 && drawRow < VISIBLE_ROWS && drawCol >= 0 && drawCol < COLS) {
            this.drawBlock(drawCol, drawRow, color);
          }
        }
      }
    }

    // 6. Clearing rows pulsing glow effect
    if (playerState.clearingRows && playerState.clearingRows.length > 0) {
      const t = performance.now() / 80;
      for (const row of playerState.clearingRows) {
        if (row >= 0 && row < VISIBLE_ROWS) {
          // Pulsing white glow
          const alpha = 0.35 + 0.25 * Math.sin(t * Math.PI);
          ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
          ctx.fillRect(this.x, this.y + row * this.cellSize, this.boardWidth, this.cellSize);
        }
      }
    }

    // 7. Board border with player accent color
    ctx.strokeStyle = this.accentColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(this.x - 1, this.y - 1, this.boardWidth + 2, this.boardHeight + 2);
  }

  drawBlock(col, row, color) {
    const ctx = this.ctx;
    const x = this.x + col * this.cellSize;
    const y = this.y + row * this.cellSize;
    const size = this.cellSize;
    const inset = 1;

    // Main block fill
    ctx.fillStyle = color;
    ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);

    // Highlight (top-left bevel)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fillRect(x + inset, y + inset, size - inset * 2, 2);
    ctx.fillRect(x + inset, y + inset, 2, size - inset * 2);

    // Shadow (bottom-right bevel)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(x + inset, y + size - inset - 2, size - inset * 2, 2);
    ctx.fillRect(x + size - inset - 2, y + inset, 2, size - inset * 2);
  }

  drawGhostBlock(col, row, color) {
    const ctx = this.ctx;
    const x = this.x + col * this.cellSize;
    const y = this.y + row * this.cellSize;
    const size = this.cellSize;

    // Translucent fill
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, size - 2, size - 2);

    // Border outline
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);
  }
}

window.BoardRenderer = BoardRenderer;

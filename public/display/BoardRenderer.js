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
    this._bgGradient = null;
    this._blockGradients = new Map(); // cached per color string
  }

  render(playerState) {
    const ctx = this.ctx;

    // 1. Board background — player-color tinted (matches controller touch pad)
    const rgb = this._hexToRgb(this.accentColor);
    // Base dark background
    ctx.fillStyle = THEME.color.bg.board;
    ctx.fillRect(this.x, this.y, this.boardWidth, this.boardHeight);
    // Player color tint
    if (rgb) {
      ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${THEME.opacity.tint})`;
      ctx.fillRect(this.x, this.y, this.boardWidth, this.boardHeight);
    }

    // 2. Grid lines
    ctx.strokeStyle = rgb
      ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${THEME.opacity.muted})`
      : `rgba(255, 255, 255, ${THEME.opacity.subtle})`;
    ctx.lineWidth = THEME.stroke.grid;
    for (let r = 1; r < VISIBLE_ROWS; r++) {
      const py = this.y + r * this.cellSize;
      ctx.beginPath();
      ctx.moveTo(this.x, py);
      ctx.lineTo(this.x + this.boardWidth, py);
      ctx.stroke();
    }
    for (let c = 1; c < COLS; c++) {
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
            this.drawBlock(c, r, PIECE_COLORS[cellVal], cellVal === 8);
          }
        }
      }
    }

    // 4. Ghost piece
    if (playerState.currentPiece && playerState.ghostY != null && playerState.alive !== false) {
      const piece = playerState.currentPiece;
      const ghostDisplayY = playerState.ghostY;
      const ghostColor = GHOST_COLORS[piece.typeId] || 'rgba(255,255,255,0.12)';
      if (piece.blocks) {
        for (const [bx, by] of piece.blocks) {
          const drawRow = ghostDisplayY + by;
          const drawCol = piece.x + bx;
          if (drawRow >= 0 && drawRow < VISIBLE_ROWS && drawCol >= 0 && drawCol < COLS) {
            this.drawGhostBlock(drawCol, drawRow, ghostColor, piece.typeId);
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
            this.drawBlock(drawCol, drawRow, color, false);
          }
        }
      }
    }

    // 6. Clearing rows pulsing glow effect
    if (playerState.clearingRows && playerState.clearingRows.length > 0) {
      const t = performance.now() / 150;
      for (const row of playerState.clearingRows) {
        if (row >= 0 && row < VISIBLE_ROWS) {
          const alpha = 0.3 + 0.2 * Math.sin(t * Math.PI);
          // White core
          ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
          ctx.fillRect(this.x, this.y + row * this.cellSize, this.boardWidth, this.cellSize);
          // Player accent tint
          const rgb = this._hexToRgb(this.accentColor);
          if (rgb) {
            ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha * 0.3})`;
            ctx.fillRect(this.x, this.y + row * this.cellSize, this.boardWidth, this.cellSize);
          }
        }
      }
    }

    // 7. Board border — ambient glow + clean stroke
    this._drawBoardBorder();
  }

  _drawBoardBorder() {
    const ctx = this.ctx;
    const rgb = this._hexToRgb(this.accentColor);
    // Subtle player-color border (matches controller touch pad)
    ctx.strokeStyle = rgb
      ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${THEME.opacity.soft})`
      : `rgba(255, 255, 255, ${THEME.opacity.tint})`;
    ctx.lineWidth = THEME.stroke.border;
    ctx.strokeRect(this.x - 0.5, this.y - 0.5, this.boardWidth + 1, this.boardHeight + 1);
  }

  drawBlock(col, row, color, isGarbage) {
    const ctx = this.ctx;
    const x = this.x + col * this.cellSize;
    const y = this.y + row * this.cellSize;
    const size = this.cellSize;
    const inset = THEME.size.boardInset;
    const r = THEME.radius.block(size);

    if (isGarbage) {
      // Garbage blocks — flat muted style
      ctx.fillStyle = THEME.color.garbage;
      this._roundRect(x + inset, y + inset, size - inset * 2, size - inset * 2, r);
      ctx.fill();
      // Subtle noise texture
      ctx.fillStyle = `rgba(255, 255, 255, ${THEME.opacity.faint})`;
      ctx.fillRect(x + inset + 1, y + inset + 1, size - inset * 2 - 2, 1);
      return;
    }

    // Main block fill with subtle gradient (cached per color)
    let grad = this._blockGradients.get(color);
    if (!grad) {
      grad = ctx.createLinearGradient(0, 0, 0, size);
      grad.addColorStop(0, this._lighten(color, 15));
      grad.addColorStop(1, this._darken(color, 10));
      this._blockGradients.set(color, grad);
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = grad;
    this._roundRect(inset, inset, size - inset * 2, size - inset * 2, r);
    ctx.fill();

    // Top highlight
    ctx.fillStyle = `rgba(255, 255, 255, ${THEME.opacity.highlight})`;
    ctx.fillRect(inset + r, inset, size - inset * 2 - r * 2, Math.max(1.5, size * 0.08));

    // Left highlight
    ctx.fillStyle = `rgba(255, 255, 255, ${THEME.opacity.muted})`;
    ctx.fillRect(inset, inset + r, Math.max(1.5, size * 0.07), size - inset * 2 - r * 2);

    // Bottom shadow
    ctx.fillStyle = `rgba(0, 0, 0, ${THEME.opacity.shadow})`;
    ctx.fillRect(inset + r, size - inset - Math.max(1.5, size * 0.08), size - inset * 2 - r * 2, Math.max(1.5, size * 0.08));

    // Inner shine spot
    ctx.fillStyle = `rgba(255, 255, 255, ${THEME.opacity.subtle})`;
    const shineSize = size * 0.25;
    ctx.fillRect(size * 0.25, size * 0.2, shineSize, shineSize * 0.5);

    ctx.restore();
  }

  drawGhostBlock(col, row, color, typeId) {
    const ctx = this.ctx;
    const x = this.x + col * this.cellSize;
    const y = this.y + row * this.cellSize;
    const size = this.cellSize;
    const inset = 1.5;

    // Dotted outline style ghost
    ctx.strokeStyle = color;
    ctx.lineWidth = THEME.stroke.ghost;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
    ctx.setLineDash([]);

    // Very faint fill
    ctx.fillStyle = color.replace(/[\d.]+\)$/, '0.08)');
    ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
  }

  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  _hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  _lighten(hex, percent) {
    const rgb = this._hexToRgb(hex);
    if (!rgb) return hex;
    const factor = 1 + percent / 100;
    const r = Math.min(255, Math.round(rgb.r * factor));
    const g = Math.min(255, Math.round(rgb.g * factor));
    const b = Math.min(255, Math.round(rgb.b * factor));
    return `rgb(${r}, ${g}, ${b})`;
  }

  _darken(hex, percent) {
    const rgb = this._hexToRgb(hex);
    if (!rgb) return hex;
    const factor = 1 - percent / 100;
    const r = Math.round(rgb.r * factor);
    const g = Math.round(rgb.g * factor);
    const b = Math.round(rgb.b * factor);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

window.BoardRenderer = BoardRenderer;

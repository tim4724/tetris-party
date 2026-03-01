'use strict';

// Falling ghost-tetromino background animation for the welcome screen.
// Renders translucent tetromino silhouettes on a canvas behind the DOM overlay.

class WelcomeBackground {
  // Standard tetromino shapes (each rotation is a list of [row, col] filled cells)
  static SHAPES = {
    I: [[0,0],[0,1],[0,2],[0,3]],
    O: [[0,0],[0,1],[1,0],[1,1]],
    T: [[0,0],[0,1],[0,2],[1,1]],
    S: [[0,1],[0,2],[1,0],[1,1]],
    Z: [[0,0],[0,1],[1,1],[1,2]],
    J: [[0,0],[1,0],[1,1],[1,2]],
    L: [[0,2],[1,0],[1,1],[1,2]],
  };

  static PIECE_KEYS = Object.keys(WelcomeBackground.SHAPES);

  constructor(canvas, poolSize = 15) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.poolSize = poolSize;
    this.pool = [];
    this.w = 0;
    this.h = 0;
    this.rafId = null;
    this.lastTime = null;
    this._initPool();
  }

  // --- Public API ---

  resize(w, h) {
    const dpr = window.devicePixelRatio || 1;
    this.w = w;
    this.h = h;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Scale pool positions proportionally to new dimensions
    const oldW = this._prevW || w;
    const oldH = this._prevH || h;
    for (const p of this.pool) {
      p.x = (p.x / oldW) * w;
      p.y = (p.y / oldH) * h;
    }
    this._prevW = w;
    this._prevH = h;
  }

  start() {
    if (this.rafId) return;
    this.lastTime = null;
    this.rafId = requestAnimationFrame(this._loop);
  }

  stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastTime = null;
  }

  // --- Internals ---

  _initPool() {
    for (let i = 0; i < this.poolSize; i++) {
      this.pool.push(this._makeShape(true));
    }
  }

  _makeShape(randomY) {
    const key = WelcomeBackground.PIECE_KEYS[Math.floor(Math.random() * WelcomeBackground.PIECE_KEYS.length)];
    const blocks = WelcomeBackground.SHAPES[key];
    const rotation = Math.floor(Math.random() * 4);
    const rotated = this._rotate(blocks, rotation);
    const blockSize = 16 + Math.random() * 32; // 16-48px
    // Larger shapes fall slower for parallax depth feel
    const speed = 15 + (48 - blockSize) / 32 * 25; // 15-40 px/s
    const drift = 0;
    const opacity = 0.05 + Math.random() * 0.04; // 0.05-0.09

    // Pick a color from PIECE_COLORS (indices 1-7)
    const colorIdx = 1 + Math.floor(Math.random() * 7);
    const color = typeof PIECE_COLORS !== 'undefined' ? PIECE_COLORS[colorIdx] : '#4444ff';

    return {
      blocks: rotated,
      blockSize,
      speed,
      drift,
      opacity,
      color,
      x: Math.random() * (this.w || window.innerWidth),
      y: randomY
        ? -Math.random() * (this.h || window.innerHeight) * 1.5 - blockSize * 4
        : -blockSize * 4 - Math.random() * 100,
    };
  }

  _rotate(blocks, times) {
    let b = blocks;
    for (let t = 0; t < times; t++) {
      b = b.map(([r, c]) => [c, -r]);
    }
    // Normalize so min row/col = 0
    const minR = Math.min(...b.map(([r]) => r));
    const minC = Math.min(...b.map(([, c]) => c));
    return b.map(([r, c]) => [r - minR, c - minC]);
  }

  _loop = (timestamp) => {
    this.rafId = requestAnimationFrame(this._loop);

    if (this.lastTime === null) { this.lastTime = timestamp; return; }
    const dt = (timestamp - this.lastTime) / 1000;
    this.lastTime = timestamp;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    const maxY = this.h + 200;

    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      p.y += p.speed * dt;
      p.x += p.drift * dt;

      // Recycle off-screen shapes
      if (p.y > maxY) {
        this.pool[i] = this._makeShape(false);
        continue;
      }

      // Draw blocks as rounded rects
      ctx.fillStyle = this._rgba(p.color, p.opacity);
      const r = Math.min(3, p.blockSize * 0.12);
      for (const [row, col] of p.blocks) {
        const bx = p.x + col * p.blockSize;
        const by = p.y + row * p.blockSize;
        ctx.beginPath();
        ctx.roundRect(bx, by, p.blockSize - 1, p.blockSize - 1, r);
        ctx.fill();
      }
    }
  };

  _rgba(hex, alpha) {
    // Convert #RRGGBB to rgba
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
}

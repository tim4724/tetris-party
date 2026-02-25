'use strict';

class TouchInput {
  constructor(touchElement, onInput) {
    this.el = touchElement;
    this.onInput = onInput;

    // Config constants
    this.RATCHET_THRESHOLD = 44;
    this.TAP_MAX_DISTANCE = 15;
    this.TAP_MAX_DURATION = 300;
    this.FLICK_VELOCITY_THRESHOLD = 0.8;
    this.SOFT_DROP_DEAD_ZONE = 20;
    this.SOFT_DROP_MIN_SPEED = 3;
    this.SOFT_DROP_MAX_SPEED = 10;
    this.SOFT_DROP_MAX_DIST = 200;

    // Touch tracking state
    this.activeId = null;
    this.anchorX = 0;
    this.anchorY = 0;
    this.startX = 0;
    this.startY = 0;
    this.startTime = 0;
    this.lastX = 0;
    this.lastY = 0;
    this.lastTime = 0;
    this.isDragging = false;
    this.isSoftDropping = false;
    this.dominantAxis = null;

    // Ring buffer for velocity calculation (last 4 positions)
    this.posBuffer = [];
    this.POS_BUFFER_SIZE = 4;

    // Bind event handlers
    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);
    this._onTouchCancel = this._onTouchCancel.bind(this);

    this.el.addEventListener('touchstart', this._onTouchStart, { passive: false });
    this.el.addEventListener('touchmove', this._onTouchMove, { passive: false });
    this.el.addEventListener('touchend', this._onTouchEnd, { passive: false });
    this.el.addEventListener('touchcancel', this._onTouchCancel, { passive: false });
  }

  _resetState() {
    this.activeId = null;
    this.anchorX = 0;
    this.anchorY = 0;
    this.startX = 0;
    this.startY = 0;
    this.startTime = 0;
    this.lastX = 0;
    this.lastY = 0;
    this.lastTime = 0;
    this.isDragging = false;
    this.isSoftDropping = false;
    this.dominantAxis = null;
    this.posBuffer = [];
  }

  _pushPos(x, y, t) {
    this.posBuffer.push({ x, y, t });
    if (this.posBuffer.length > this.POS_BUFFER_SIZE) {
      this.posBuffer.shift();
    }
  }

  _getVelocity() {
    if (this.posBuffer.length < 2) return { vx: 0, vy: 0 };
    const last = this.posBuffer[this.posBuffer.length - 1];
    const prev = this.posBuffer[this.posBuffer.length - 2];
    const dt = last.t - prev.t;
    if (dt <= 0) return { vx: 0, vy: 0 };
    return {
      vx: (last.x - prev.x) / dt,
      vy: (last.y - prev.y) / dt
    };
  }

  _haptic(pattern) {
    if (!navigator.vibrate) return;
    navigator.vibrate(pattern);
  }

  _calcSoftDropSpeed(distY) {
    const range = this.SOFT_DROP_MAX_DIST - this.SOFT_DROP_DEAD_ZONE;
    const t = Math.min(Math.max((distY - this.SOFT_DROP_DEAD_ZONE) / range, 0), 1);
    return Math.round(this.SOFT_DROP_MIN_SPEED + t * (this.SOFT_DROP_MAX_SPEED - this.SOFT_DROP_MIN_SPEED));
  }

  _onTouchStart(e) {
    e.preventDefault();

    // Only track first touch
    if (this.activeId !== null) return;

    const touch = e.changedTouches[0];
    this.activeId = touch.identifier;

    const x = touch.clientX;
    const y = touch.clientY;
    const now = e.timeStamp;

    this.anchorX = x;
    this.anchorY = y;
    this.startX = x;
    this.startY = y;
    this.startTime = now;
    this.lastX = x;
    this.lastY = y;
    this.lastTime = now;
    this.isDragging = false;
    this.isSoftDropping = false;
    this.dominantAxis = null;
    this.posBuffer = [];
    this._pushPos(x, y, now);
  }

  _onTouchMove(e) {
    e.preventDefault();

    const touch = this._findActiveTouch(e.changedTouches);
    if (!touch) return;

    const x = touch.clientX;
    const y = touch.clientY;
    const now = e.timeStamp;

    this._pushPos(x, y, now);

    const dxFromStart = x - this.startX;
    const dyFromStart = y - this.startY;
    const absDxFromStart = Math.abs(dxFromStart);
    const absDyFromStart = Math.abs(dyFromStart);

    // Detect dragging
    if (!this.isDragging) {
      if (absDxFromStart > this.TAP_MAX_DISTANCE || absDyFromStart > this.TAP_MAX_DISTANCE) {
        this.isDragging = true;
      }
    }

    // Lock dominant axis once we have enough movement
    if (this.isDragging && this.dominantAxis === null) {
      if (absDxFromStart > absDyFromStart) {
        this.dominantAxis = 'horizontal';
      } else {
        this.dominantAxis = 'vertical';
      }
    }

    if (this.dominantAxis === 'horizontal') {
      // Ratchet-based horizontal movement
      const dxFromAnchor = x - this.anchorX;
      const steps = Math.trunc(dxFromAnchor / this.RATCHET_THRESHOLD);
      if (steps !== 0) {
        const action = steps > 0 ? INPUT.RIGHT : INPUT.LEFT;
        const count = Math.abs(steps);
        for (let i = 0; i < count; i++) {
          this.onInput(action);
        }
        this._haptic(10);
        this.anchorX += steps * this.RATCHET_THRESHOLD;
      }
    } else if (this.dominantAxis === 'vertical') {
      // Soft drop handling (downward movement)
      const distDown = y - this.startY;

      if (distDown > this.SOFT_DROP_DEAD_ZONE) {
        const speed = this._calcSoftDropSpeed(distDown);
        if (!this.isSoftDropping) {
          this.isSoftDropping = true;
          this._haptic(15);
          this.onInput('soft_drop_start', { speed });
        } else {
          // Update speed as finger moves further
          this.onInput('soft_drop_start', { speed });
        }
      } else if (this.isSoftDropping && distDown <= this.SOFT_DROP_DEAD_ZONE) {
        this.isSoftDropping = false;
        this.onInput('soft_drop_end');
      }
    }

    this.lastX = x;
    this.lastY = y;
    this.lastTime = now;
  }

  _onTouchEnd(e) {
    e.preventDefault();

    const touch = this._findActiveTouch(e.changedTouches);
    if (!touch) return;

    const x = touch.clientX;
    const y = touch.clientY;
    const now = e.timeStamp;
    this._pushPos(x, y, now);

    // End soft drop if active
    if (this.isSoftDropping) {
      this.isSoftDropping = false;
      this.onInput('soft_drop_end');
    }

    const duration = now - this.startTime;
    const totalDx = x - this.startX;
    const totalDy = y - this.startY;
    const totalDist = Math.sqrt(totalDx * totalDx + totalDy * totalDy);

    // Calculate velocity from ring buffer
    const { vx, vy } = this._getVelocity();
    const absVx = Math.abs(vx);
    const absVy = Math.abs(vy);

    // 1. Tap detection: minimal movement and short duration
    if (totalDist < this.TAP_MAX_DISTANCE && duration < this.TAP_MAX_DURATION) {
      this.onInput(INPUT.ROTATE_CW);
      this._haptic(10);
      this._resetState();
      return;
    }

    // 2. Flick detection: check velocity regardless of axis lock
    //    (quick flicks may not generate enough moves to lock axis)
    const isVerticalFlick = absVy > this.FLICK_VELOCITY_THRESHOLD && absVy > absVx;
    const isVerticalMotion = this.dominantAxis === 'vertical' ||
      (this.dominantAxis === null && Math.abs(totalDy) > Math.abs(totalDx));

    if (isVerticalFlick || isVerticalMotion) {
      if (vy > this.FLICK_VELOCITY_THRESHOLD || (isVerticalMotion && vy > this.FLICK_VELOCITY_THRESHOLD * 0.6)) {
        // Flick down -> hard drop
        this.onInput(INPUT.HARD_DROP);
        this._haptic([5, 5, 5]);
        this._resetState();
        return;
      }
      if (vy < -this.FLICK_VELOCITY_THRESHOLD || (isVerticalMotion && vy < -this.FLICK_VELOCITY_THRESHOLD * 0.6)) {
        // Flick up -> hold
        this.onInput(INPUT.HOLD);
        this._haptic(15);
        this._resetState();
        return;
      }
    }

    // 3. Short upward swipe fallback: if total motion was clearly upward
    //    and fast enough, treat as hold even without high instantaneous velocity
    if (totalDy < -30 && duration < 400 && Math.abs(totalDy) > Math.abs(totalDx) * 1.5) {
      this.onInput(INPUT.HOLD);
      this._haptic(15);
      this._resetState();
      return;
    }

    // 4. Short downward swipe fallback: hard drop
    if (totalDy > 50 && duration < 300 && Math.abs(totalDy) > Math.abs(totalDx) * 1.5) {
      this.onInput(INPUT.HARD_DROP);
      this._haptic([5, 5, 5]);
      this._resetState();
      return;
    }

    this._resetState();
  }

  _onTouchCancel(e) {
    e.preventDefault();

    // End soft drop if active, but don't fire any final gesture
    if (this.isSoftDropping) {
      this.isSoftDropping = false;
      this.onInput('soft_drop_end');
    }

    this._resetState();
  }

  _findActiveTouch(touchList) {
    for (let i = 0; i < touchList.length; i++) {
      if (touchList[i].identifier === this.activeId) {
        return touchList[i];
      }
    }
    return null;
  }

  destroy() {
    this.el.removeEventListener('touchstart', this._onTouchStart);
    this.el.removeEventListener('touchmove', this._onTouchMove);
    this.el.removeEventListener('touchend', this._onTouchEnd);
    this.el.removeEventListener('touchcancel', this._onTouchCancel);
  }
}

// Attach to window for browser use
if (typeof window !== 'undefined') {
  window.TouchInput = TouchInput;
}

'use strict';

class Music {
  constructor() {
    this.ctx = null;
    this.playing = false;
    this.bpm = 150;
    this.scheduledSources = [];
    this.nextMelodyTime = 0;
    this.nextBassTime = 0;
    this.melodyIndex = 0;
    this.bassIndex = 0;
    this.scheduleTimer = null;
    this.melodyGain = null;
    this.bassGain = null;
    this.masterGain = null;
    this.generation = 0;

    // Note frequencies (Hz)
    const E2 = 82.41, G_2 = 103.83, A2 = 110.00;
    const C3 = 130.81, D3 = 146.83, E3 = 164.81, F3 = 174.61, G_3 = 207.65, A3 = 220.00;
    const A4 = 440.00, B4 = 493.88, C5 = 523.25, D5 = 587.33, E5 = 659.25, F5 = 698.46, G5 = 783.99, A5 = 880.00;
    const R = 0; // rest

    // Melody: [frequency, duration in eighth notes]
    // Korobeiniki Theme A — two phrases, 8 measures total
    this.melody = [
      // Phrase 1
      // m1: E5(q) B4(8) C5(8) D5(q) C5(8) B4(8)
      [E5, 2], [B4, 1], [C5, 1], [D5, 2], [C5, 1], [B4, 1],
      // m2: A4(q) A4(8) C5(8) E5(q) D5(8) C5(8)
      [A4, 2], [A4, 1], [C5, 1], [E5, 2], [D5, 1], [C5, 1],
      // m3: B4(q.) C5(8) D5(q) E5(q)
      [B4, 3], [C5, 1], [D5, 2], [E5, 2],
      // m4: C5(q) A4(q) A4(q) rest(q)
      [C5, 2], [A4, 2], [A4, 2], [R, 2],
      // Phrase 2
      // m5: rest(8) D5(q) F5(8) A5(q) G5(8) F5(8)
      [R, 1], [D5, 2], [F5, 1], [A5, 2], [G5, 1], [F5, 1],
      // m6: E5(q.) C5(8) E5(q) D5(8) C5(8)
      [E5, 3], [C5, 1], [E5, 2], [D5, 1], [C5, 1],
      // m7: B4(q.) C5(8) D5(q) E5(q)
      [B4, 3], [C5, 1], [D5, 2], [E5, 2],
      // m8: C5(q) A4(q) A4(q) rest(q)
      [C5, 2], [A4, 2], [A4, 2], [R, 2],
    ];

    // Bass line: [frequency, duration in eighth notes]
    // Octave bounce pattern following chord roots
    this.bass = [
      // m1: Em
      [E2, 2], [E3, 2], [E2, 2], [E3, 2],
      // m2: Am
      [A2, 2], [A3, 2], [A2, 2], [A3, 2],
      // m3: G#dim -> Em
      [G_2, 2], [G_3, 2], [E2, 2], [E3, 2],
      // m4: Am
      [A2, 2], [A3, 2], [A2, 2], [R, 2],
      // m5: Dm -> F
      [D3, 2], [D3, 2], [F3, 2], [F3, 2],
      // m6: C -> E
      [C3, 2], [C3, 2], [E3, 2], [E3, 2],
      // m7: G#dim -> Em
      [G_2, 2], [G_3, 2], [E2, 2], [E3, 2],
      // m8: Am
      [A2, 2], [A3, 2], [A2, 2], [R, 2],
    ];
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.3;
    this.masterGain.connect(this.ctx.destination);

    this.melodyGain = this.ctx.createGain();
    this.melodyGain.gain.value = 0.45;
    this.melodyGain.connect(this.masterGain);

    this.bassGain = this.ctx.createGain();
    this.bassGain.gain.value = 0.35;
    this.bassGain.connect(this.masterGain);
  }

  start() {
    this.init();
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this.generation++;
    this.playing = true;
    this.melodyIndex = 0;
    this.bassIndex = 0;
    this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.masterGain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    this.nextMelodyTime = this.ctx.currentTime + 0.1;
    this.nextBassTime = this.ctx.currentTime + 0.1;
    this.schedule();
  }

  stop() {
    this.playing = false;
    const gen = ++this.generation;

    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }

    // Smooth fade-out over 0.4s
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.linearRampToValueAtTime(0, now + 0.4);
    }

    // Stop all oscillators after fade completes
    setTimeout(() => {
      if (this.generation !== gen) return;
      for (const src of this.scheduledSources) {
        try { src.stop(); } catch (e) { /* already stopped */ }
      }
      this.scheduledSources = [];
    }, 450);
  }

  schedule() {
    if (!this.playing) return;

    const eighthDuration = 60 / this.bpm / 2;
    const lookahead = 0.2;

    // Schedule melody
    while (this.nextMelodyTime < this.ctx.currentTime + lookahead) {
      const [freq, eighths] = this.melody[this.melodyIndex % this.melody.length];
      const duration = eighths * eighthDuration;

      if (freq > 0) {
        this.playNote(freq, this.nextMelodyTime, duration * 0.9, this.melodyGain, 'square');
      }

      this.nextMelodyTime += duration;
      this.melodyIndex++;
    }

    // Schedule bass
    while (this.nextBassTime < this.ctx.currentTime + lookahead) {
      const [freq, eighths] = this.bass[this.bassIndex % this.bass.length];
      const duration = eighths * eighthDuration;

      if (freq > 0) {
        this.playNote(freq, this.nextBassTime, duration * 0.85, this.bassGain, 'triangle');
      }

      this.nextBassTime += duration;
      this.bassIndex++;
    }

    this.scheduleTimer = setTimeout(() => this.schedule(), 50);
  }

  playNote(freq, time, duration, gainNode, type) {
    const osc = this.ctx.createOscillator();
    const noteGain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.value = freq;

    // Envelope: quick attack, sustain, then release to avoid clicks
    noteGain.gain.setValueAtTime(0.001, time);
    noteGain.gain.linearRampToValueAtTime(1, time + 0.01);
    noteGain.gain.setValueAtTime(1, time + duration - 0.02);
    noteGain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(noteGain);
    noteGain.connect(gainNode);

    osc.start(time);
    osc.stop(time + duration + 0.01);

    this.scheduledSources.push(osc);
    osc.onended = () => {
      const idx = this.scheduledSources.indexOf(osc);
      if (idx > -1) this.scheduledSources.splice(idx, 1);
    };
  }

  setSpeed(level) {
    this.bpm = 150 + (level - 1) * 3;
  }
}

window.Music = Music;

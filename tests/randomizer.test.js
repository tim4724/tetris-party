'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Randomizer } = require('../server/Randomizer');

const ALL_TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

function drawBag(randomizer) {
  return Array.from({ length: 7 }, () => randomizer.next());
}

describe('Randomizer - bag fairness', () => {
  test('first 7 pieces contain all 7 types exactly once', () => {
    const randomizer = new Randomizer();
    const pieces = drawBag(randomizer);
    const counts = {};
    for (const p of pieces) counts[p] = (counts[p] || 0) + 1;

    for (const type of ALL_TYPES) {
      assert.strictEqual(counts[type], 1, `First bag should contain exactly one ${type}`);
    }
  });

  test('second bag of 7 also contains all 7 types exactly once', () => {
    const randomizer = new Randomizer();
    drawBag(randomizer); // discard first bag
    const pieces = drawBag(randomizer);
    const counts = {};
    for (const p of pieces) counts[p] = (counts[p] || 0) + 1;

    for (const type of ALL_TYPES) {
      assert.strictEqual(counts[type], 1, `Second bag should contain exactly one ${type}`);
    }
  });

  test('pieces across 100 draws contain each type roughly equally', () => {
    const randomizer = new Randomizer();
    const totalPieces = 100; // ~14 bags of 7 + remainder
    const counts = {};
    for (const type of ALL_TYPES) counts[type] = 0;

    for (let i = 0; i < totalPieces; i++) {
      const type = randomizer.next();
      counts[type]++;
    }

    // With 100 pieces from a bag randomizer, each type must appear between 12 and 16 times
    // (14 bags * 1 each = 14, last partial bag can give +/- a couple)
    for (const type of ALL_TYPES) {
      assert.ok(
        counts[type] >= 12 && counts[type] <= 16,
        `${type} count ${counts[type]} should be between 12 and 16 over 100 pieces`
      );
    }
  });

  test('each piece produced is a valid type', () => {
    const randomizer = new Randomizer();
    for (let i = 0; i < 49; i++) {
      const type = randomizer.next();
      assert.ok(ALL_TYPES.includes(type), `${type} should be a valid piece type`);
    }
  });

  test('consecutive bags are independently shuffled', () => {
    // Run multiple bags and verify each is a complete set
    const randomizer = new Randomizer();
    for (let bag = 0; bag < 5; bag++) {
      const pieces = drawBag(randomizer);
      const sorted = [...pieces].sort();
      assert.deepStrictEqual(sorted, [...ALL_TYPES].sort(), `Bag ${bag + 1} should be a full set`);
    }
  });
});

describe('Randomizer - seeded determinism', () => {
  test('two randomizers with same seed produce identical sequences', () => {
    const a = new Randomizer(42);
    const b = new Randomizer(42);
    for (let i = 0; i < 70; i++) {
      assert.strictEqual(a.next(), b.next(), `Piece ${i + 1} should match`);
    }
  });

  test('different seeds produce different sequences', () => {
    const a = new Randomizer(1);
    const b = new Randomizer(2);
    const seqA = Array.from({ length: 14 }, () => a.next());
    const seqB = Array.from({ length: 14 }, () => b.next());
    assert.notDeepStrictEqual(seqA, seqB);
  });

  test('seeded randomizer still produces valid bags', () => {
    const randomizer = new Randomizer(12345);
    for (let bag = 0; bag < 5; bag++) {
      const pieces = drawBag(randomizer);
      const sorted = [...pieces].sort();
      assert.deepStrictEqual(sorted, [...ALL_TYPES].sort(), `Seeded bag ${bag + 1} should be a full set`);
    }
  });
});

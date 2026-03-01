// @ts-check
const { test, expect } = require('@playwright/test');

// Mock game board: partially filled with some pieces
function createMockGrid() {
  const grid = Array.from({ length: 20 }, () => Array(10).fill(0));
  // Bottom rows with placed pieces and gaps
  grid[19] = [1, 7, 7, 3, 3, 3, 0, 2, 2, 2];
  grid[18] = [1, 0, 7, 3, 0, 0, 0, 0, 2, 0];
  grid[17] = [1, 0, 7, 0, 0, 0, 0, 0, 0, 0];
  grid[16] = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  // Some garbage rows
  grid[15] = [8, 8, 8, 0, 8, 8, 8, 8, 8, 8];
  grid[14] = [8, 8, 8, 8, 8, 0, 8, 8, 8, 8];
  return grid;
}

function createMockGrid2() {
  const grid = Array.from({ length: 20 }, () => Array(10).fill(0));
  grid[19] = [5, 5, 0, 0, 4, 4, 6, 6, 6, 0];
  grid[18] = [5, 5, 0, 0, 4, 4, 0, 6, 0, 0];
  grid[17] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  grid[16] = [8, 8, 0, 8, 8, 8, 8, 8, 8, 8];
  return grid;
}

function mockGameState(playerCount) {
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    players.push({
      id: `p${i + 1}`,
      alive: true,
      score: [12450, 8320, 5100, 2800][i],
      lines: [24, 16, 10, 5][i],
      level: [3, 2, 2, 1][i],
      grid: i === 0 ? createMockGrid() : createMockGrid2(),
      currentPiece: {
        typeId: [6, 1, 3, 5][i],
        x: [4, 3, 5, 1][i],
        y: [2, 4, 6, 8][i],
        blocks: [
          [[0, 0], [1, 0], [2, 0], [1, 1]],  // T
          [[0, 0], [1, 0], [2, 0], [3, 0]],  // I
          [[0, 0], [0, 1], [1, 1], [2, 1]],  // L
          [[0, 0], [1, 0], [0, 1], [1, 1]],  // S-ish
        ][i],
      },
      ghostY: [12, 14, 13, 15][i],
      holdPiece: ['I', 'T', 'Z', 'O'][i],
      nextPieces: [
        ['L', 'S', 'Z', 'O', 'J'],
        ['T', 'I', 'L', 'S', 'Z'],
        ['O', 'J', 'T', 'I', 'L'],
        ['S', 'Z', 'O', 'J', 'T'],
      ][i],
      pendingGarbage: [3, 0, 2, 0][i],
      playerName: ['Player 1', 'Player 2', 'Player 3', 'Player 4'][i],
      playerColor: ['#FF6B6B', '#4ECDC4', '#FFE66D', '#A78BFA'][i],
    });
  }
  return { players, elapsed: 65000 };
}

function mockResults(count) {
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push({
      rank: i + 1,
      playerId: `p${i + 1}`,
      score: [24800, 18200, 12100, 5400][i],
      lines: [48, 36, 24, 10][i],
      level: [5, 4, 3, 2][i],
    });
  }
  return results;
}

// Wait for Orbitron font to load (used throughout the UI)
async function waitForFont(page) {
  await page.evaluate(() => document.fonts.ready);
  // Brief extra wait for canvas redraws after font load
  await page.waitForTimeout(100);
}

// --- Display page tests ---

test.describe('Display', () => {

  test('welcome screen', async ({ page }) => {
    await page.goto('/');
    await waitForFont(page);
    // Stop animation and hide canvas for deterministic snapshot
    await page.evaluate(() => {
      if (typeof welcomeBg !== 'undefined' && welcomeBg) welcomeBg.stop();
      const c = document.getElementById('bg-canvas');
      if (c) c.style.display = 'none';
    });
    await expect(page).toHaveScreenshot('display-welcome.png');
  });

  test('lobby screen - empty', async ({ page }) => {
    await page.goto('/');
    await waitForFont(page);

    // Click START NEW GAME to enter lobby
    await page.click('#new-game-btn');
    await page.waitForSelector('#lobby-screen:not(.hidden)');
    // Wait for QR code canvas to be rendered
    await page.waitForFunction(() => {
      const canvas = document.getElementById('qr-code');
      return canvas && canvas.width > 0;
    });
    await page.waitForTimeout(200);
    // Stop background animation for deterministic snapshot
    await page.evaluate(() => {
      if (typeof welcomeBg !== 'undefined' && welcomeBg) welcomeBg.stop();
      const c = document.getElementById('bg-canvas');
      if (c) c.style.display = 'none';
    });
    // Mask dynamic content (QR code, room code, join URL change per run)
    await expect(page).toHaveScreenshot('display-lobby-empty.png', {
      mask: [page.locator('#qr-container')],
      maxDiffPixelRatio: 0.02,
    });
  });

  test('lobby screen - with players', async ({ page, context }) => {
    await page.goto('/');
    await waitForFont(page);
    await page.click('#new-game-btn');
    await page.waitForSelector('#lobby-screen:not(.hidden)');
    await page.waitForFunction(() => {
      const el = document.getElementById('join-url');
      return el && el.textContent && el.textContent.length > 0;
    });

    // Get room code from join URL (last path segment)
    const joinUrl = await page.textContent('#join-url');
    const roomCode = joinUrl.trim().split('/').pop();
    const controller1 = await context.newPage();
    await controller1.goto(`/${roomCode}`);
    const controller2 = await context.newPage();
    await controller2.goto(`/${roomCode}`);

    // Wait for player cards to appear on display
    await page.waitForFunction(() => {
      const list = document.getElementById('player-list');
      return list && list.children.length >= 2;
    });
    await page.waitForTimeout(200);
    // Stop background animation for deterministic snapshot
    await page.evaluate(() => {
      if (typeof welcomeBg !== 'undefined' && welcomeBg) welcomeBg.stop();
      const c = document.getElementById('bg-canvas');
      if (c) c.style.display = 'none';
    });
    await expect(page).toHaveScreenshot('display-lobby-players.png', {
      mask: [page.locator('#qr-container')],
      maxDiffPixelRatio: 0.02,
    });

    await controller1.close();
    await controller2.close();
  });

  test('game screen - 1 player', async ({ page }) => {
    await page.goto('/');
    await waitForFont(page);

    await page.evaluate((state) => {
      players.set('p1', { playerName: 'Player 1', playerColor: '#FF6B6B', playerIndex: 0 });
      playerOrder = ['p1'];
      showScreen('game');
      calculateLayout();
      gameState = state;
    }, mockGameState(1));

    // Let the render loop draw a frame
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('display-game-1p.png');
  });

  test('game screen - 2 players', async ({ page }) => {
    await page.goto('/');
    await waitForFont(page);

    await page.evaluate((state) => {
      players.set('p1', { playerName: 'Player 1', playerColor: '#FF6B6B', playerIndex: 0 });
      players.set('p2', { playerName: 'Player 2', playerColor: '#4ECDC4', playerIndex: 1 });
      playerOrder = ['p1', 'p2'];
      showScreen('game');
      calculateLayout();
      gameState = state;
    }, mockGameState(2));

    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('display-game-2p.png');
  });

  test('game screen - 4 players', async ({ page }) => {
    await page.goto('/');
    await waitForFont(page);

    await page.evaluate((state) => {
      players.set('p1', { playerName: 'Player 1', playerColor: '#FF6B6B', playerIndex: 0 });
      players.set('p2', { playerName: 'Player 2', playerColor: '#4ECDC4', playerIndex: 1 });
      players.set('p3', { playerName: 'Player 3', playerColor: '#FFE66D', playerIndex: 2 });
      players.set('p4', { playerName: 'Player 4', playerColor: '#A78BFA', playerIndex: 3 });
      playerOrder = ['p1', 'p2', 'p3', 'p4'];
      showScreen('game');
      calculateLayout();
      gameState = state;
    }, mockGameState(4));

    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('display-game-4p.png');
  });

  test('game screen - with KO', async ({ page }) => {
    await page.goto('/');
    await waitForFont(page);

    const state = mockGameState(2);
    state.players[1].alive = false;

    await page.evaluate((state) => {
      players.set('p1', { playerName: 'Player 1', playerColor: '#FF6B6B', playerIndex: 0 });
      players.set('p2', { playerName: 'Player 2', playerColor: '#4ECDC4', playerIndex: 1 });
      playerOrder = ['p1', 'p2'];
      showScreen('game');
      calculateLayout();
      gameState = state;
    }, state);

    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('display-game-ko.png');
  });

  test('pause overlay', async ({ page }) => {
    await page.goto('/');
    await waitForFont(page);

    await page.evaluate((state) => {
      players.set('p1', { playerName: 'Player 1', playerColor: '#FF6B6B', playerIndex: 0 });
      playerOrder = ['p1'];
      showScreen('game');
      calculateLayout();
      gameState = state;
      // Show pause overlay
      document.getElementById('pause-overlay').classList.remove('hidden');
    }, mockGameState(1));

    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('display-pause.png');
  });

  test('results screen', async ({ page }) => {
    await page.goto('/');
    await waitForFont(page);

    const results = mockResults(4);

    await page.evaluate((data) => {
      const { results } = data;
      players.set('p1', { playerName: 'Player 1', playerColor: '#FF6B6B', playerIndex: 0 });
      players.set('p2', { playerName: 'Player 2', playerColor: '#4ECDC4', playerIndex: 1 });
      players.set('p3', { playerName: 'Player 3', playerColor: '#FFE66D', playerIndex: 2 });
      players.set('p4', { playerName: 'Player 4', playerColor: '#A78BFA', playerIndex: 3 });
      playerOrder = ['p1', 'p2', 'p3', 'p4'];

      // Set up game screen first (results renders on top of game canvas)
      showScreen('game');
      calculateLayout();
      gameState = {
        players: playerOrder.map((id, i) => ({
          id,
          alive: false,
          score: results[i].score,
          lines: results[i].lines,
          level: results[i].level,
          grid: Array.from({ length: 20 }, () => Array(10).fill(0)),
          nextPieces: [],
          pendingGarbage: 0,
        })),
        elapsed: 185000,
      };

      // Now show results overlay
      showScreen('results');

      // Populate results list
      const resultsList = document.getElementById('results-list');
      resultsList.innerHTML = '';
      const sorted = results.slice().sort((a, b) => a.rank - b.rank);
      for (const r of sorted) {
        const row = document.createElement('div');
        row.className = `result-row rank-${r.rank}`;
        const rank = document.createElement('span');
        rank.className = 'result-rank';
        rank.textContent = r.rank <= 3 ? ['', '1st', '2nd', '3rd'][r.rank] : `${r.rank}th`;
        const nameEl = document.createElement('span');
        nameEl.className = 'result-name';
        const pInfo = players.get(r.playerId);
        nameEl.textContent = pInfo?.playerName || `Player`;
        if (pInfo) nameEl.style.color = pInfo.playerColor || '#fff';
        const stats = document.createElement('div');
        stats.className = 'result-stats';
        stats.innerHTML = `<span>Score: ${r.score}</span><span>Lines: ${r.lines}</span><span>Lv ${r.level}</span>`;
        row.appendChild(rank);
        row.appendChild(nameEl);
        row.appendChild(stats);
        resultsList.appendChild(row);
      }
    }, { results });

    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('display-results.png');
  });

});

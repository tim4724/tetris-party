// @ts-check
const { test, expect } = require('@playwright/test');

// Stub WebSocket so the controller doesn't auto-connect and change DOM state
const WS_STUB_SCRIPT = `
  window._OriginalWebSocket = window.WebSocket;
  window.WebSocket = function(url) {
    this.url = url;
    this.readyState = 0;
    this.send = function() {};
    this.close = function() {};
    // Don't fire onopen/onclose/onerror — keep UI in its initial state
  };
`;

// Wait for Orbitron font to load
async function waitForFont(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(100);
}

// Helper: set up the controller lobby state via DOM manipulation
async function setupLobbyState(page, { isHost, playerColor, playerName, playerCount }) {
  await page.evaluate(({ isHost, playerColor, playerName, playerCount }) => {
    // Show lobby elements
    document.getElementById('lobby-title').classList.remove('hidden');
    document.getElementById('status-text').textContent = isHost ? '' : 'Waiting for host to start...';
    document.getElementById('status-detail').textContent = '';

    // Player identity card
    const identity = document.getElementById('player-identity');
    identity.classList.remove('hidden');
    identity.style.setProperty('--id-color', playerColor);
    document.getElementById('player-identity-name').textContent = playerName;

    // Start button (host only)
    const startBtn = document.getElementById('start-btn');
    if (isHost) {
      startBtn.classList.remove('hidden');
      startBtn.disabled = false;
      startBtn.textContent = `START (${playerCount} player${playerCount > 1 ? 's' : ''})`;
    } else {
      startBtn.classList.add('hidden');
    }

    // Hide rejoin
    document.getElementById('rejoin-btn').classList.add('hidden');
  }, { isHost, playerColor, playerName, playerCount });
}

// Helper: set up the game screen via DOM manipulation
async function setupGameState(page, { playerColor, playerName, isHost }) {
  await page.evaluate(({ playerColor, playerName, isHost }) => {
    // Switch screens
    document.getElementById('waiting-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    document.getElementById('gameover-screen').classList.add('hidden');

    const gameScreen = document.getElementById('game-screen');
    gameScreen.style.setProperty('--player-color', playerColor);
    gameScreen.classList.remove('dead', 'paused');
    document.getElementById('player-name').textContent = playerName;

    // Pause button (host only)
    document.getElementById('pause-btn').classList.toggle('hidden', !isHost);

    // Hide overlays
    document.getElementById('pause-overlay').classList.add('hidden');
    const ko = document.getElementById('ko-overlay');
    if (ko) ko.remove();
  }, { playerColor, playerName, isHost });
}

// Helper: set up results screen
async function setupResultsState(page, { isHost, results, meId, playerColor }) {
  await page.evaluate(({ isHost, results, meId, playerColor }) => {
    // Switch screens
    document.getElementById('waiting-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('gameover-screen').classList.remove('hidden');

    document.getElementById('gameover-title').textContent = 'RESULTS';

    const COLORS = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#A78BFA'];
    const NAMES = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];

    // Winner glow
    const gameoverScreen = document.getElementById('gameover-screen');
    if (results.length > 0) {
      const wc = COLORS[(results[0].playerId - 1) % COLORS.length];
      gameoverScreen.style.setProperty('--winner-glow', `color-mix(in srgb, ${wc} 8%, transparent)`);
    }
    if (playerColor) {
      gameoverScreen.style.setProperty('--me-color', playerColor);
    }

    // Buttons
    document.getElementById('gameover-buttons').classList.toggle('hidden', !isHost);
    document.getElementById('gameover-status').textContent = isHost ? '' : 'Waiting for host...';

    // Results list
    const resultsList = document.getElementById('results-list');
    resultsList.innerHTML = '';
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const pColor = COLORS[(r.playerId - 1) % COLORS.length];
      const row = document.createElement('div');
      row.className = `result-row rank-${r.rank}`;
      row.style.setProperty('--row-delay', `${0.2 + i * 0.08}s`);
      if (r.playerId === meId) row.classList.add('is-me');

      const rankEl = document.createElement('span');
      rankEl.className = 'result-rank';
      rankEl.textContent = r.rank <= 3 ? ['', '1st', '2nd', '3rd'][r.rank] : `${r.rank}th`;

      const info = document.createElement('div');
      info.className = 'result-info';
      const nameEl = document.createElement('span');
      nameEl.className = 'result-name';
      nameEl.textContent = NAMES[r.playerId - 1] || `Player ${r.playerId}`;
      nameEl.style.color = pColor;
      const scoreEl = document.createElement('span');
      scoreEl.className = 'result-score';
      scoreEl.textContent = `${(r.score || 0).toLocaleString()} pts`;
      info.appendChild(nameEl);
      info.appendChild(scoreEl);
      row.appendChild(rankEl);
      row.appendChild(info);
      resultsList.appendChild(row);
    }
  }, { isHost, results, meId, playerColor });
}

const mockResults = [
  { rank: 1, playerId: 1, score: 24800 },
  { rank: 2, playerId: 2, score: 18200 },
  { rank: 3, playerId: 3, score: 12100 },
  { rank: 4, playerId: 4, score: 5400 },
];

// --- Controller page tests (phone viewport: 390x844) ---

test.describe('Controller', () => {

  test('connecting screen', async ({ page }) => {
    await page.addInitScript(WS_STUB_SCRIPT);
    await page.goto('/TESTROOM');
    await waitForFont(page);
    await expect(page).toHaveScreenshot('controller-connecting.png');
  });

  test('lobby - host view', async ({ page }) => {
    await page.addInitScript(WS_STUB_SCRIPT);
    await page.goto('/TESTROOM');
    await waitForFont(page);
    await setupLobbyState(page, {
      isHost: true,
      playerColor: '#FF6B6B',
      playerName: 'Player 1',
      playerCount: 2,
    });
    await page.waitForTimeout(100);
    await expect(page).toHaveScreenshot('controller-lobby-host.png');
  });

  test('lobby - non-host view', async ({ page }) => {
    await page.addInitScript(WS_STUB_SCRIPT);
    await page.goto('/TESTROOM');
    await waitForFont(page);
    await setupLobbyState(page, {
      isHost: false,
      playerColor: '#4ECDC4',
      playerName: 'Player 2',
      playerCount: 2,
    });
    await page.waitForTimeout(100);
    await expect(page).toHaveScreenshot('controller-lobby-nonhost.png');
  });

  test('game screen - host', async ({ page }) => {
    await page.addInitScript(WS_STUB_SCRIPT);
    await page.goto('/TESTROOM');
    await waitForFont(page);
    await setupGameState(page, {
      playerColor: '#FF6B6B',
      playerName: 'Player 1',
      isHost: true,
    });
    await page.waitForTimeout(100);
    await expect(page).toHaveScreenshot('controller-game-host.png');
  });

  test('game screen - non-host', async ({ page }) => {
    await page.addInitScript(WS_STUB_SCRIPT);
    await page.goto('/TESTROOM');
    await waitForFont(page);
    await setupGameState(page, {
      playerColor: '#4ECDC4',
      playerName: 'Player 2',
      isHost: false,
    });
    await page.waitForTimeout(100);
    await expect(page).toHaveScreenshot('controller-game-nonhost.png');
  });

  test('game screen - paused (host)', async ({ page }) => {
    await page.addInitScript(WS_STUB_SCRIPT);
    await page.goto('/TESTROOM');
    await waitForFont(page);
    await setupGameState(page, {
      playerColor: '#FF6B6B',
      playerName: 'Player 1',
      isHost: true,
    });

    // Show pause overlay
    await page.evaluate(() => {
      document.getElementById('game-screen').classList.add('paused');
      document.getElementById('pause-overlay').classList.remove('hidden');
      document.getElementById('pause-btn').classList.add('hidden');
      document.getElementById('pause-buttons').classList.remove('hidden');
      document.getElementById('pause-status').textContent = '';
    });
    await page.waitForTimeout(100);
    await expect(page).toHaveScreenshot('controller-pause-host.png');
  });

  test('game screen - paused (non-host)', async ({ page }) => {
    await page.addInitScript(WS_STUB_SCRIPT);
    await page.goto('/TESTROOM');
    await waitForFont(page);
    await setupGameState(page, {
      playerColor: '#4ECDC4',
      playerName: 'Player 2',
      isHost: false,
    });

    await page.evaluate(() => {
      document.getElementById('game-screen').classList.add('paused');
      document.getElementById('pause-overlay').classList.remove('hidden');
      document.getElementById('pause-buttons').classList.add('hidden');
      document.getElementById('pause-status').textContent = 'Game paused by host';
    });
    await page.waitForTimeout(100);
    await expect(page).toHaveScreenshot('controller-pause-nonhost.png');
  });

  test('game screen - KO', async ({ page }) => {
    await page.addInitScript(WS_STUB_SCRIPT);
    await page.goto('/TESTROOM');
    await waitForFont(page);
    await setupGameState(page, {
      playerColor: '#FF6B6B',
      playerName: 'Player 1',
      isHost: false,
    });

    await page.evaluate(() => {
      document.getElementById('game-screen').classList.add('dead');
      const ko = document.createElement('div');
      ko.id = 'ko-overlay';
      ko.textContent = 'KO';
      document.getElementById('touch-area').appendChild(ko);
    });
    await page.waitForTimeout(100);
    await expect(page).toHaveScreenshot('controller-ko.png');
  });

  test('results - host view', async ({ page }) => {
    await page.addInitScript(WS_STUB_SCRIPT);
    await page.goto('/TESTROOM');
    await waitForFont(page);
    await setupResultsState(page, {
      isHost: true,
      results: mockResults,
      meId: 1,
      playerColor: '#FF6B6B',
    });
    // Wait for row animations
    await page.waitForTimeout(600);
    await expect(page).toHaveScreenshot('controller-results-host.png');
  });

  test('results - non-host view', async ({ page }) => {
    await page.addInitScript(WS_STUB_SCRIPT);
    await page.goto('/TESTROOM');
    await waitForFont(page);
    await setupResultsState(page, {
      isHost: false,
      results: mockResults,
      meId: 3,
      playerColor: '#FFE66D',
    });
    await page.waitForTimeout(600);
    await expect(page).toHaveScreenshot('controller-results-nonhost.png');
  });

});

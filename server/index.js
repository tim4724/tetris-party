'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const Room = require('./Room.js');
const { MSG } = require('../public/shared/protocol.js');

const PORT = parseInt(process.env.PORT, 10) || 4000;
const PUBLIC_URL = process.env.PUBLIC_URL || ''; // e.g. https://main.tetris-party.duckdns.org
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// --- MIME types ---
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

// --- HTTP Static Server ---
const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0]; // strip query params

  // Health check endpoint
  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Map directory paths to index.html
  if (urlPath === '/') {
    urlPath = '/display/index.html';
  } else if (urlPath.length > 1 && !urlPath.includes('.') && urlPath.split('/').filter(Boolean).length === 1) {
    // Single path segment with no file extension → room code → serve controller
    urlPath = '/controller/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, urlPath);

  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': contentType };

    // Prevent mobile browsers from serving stale controller/display code.
    if (ext === '.html' || ext === '.js' || ext === '.css') {
      headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    }

    res.writeHead(200, headers);
    res.end(data);
  });
});

// --- Get local network IP ---
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// --- Room management ---
const rooms = new Map(); // roomCode -> Room

// Track which ws belongs to which room/player
const clientInfo = new WeakMap(); // ws -> { roomCode, playerId, type }

// --- WebSocket Server ---
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }

    const info = clientInfo.get(ws);

    // --- First message: identify client type ---
    if (!info) {
      handleNewConnection(ws, msg);
      return;
    }

    // --- Subsequent messages: route to room ---
    const room = rooms.get(info.roomCode);
    if (!room) return;

    if (info.type === 'display') {
      handleDisplayMessage(room, msg);
    } else if (info.type === 'controller') {
      handleControllerMessage(room, info.playerId, msg);
    }
  });

  ws.on('close', () => {
    const info = clientInfo.get(ws);
    if (!info) return;

    const room = rooms.get(info.roomCode);
    if (!room) return;

    if (info.type === 'display') {
      console.log(`Display disconnected from room ${info.roomCode}`);
      room.destroy();
      rooms.delete(info.roomCode);
      console.log(`Room ${info.roomCode} destroyed`);
    } else if (info.type === 'controller') {
      console.log(`Player ${info.playerId} disconnected from room ${info.roomCode}`);
      room.removePlayer(info.playerId);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

// --- Handle new connections ---
async function handleNewConnection(ws, msg) {
  if (msg.type === MSG.CREATE_ROOM) {
    const roomCode = Room.generateRoomCode();
    const room = new Room(roomCode, ws);
    rooms.set(roomCode, room);

    clientInfo.set(ws, { roomCode, type: 'display' });

    let joinUrl;
    if (PUBLIC_URL) {
      joinUrl = `${PUBLIC_URL}/${roomCode}`;
    } else {
      const localIP = getLocalIP();
      joinUrl = `http://${localIP}:${PORT}/${roomCode}`;
    }
    room.joinUrl = joinUrl;
    const qrDataUrl = await room.getQRUrl(joinUrl);

    send(ws, MSG.ROOM_CREATED, { roomCode, qrDataUrl, joinUrl });
    console.log(`Room ${roomCode} created. Join: ${joinUrl}`);

  } else if (msg.type === MSG.JOIN) {
    const room = rooms.get(msg.roomCode);
    if (!room) {
      send(ws, MSG.ERROR, { message: 'Room not found' });
      return;
    }

    // QR-based rejoin: player scanned a rejoin QR code with ?rejoin=playerId
    if (msg.rejoinId) {
      const result = room.rejoinById(parseInt(msg.rejoinId), ws);
      if (result) {
        clientInfo.set(ws, { roomCode: msg.roomCode, playerId: result.playerId, type: 'controller' });
        send(ws, MSG.JOINED, {
          playerId: result.playerId,
          playerName: result.name,
          playerColor: result.color,
          reconnectToken: result.reconnectToken,
          isHost: result.isHost,
          reconnected: true,
          playerCount: room.players.size,
          roomState: room.state
        });
        console.log(`Player ${result.playerId} rejoined room ${msg.roomCode} via QR`);
        return;
      }
      // Fall through to normal addPlayer if rejoin failed
    }

    const result = room.addPlayer(ws, msg.name);
    if (result) {
      clientInfo.set(ws, { roomCode: msg.roomCode, playerId: result.playerId, type: 'controller' });
      send(ws, MSG.JOINED, {
        playerId: result.playerId,
        playerName: result.name,
        playerColor: result.color,
        reconnectToken: result.reconnectToken,
        isHost: result.isHost,
        playerCount: room.players.size
      });
      console.log(`Player ${result.playerId} (${result.name}) joined room ${msg.roomCode}`);
    }

  } else if (msg.type === MSG.REJOIN) {
    const room = rooms.get(msg.roomCode);
    if (!room) {
      send(ws, MSG.ERROR, { message: 'Room not found' });
      return;
    }

    const playerId = room.reconnectByToken(ws, msg.reconnectToken);
    if (playerId !== null) {
      const player = room.players.get(playerId);
      clientInfo.set(ws, { roomCode: msg.roomCode, playerId, type: 'controller' });
      send(ws, MSG.JOINED, {
        playerId,
        playerName: player.name,
        playerColor: player.color,
        reconnected: true,
        isHost: playerId === room.hostId,
        playerCount: room.players.size,
        roomState: room.state
      });
      console.log(`Player ${playerId} reconnected to room ${msg.roomCode}`);
    } else {
      send(ws, MSG.ERROR, { message: 'Reconnection failed' });
    }
  }
}

// --- Handle display messages ---
function handleDisplayMessage(room, msg) {
  switch (msg.type) {
    case MSG.START_GAME:
      room.startGame();
      break;
    case MSG.RETURN_TO_LOBBY:
      room.returnToLobby();
      break;
    case MSG.PLAY_AGAIN:
      room.playAgain();
      break;
    case MSG.PAUSE_GAME:
      room.pauseGame();
      break;
    case MSG.RESUME_GAME:
      room.resumeGame();
      break;
  }
}

// --- Handle controller messages ---
function handleControllerMessage(room, playerId, msg) {
  switch (msg.type) {
    case MSG.INPUT:
      room.handleInput(playerId, msg.action, msg.seq);
      break;
    case MSG.SOFT_DROP_START:
      room.handleSoftDropStart(playerId, msg.speed);
      break;
    case MSG.SOFT_DROP_END:
      room.handleSoftDropEnd(playerId);
      break;
    case MSG.START_GAME:
      if (playerId === room.hostId) {
        room.startGame();
      }
      break;
    case MSG.PLAY_AGAIN:
      if (playerId === room.hostId) {
        room.playAgain();
      }
      break;
    case MSG.RETURN_TO_LOBBY:
      if (playerId === room.hostId) {
        room.returnToLobby();
      }
      break;
    case MSG.PAUSE_GAME:
      if (playerId === room.hostId) {
        room.pauseGame();
      }
      break;
    case MSG.RESUME_GAME:
      if (playerId === room.hostId) {
        room.resumeGame();
      }
      break;
  }
}

// --- Helper ---
function send(ws, type, data) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type, ...data }));
  }
}

// --- Start server ---
server.listen(PORT, () => {
  const localIP = getLocalIP();
  console.log(`Tetris server running on http://localhost:${PORT}`);
  console.log(`Local network: http://${localIP}:${PORT}`);
  console.log(`Display: http://localhost:${PORT}/`);
});

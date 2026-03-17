const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const defaultTeams = [
  { name: 'Mumbai Meteors', purse: 120, active: true },
  { name: 'Chennai Chargers', purse: 120, active: true },
];

const state = {
  users: [],
  players: [
    { id: 1, name: 'Viraj Storm' },
    { id: 2, name: 'Rohan Blaster' },
    { id: 3, name: 'Arjun Blaze' },
    { id: 4, name: 'Karan Thunder' },
  ],
  currentPlayerIndex: 0,
  basePrice: 1,
  currentBid: 1,
  currentTeam: null,
  auctionRunning: false,
  timerSeconds: 5,
  lastBidAt: null,
  teams: structuredClone(defaultTeams),
  bids: [],
  history: [],
  chat: [
    {
      id: 1,
      type: 'system',
      sender: 'System',
      message: 'Welcome to KFL Auction Room',
      at: new Date().toISOString(),
    },
  ],
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function roundBid(value) {
  return Number(value.toFixed(1));
}

function nextBidValue(current) {
  if (current < 10) return roundBid(current + 0.5);
  if (current < 20) return roundBid(current + 1);
  if (current < 30) return roundBid(current + 2);
  return roundBid(current + 3);
}

function computeTimerLeft() {
  if (!state.auctionRunning || !state.lastBidAt) return 5;
  const elapsed = Math.floor((Date.now() - state.lastBidAt) / 1000);
  return Math.max(0, 5 - elapsed);
}

function updateTimerAndAutoEnd() {
  state.timerSeconds = computeTimerLeft();
  if (state.auctionRunning && state.timerSeconds <= 0) {
    endBidding(true);
  }
}

function endBidding(fromTimer = false) {
  state.auctionRunning = false;
  state.timerSeconds = 5;

  const currentPlayer = state.players[state.currentPlayerIndex];

  if (currentPlayer && state.currentTeam) {
    const team = state.teams.find((t) => t.name === state.currentTeam);
    if (team) {
      team.purse = roundBid(team.purse - state.currentBid);
    }

    state.history.push({
      playerName: currentPlayer.name,
      soldTeam: state.currentTeam,
      price: roundBid(state.currentBid),
      via: fromTimer ? 'timer' : 'admin',
      soldAt: new Date().toISOString(),
    });

    state.chat.push({
      id: Date.now(),
      type: 'system',
      sender: 'System',
      message: `${currentPlayer.name} sold to ${state.currentTeam} for ${roundBid(state.currentBid)} CR`,
      at: new Date().toISOString(),
    });
  }

  state.currentBid = state.basePrice;
  state.currentTeam = null;
  state.lastBidAt = null;
}

setInterval(updateTimerAndAutoEnd, 500);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.socket.destroy();
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/state') {
    updateTimerAndAutoEnd();
    return sendJson(res, 200, {
      player: state.players[state.currentPlayerIndex] || null,
      basePrice: state.basePrice,
      currentBid: roundBid(state.currentBid),
      currentTeam: state.currentTeam,
      auctionRunning: state.auctionRunning,
      timerSeconds: state.timerSeconds,
      teams: state.teams,
      activeBidders: state.teams.filter((t) => t.active).map((t) => t.name),
      chat: state.chat.slice(-40),
      history: state.history,
      bids: state.bids,
    });
  }

  if (req.method === 'POST' && pathname === '/api/register') {
    return readBody(req)
      .then((body) => {
        const { teamName, username, password } = body;
        if (!teamName || !username || !password) {
          return sendJson(res, 400, { error: 'Missing registration fields.' });
        }
        state.users.push({ teamName, username, password });
        state.chat.push({
          id: Date.now(),
          type: 'system',
          sender: 'System',
          message: `${teamName} joined the auction.`,
          at: new Date().toISOString(),
        });
        return sendJson(res, 200, { ok: true });
      })
      .catch(() => sendJson(res, 400, { error: 'Invalid JSON body.' }));
  }

  if (req.method === 'POST' && pathname === '/api/login') {
    return readBody(req)
      .then((body) => {
        const { username, password } = body;
        const found = state.users.find((u) => u.username === username && u.password === password);
        if (!found) return sendJson(res, 401, { error: 'Invalid credentials.' });
        return sendJson(res, 200, { ok: true, teamName: found.teamName });
      })
      .catch(() => sendJson(res, 400, { error: 'Invalid JSON body.' }));
  }

  if (req.method === 'POST' && pathname === '/api/admin/start') {
    state.auctionRunning = true;
    state.lastBidAt = Date.now();
    state.chat.push({
      id: Date.now(),
      type: 'system',
      sender: 'System',
      message: 'Auction started.',
      at: new Date().toISOString(),
    });
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/admin/pause') {
    state.auctionRunning = false;
    state.chat.push({
      id: Date.now(),
      type: 'system',
      sender: 'System',
      message: 'Auction paused.',
      at: new Date().toISOString(),
    });
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/admin/next') {
    state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
    state.currentBid = state.basePrice;
    state.currentTeam = null;
    state.timerSeconds = 5;
    state.lastBidAt = state.auctionRunning ? Date.now() : null;
    state.teams.forEach((t) => {
      t.active = true;
    });
    state.chat.push({
      id: Date.now(),
      type: 'system',
      sender: 'System',
      message: `Next player: ${state.players[state.currentPlayerIndex].name}`,
      at: new Date().toISOString(),
    });
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/admin/end') {
    endBidding(false);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/bid') {
    return readBody(req)
      .then((body) => {
        const { teamName } = body;
        if (!state.auctionRunning) {
          return sendJson(res, 400, { error: 'Auction is not running.' });
        }
        const team = state.teams.find((t) => t.name === teamName);
        if (!team || !team.active) {
          return sendJson(res, 400, { error: 'Team is not an active bidder.' });
        }

        const nextBid = nextBidValue(state.currentBid);
        if (team.purse < nextBid) {
          return sendJson(res, 400, { error: 'Insufficient purse.' });
        }

        state.currentBid = nextBid;
        state.currentTeam = teamName;
        state.lastBidAt = Date.now();
        state.timerSeconds = 5;
        state.bids.push({
          teamName,
          bid: nextBid,
          playerName: state.players[state.currentPlayerIndex]?.name || 'Unknown',
          at: new Date().toISOString(),
        });

        state.chat.push({
          id: Date.now(),
          type: 'system',
          sender: 'System',
          message: `${teamName} bids ${nextBid} CR`,
          at: new Date().toISOString(),
        });

        return sendJson(res, 200, { ok: true, currentBid: nextBid });
      })
      .catch(() => sendJson(res, 400, { error: 'Invalid JSON body.' }));
  }

  if (req.method === 'POST' && pathname === '/api/out') {
    return readBody(req)
      .then((body) => {
        const { teamName } = body;
        const team = state.teams.find((t) => t.name === teamName);
        if (!team) return sendJson(res, 404, { error: 'Team not found.' });
        team.active = false;
        state.chat.push({
          id: Date.now(),
          type: 'system',
          sender: 'System',
          message: `${teamName} is OUT for this player.`,
          at: new Date().toISOString(),
        });
        return sendJson(res, 200, { ok: true });
      })
      .catch(() => sendJson(res, 400, { error: 'Invalid JSON body.' }));
  }

  if (req.method === 'POST' && pathname === '/api/chat') {
    return readBody(req)
      .then((body) => {
        const { sender, message } = body;
        if (!sender || !message) {
          return sendJson(res, 400, { error: 'Missing sender or message.' });
        }
        state.chat.push({
          id: Date.now(),
          type: 'message',
          sender,
          message,
          at: new Date().toISOString(),
        });
        return sendJson(res, 200, { ok: true });
      })
      .catch(() => sendJson(res, 400, { error: 'Invalid JSON body.' }));
  }

  return false;
}

function serveStaticFile(req, res, pathname) {
  const targetPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, targetPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Forbidden path.' });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath);
    const contentType = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
    }[ext] || 'text/plain';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    const handled = handleApi(req, res, url.pathname);
    if (handled === false) {
      sendJson(res, 404, { error: 'API route not found.' });
    }
    return;
  }

  serveStaticFile(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`KFL Auction app running on http://localhost:${PORT}`);
});

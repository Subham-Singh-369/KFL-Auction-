const state = {
  teamName: '',
  username: '',
};

const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => Array.from(document.querySelectorAll(selector));

function formatCr(value) {
  return `${Number(value).toFixed(1).replace('.0', '')} CR`;
}

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function switchTab(tabName) {
  qsa('.tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabName));
  qsa('.tab').forEach((tab) => tab.classList.toggle('active', tab.id === `tab-${tabName}`));
}

qsa('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

qs('#register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const teamName = form.get('teamName').trim();
  const username = form.get('username').trim();
  const password = form.get('password');
  const confirmPassword = form.get('confirmPassword');
  if (password !== confirmPassword) {
    qs('#login-status').textContent = 'Passwords do not match.';
    return;
  }
  try {
    await api('/api/register', 'POST', { teamName, username, password });
    qs('#login-status').textContent = 'Registered successfully. Please log in.';
    event.target.reset();
  } catch (error) {
    qs('#login-status').textContent = error.message;
  }
});

qs('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const data = await api('/api/login', 'POST', {
      username: form.get('username').trim(),
      password: form.get('password'),
    });
    state.teamName = data.teamName;
    state.username = form.get('username').trim();
    qs('#login-status').textContent = `Logged in as ${state.teamName}`;
    switchTab('auction');
  } catch (error) {
    qs('#login-status').textContent = error.message;
  }
});

qs('#start-btn').onclick = () => api('/api/admin/start', 'POST').catch(alert);
qs('#pause-btn').onclick = () => api('/api/admin/pause', 'POST').catch(alert);
qs('#next-btn').onclick = () => api('/api/admin/next', 'POST').catch(alert);
qs('#end-btn').onclick = () => api('/api/admin/end', 'POST').catch(alert);

qs('#bid-btn').addEventListener('click', async () => {
  const teamName = qs('#team-select').value;
  if (!teamName) return;
  try {
    await api('/api/bid', 'POST', { teamName });
    await refresh();
  } catch (error) {
    alert(error.message);
  }
});

qs('#out-btn').addEventListener('click', async () => {
  const teamName = qs('#team-select').value;
  if (!teamName) return;
  try {
    await api('/api/out', 'POST', { teamName });
    await refresh();
  } catch (error) {
    alert(error.message);
  }
});

qs('#chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = qs('#chat-input');
  if (!input.value.trim()) return;
  try {
    await api('/api/chat', 'POST', {
      sender: state.teamName || state.username || 'Guest',
      message: input.value.trim(),
    });
    input.value = '';
    await refresh();
  } catch (error) {
    alert(error.message);
  }
});

function renderChat(messages) {
  const chat = qs('#chat-messages');
  chat.innerHTML = messages
    .map((m) => `<div class="${m.type === 'system' ? 'system' : ''}"><strong>${m.sender}:</strong> ${m.message}</div>`)
    .join('');
  chat.scrollTop = chat.scrollHeight;
}

function renderTeamOptions(teams) {
  const select = qs('#team-select');
  const current = select.value;
  select.innerHTML = teams
    .map((team) => `<option value="${team.name}">${team.name}${team.active ? '' : ' (OUT)'}</option>`)
    .join('');
  select.value = teams.some((t) => t.name === current) ? current : teams[0]?.name || '';
}

function renderTable(id, rows, rowFn) {
  const container = qs(id);
  container.innerHTML = rows.map(rowFn).join('') || '<tr><td colspan="3">No data yet</td></tr>';
}

async function refresh() {
  const data = await api('/api/state');

  qs('#player-name').textContent = `Player: ${data.player ? data.player.name : '-'}`;
  qs('#current-bid').textContent = formatCr(data.currentBid);
  qs('#current-team').textContent = data.currentTeam || '-';
  qs('#countdown').textContent = `${data.timerSeconds}s`;

  renderTeamOptions(data.teams);

  qs('#active-bidders').innerHTML = data.activeBidders.map((team) => `<li>${team}</li>`).join('') || '<li>None</li>';

  renderTable('#team-table', data.teams, (team) => `<tr><td>${team.name}</td><td>${formatCr(team.purse)}</td></tr>`);
  renderTable(
    '#history-table',
    data.history,
    (item) => `<tr><td>${item.playerName}</td><td>${item.soldTeam}</td><td>${formatCr(item.price)}</td></tr>`,
  );

  renderChat(data.chat);
}

setInterval(() => {
  refresh().catch(() => {});
}, 1000);

refresh().catch(console.error);

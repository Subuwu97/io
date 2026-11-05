const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const restartBtn = document.getElementById('restartBtn');
const logPanel = document.getElementById('logPanel');

const STATUS_LABELS = { stopped: 'Stopped', starting: 'Starting\u2026', running: 'Running', stopping: 'Stopping\u2026' };

function applyStatus({ status }) {
  statusDot.className = `status-dot ${status}`;
  statusText.textContent = STATUS_LABELS[status] || status;
  startBtn.disabled = status !== 'stopped';
  stopBtn.disabled = status !== 'running';
  restartBtn.disabled = status !== 'running';
}

function appendLogLine({ text, isError }) {
  const atBottom = logPanel.scrollTop + logPanel.clientHeight >= logPanel.scrollHeight - 4;
  const span = document.createElement('span');
  if (isError) span.className = 'log-error';
  span.textContent = text;
  logPanel.appendChild(span);
  // Only auto-scrolls if the user was already at the bottom - someone
  // who's scrolled up to read an earlier line shouldn't have it yanked
  // out from under them by every new line still streaming in.
  if (atBottom) logPanel.scrollTop = logPanel.scrollHeight;
}

startBtn.addEventListener('click', () => window.io.startServer());
stopBtn.addEventListener('click', () => window.io.stopServer());
restartBtn.addEventListener('click', () => window.io.restartServer());
document.getElementById('openBrowserBtn').addEventListener('click', () => window.io.openInBrowser());
document.getElementById('openDataBtn').addEventListener('click', () => window.io.openDataFolder());
document.getElementById('clearLogsBtn').addEventListener('click', () => { logPanel.innerHTML = ''; });
document.getElementById('copyUrlBtn').addEventListener('click', async () => {
  await window.io.copyServerUrl();
  const btn = document.getElementById('copyUrlBtn');
  const original = btn.textContent;
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = original; }, 1200);
});

window.io.onStatusUpdate(applyStatus);
window.io.onLogLine(appendLogLine);

window.io.getStatus().then(applyStatus);

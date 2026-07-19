/**
 * Supervisor Luna — Electron Tray App
 * Gerencia dois processos locais:
 *   - Supervisor de logs (porta 4500)
 *   - Backend Luna       (porta 3000)
 */
const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');
const fs   = require('fs');

// ── Caminhos ──────────────────────────────────────────────────────────────────
const SUPERVISOR_DIR    = path.join(__dirname, '..', 'backend');
const SUPERVISOR_SCRIPT = path.join(SUPERVISOR_DIR, 'src', 'server.js');
const LUNA_DIR          = path.resolve(__dirname, '..', '..', 'trafego_luna_cosmeticos');
const LUNA_SCRIPT       = path.join(LUNA_DIR, 'backend', 'server.js');
const LUNA_ENV_LOCAL    = path.join(LUNA_DIR, '.env.local');
const LOG_DIR           = path.join(SUPERVISOR_DIR, 'logs');

const FRONTEND_URL = process.env.SUPERVISOR_FRONTEND_URL || 'http://localhost:4500';

// ── Node.exe do sistema (não o do Electron) ───────────────────────────────────
function findNodeExe() {
  try {
    const p = execSync('where node', { encoding: 'utf-8' }).trim().split('\n')[0].trim();
    if (p && fs.existsSync(p)) return p;
  } catch(_) {}
  const candidates = [
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
  ];
  return candidates.find(p => fs.existsSync(p)) || 'node';
}
const NODE_EXE = findNodeExe();

// ── Estado ────────────────────────────────────────────────────────────────────
let tray             = null;
let mainWindow       = null;
let supervisorProc   = null;
let lunaProc         = null;
let statusSupervisor = 'offline';
let statusLuna       = 'offline';

app.on('window-all-closed', e => e.preventDefault());

// ── Ícone ─────────────────────────────────────────────────────────────────────
function makeIcon(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="7" fill="${color}" stroke="white" stroke-width="1.5"/>
    <text x="8" y="12" text-anchor="middle" font-size="9" fill="white" font-weight="bold">L</text>
  </svg>`;
  return nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
}

function trayIcon() {
  if (statusLuna === 'online' && statusSupervisor === 'online') return makeIcon('#22c55e');
  if (statusLuna === 'error'  || statusSupervisor === 'error')  return makeIcon('#ef4444');
  return makeIcon('#f59e0b');
}

// ── Verificar porta ───────────────────────────────────────────────────────────
function checkPort(port) {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${port}/health`, res => resolve(res.statusCode === 200));
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

// ── Iniciar processo ──────────────────────────────────────────────────────────
function startProcess(label, script, cwd, extraEnv, onExit) {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

  // Montar env: base + extras + .env.local do Luna (se aplicável)
  let envVars = { ...process.env, ...extraEnv };
  if (cwd === LUNA_DIR && fs.existsSync(LUNA_ENV_LOCAL)) {
    fs.readFileSync(LUNA_ENV_LOCAL, 'utf-8').split('\n').forEach(line => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) envVars[m[1]] = m[2].trim();
    });
  }

  const proc = spawn(NODE_EXE, [script], { cwd, shell: false, stdio: 'pipe', env: envVars });

  const logFile = path.join(LOG_DIR, `${label}.log`);
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });
  const ts = () => new Date().toISOString();
  proc.stdout.on('data', d => logStream.write(`[${ts()}] ${d}`));
  proc.stderr.on('data', d => logStream.write(`[${ts()}] ERR: ${d}`));
  proc.on('exit', code => {
    logStream.end();
    console.log(`[tray] ${label} encerrou (code ${code})`);
    onExit(code);
  });

  return proc;
}

// ── Iniciar Supervisor (4500) ─────────────────────────────────────────────────
async function startSupervisor() {
  if (await checkPort(4500)) {
    statusSupervisor = 'online'; updateTray(); return;
  }
  statusSupervisor = 'starting'; updateTray();

  supervisorProc = startProcess(
    'supervisor', SUPERVISOR_SCRIPT, SUPERVISOR_DIR,
    { SUPERVISOR_PORT: '4500', LOG_DIR },
    code => {
      statusSupervisor = 'error'; updateTray();
      if (!app.isQuitting) setTimeout(startSupervisor, 5000);
    }
  );

  let n = 0;
  const t = setInterval(async () => {
    if (await checkPort(4500)) { clearInterval(t); statusSupervisor = 'online'; updateTray(); }
    else if (++n > 20) { clearInterval(t); statusSupervisor = 'error'; updateTray(); }
  }, 500);
}

// ── Iniciar Backend Luna (3000) ───────────────────────────────────────────────
async function startLuna() {
  if (await checkPort(3000)) {
    statusLuna = 'online'; updateTray(); return;
  }
  statusLuna = 'starting'; updateTray();

  lunaProc = startProcess(
    'luna-backend', LUNA_SCRIPT, LUNA_DIR,
    { PORT: '3000', NODE_ENV: 'development' },
    code => {
      statusLuna = 'error'; updateTray();
      // Reiniciar após 5s (não em loop imediato)
      if (!app.isQuitting) setTimeout(startLuna, 5000);
    }
  );

  let n = 0;
  const t = setInterval(async () => {
    if (await checkPort(3000)) { clearInterval(t); statusLuna = 'online'; updateTray(); }
    else if (++n > 40) { clearInterval(t); statusLuna = 'error'; updateTray(); }
  }, 500);
}

// ── Painel ────────────────────────────────────────────────────────────────────
function openPanel() {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); return; }
  mainWindow = new BrowserWindow({
    width: 1280, height: 750,
    title: 'Supervisor — Luna Cosméticos',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    show: false,
  });
  mainWindow.loadURL(FRONTEND_URL);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', e => { e.preventDefault(); mainWindow.hide(); });
}

// ── Menu bandeja ──────────────────────────────────────────────────────────────
function updateTray() {
  if (!tray) return;
  tray.setImage(trayIcon());
  tray.setToolTip(`Luna Cosméticos\nSupervisor: ${statusSupervisor} | Backend: ${statusLuna}`);

  const lSup  = { online:'✅ Supervisor (4500) Online', starting:'⏳ Supervisor iniciando...', error:'❌ Supervisor com erro' }[statusSupervisor] || '⬜ Supervisor offline';
  const lLuna = { online:'✅ Backend Luna (3000) Online', starting:'⏳ Backend Luna iniciando...', error:'❌ Backend Luna com erro' }[statusLuna] || '⬜ Backend Luna offline';

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '🌙 Luna Cosméticos — Supervisor', enabled: false },
    { type: 'separator' },
    { label: lSup,  enabled: false },
    { label: lLuna, enabled: false },
    { type: 'separator' },
    { label: '🌐 Abrir Painel de Logs', click: openPanel },
    { label: '📂 Abrir pasta de logs', click: () => shell.openPath(LOG_DIR) },
    { type: 'separator' },
    {
      label: '🔄 Reiniciar Tudo',
      click: async () => {
        if (supervisorProc) supervisorProc.kill();
        if (lunaProc)       lunaProc.kill();
        await new Promise(r => setTimeout(r, 2000));
        startSupervisor(); startLuna();
      }
    },
    {
      label: statusLuna !== 'online' ? '▶ Iniciar Backend Luna' : '🔄 Reiniciar Backend Luna',
      click: async () => { if (lunaProc) lunaProc.kill(); await new Promise(r => setTimeout(r, 1000)); startLuna(); }
    },
    {
      label: statusSupervisor !== 'online' ? '▶ Iniciar Supervisor' : '🔄 Reiniciar Supervisor',
      click: async () => { if (supervisorProc) supervisorProc.kill(); await new Promise(r => setTimeout(r, 1000)); startSupervisor(); }
    },
    { type: 'separator' },
    {
      label: '❌ Encerrar',
      click: () => {
        app.isQuitting = true;
        if (supervisorProc) supervisorProc.kill();
        if (lunaProc)       lunaProc.kill();
        app.quit();
      }
    },
  ]));
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  tray = new Tray(makeIcon('#f59e0b'));
  tray.setToolTip('Luna Cosméticos — Iniciando...');
  tray.on('double-click', openPanel);
  updateTray();
  startSupervisor();
  startLuna();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (supervisorProc) supervisorProc.kill();
  if (lunaProc)       lunaProc.kill();
});

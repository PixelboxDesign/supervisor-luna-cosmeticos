/**
 * Supervisor Luna — Electron Tray App
 * Roda o backend na porta 4500 e fica na bandeja do sistema.
 * Mesmo fechando a janela, continua rodando em segundo plano.
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const { spawn } = require('child_process');
const path      = require('path');
const http      = require('http');
const fs        = require('fs');

// ── Config ────────────────────────────────────────────────────────────────────
const SUPERVISOR_URL  = 'http://localhost:4500';
const FRONTEND_URL    = process.env.FRONTEND_URL || 'https://supervisor-luna.onrender.com';
const BACKEND_DIR     = path.join(__dirname, '..', 'backend');
const NODE_EXEC       = process.execPath; // node.exe do Electron
const SERVER_SCRIPT   = path.join(BACKEND_DIR, 'src', 'server.js');

// ── Estado ────────────────────────────────────────────────────────────────────
let tray        = null;
let mainWindow  = null;
let backendProc = null;
let isRunning   = false;

// Evitar que o app feche quando a janela for fechada
app.on('window-all-closed', e => e.preventDefault());

// ── Ícone ─────────────────────────────────────────────────────────────────────
function getTrayIcon(status) {
  // Ícone inline como PNG 16x16 base64 — substitua por icon.ico em produção
  const color = status === 'online' ? '#22c55e' : status === 'error' ? '#ef4444' : '#f59e0b';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="7" fill="${color}" stroke="white" stroke-width="1.5"/>
    <text x="8" y="12" text-anchor="middle" font-size="9" fill="white" font-weight="bold">L</text>
  </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

// ── Verificar se backend já está rodando ──────────────────────────────────────
function checkBackend() {
  return new Promise(resolve => {
    http.get(`${SUPERVISOR_URL}/health`, res => {
      resolve(res.statusCode === 200);
    }).on('error', () => resolve(false));
  });
}

// ── Iniciar backend ───────────────────────────────────────────────────────────
async function startBackend() {
  const alive = await checkBackend();
  if (alive) {
    console.log('[tray] Backend já está rodando');
    isRunning = true;
    updateTray('online');
    return;
  }

  console.log('[tray] Iniciando backend...');

  // Garantir que node_modules existe
  const nodeModules = path.join(BACKEND_DIR, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    console.log('[tray] Instalando dependências do backend...');
    const install = spawn('npm', ['install'], {
      cwd: BACKEND_DIR, shell: true, stdio: 'inherit'
    });
    await new Promise(r => install.on('close', r));
  }

  backendProc = spawn(NODE_EXEC, [SERVER_SCRIPT], {
    cwd:   BACKEND_DIR,
    shell: false,
    stdio: 'pipe',
    env: {
      ...process.env,
      SUPERVISOR_PORT: '4500',
      LOG_DIR: path.join(BACKEND_DIR, 'logs'),
    }
  });

  backendProc.stdout.on('data', d => console.log('[backend]', d.toString().trim()));
  backendProc.stderr.on('data', d => console.error('[backend]', d.toString().trim()));

  backendProc.on('exit', code => {
    console.log(`[tray] Backend encerrou (code ${code})`);
    isRunning = false;
    updateTray('offline');
    // Reiniciar após 3s se não foi encerramento proposital
    if (code !== 0 && !app.isQuitting) {
      setTimeout(startBackend, 3000);
    }
  });

  // Aguardar o backend subir
  let tentativas = 0;
  const esperar = setInterval(async () => {
    const ok = await checkBackend();
    if (ok) {
      clearInterval(esperar);
      isRunning = true;
      updateTray('online');
      console.log('[tray] Backend online!');
    } else if (++tentativas > 30) {
      clearInterval(esperar);
      updateTray('error');
    }
  }, 500);
}

// ── Janela do painel ──────────────────────────────────────────────────────────
function openPanel() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width:  1200,
    height: 700,
    title:  'Supervisor — Luna Cosméticos',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    icon: getTrayIcon('online'),
    show: false,
  });

  mainWindow.loadURL(FRONTEND_URL);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Fechar janela não encerra o app — volta para bandeja
  mainWindow.on('close', e => {
    e.preventDefault();
    mainWindow.hide();
  });
}

// ── Menu da bandeja ───────────────────────────────────────────────────────────
function updateTray(status) {
  if (!tray) return;

  tray.setImage(getTrayIcon(status));
  tray.setToolTip(`Supervisor Luna — ${status === 'online' ? 'Online ✓' : status === 'error' ? 'Erro!' : 'Offline'}`);

  const menu = Menu.buildFromTemplate([
    {
      label: `Luna Cosméticos — Supervisor`,
      enabled: false,
      icon: getTrayIcon(status),
    },
    { type: 'separator' },
    {
      label: status === 'online' ? '✅ Backend Online (porta 4500)' : status === 'error' ? '❌ Backend com erro' : '⏳ Backend offline',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '🌐 Abrir Painel Web',
      click: openPanel,
    },
    {
      label: '📂 Abrir pasta de logs',
      click: () => shell.openPath(path.join(BACKEND_DIR, 'logs')),
    },
    { type: 'separator' },
    {
      label: status === 'online' ? '🔄 Reiniciar Backend' : '▶ Iniciar Backend',
      click: async () => {
        if (backendProc && !backendProc.killed) backendProc.kill();
        await new Promise(r => setTimeout(r, 1000));
        startBackend();
      },
    },
    { type: 'separator' },
    {
      label: '❌ Encerrar Supervisor',
      click: () => {
        app.isQuitting = true;
        if (backendProc) backendProc.kill();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
}

// ── App ready ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Iniciar na bandeja sem janela
  tray = new Tray(getTrayIcon('offline'));
  tray.setToolTip('Supervisor Luna — Iniciando...');
  tray.on('double-click', openPanel);

  updateTray('offline');
  startBackend();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (backendProc) backendProc.kill();
});

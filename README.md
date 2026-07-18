# Supervisor Luna Cosméticos

Sistema de supervisão de logs em tempo real.

## Arquitetura

```
Frontend (Render) ←→ Backend local (porta 4500) ←→ Logs NDJSON
        ↕                     ↕
    WebSocket           Electron (bandeja)
```

- **Frontend**: React + Vite — deployado no Render
- **Backend**: Node.js Express porta 4500 — roda localmente
- **Electron**: app na bandeja do sistema que gerencia o backend

## Instalação

```bash
# Instalar todas as dependências
cd backend  && npm install
cd frontend && npm install
cd electron && npm install
```

## Iniciar (desenvolvimento)

```bash
# Backend
cd backend && node src/server.js

# Frontend
cd frontend && npm run dev
# Abre em http://localhost:5174
```

## Iniciar (produção local)

Executar `INICIAR_SUPERVISOR.vbs` — inicia o Electron na bandeja sem terminal.

## Variáveis de ambiente

Criar `backend/.env`:
```
SUPERVISOR_PORT=4500
LOG_DIR=./logs
KEEP_ALIVE_URLS=https://gestao-de-trafego-1.onrender.com
```

Configurar no Render (frontend):
```
VITE_SUPERVISOR_URL=https://seu-tunel-publico.ts.net
VITE_SUPERVISOR_WS=wss://seu-tunel-publico.ts.net/ws
```

## Expor o backend publicamente

Use Tailscale Funnel ou ngrok:
```bash
# Tailscale
tailscale funnel 4500

# ngrok
ngrok http 4500
```

Depois atualizar `VITE_SUPERVISOR_URL` e `VITE_SUPERVISOR_WS` no Render.

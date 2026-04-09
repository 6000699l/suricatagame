const WebSocket = require('ws');
const PORT = process.env.PORT || 7777;
const wss = new WebSocket.Server({ port: PORT });

const MAX = 4;
const clients = new Map();   // ws -> { id, name, isHost }
const usedIDs = new Set();
let gameStarted = false;

console.log(`[Relay] Puerto ${PORT}`);

wss.on('connection', ws => {
    let id = -1;
    for (let i = 0; i < MAX; i++) {
        if (!usedIDs.has(i)) { id = i; break; }
    }
    if (id === -1) {
        ws.send(JSON.stringify({ type: 'roomFull' }));
        ws.close();
        return;
    }

    const isHost = clients.size === 0;
    clients.set(ws, { id, name: `P${id+1}`, isHost });
    usedIDs.add(id);
    console.log(`[+] P${id} connected | isHost=${isHost} | total=${clients.size}`);

    ws.send(JSON.stringify({ type: 'welcome', id, isHost }));
    broadcastLobby();

    ws.on('message', raw => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        const info = clients.get(ws);
        if (!info) return;

        msg.from = info.id;

        if (msg.type !== 'input')
            console.log(`[>] ${msg.type} from P${info.id}`);

        switch (msg.type) {
            case 'setName':
                info.name = (msg.name || info.name).slice(0, 20);
                broadcastLobby();
                break;

            case 'startGame':
                if (!info.isHost) break;
                gameStarted = true;
                broadcastAll({ type: 'startGame' });
                console.log('[!] Game started');
                break;

            case 'worldState':
                if (!info.isHost) break;
                // FIX: El worldState lo reciben TODOS menos el host (el ya tiene los datos)
                broadcastExcept(ws, msg);
                break;

            case 'input':
                // FIX: Reenviar al host. Si el emisor ES el host, no tiene sentido
                // (el host procesa sus propios inputs directamente en Update),
                // pero tampoco hace dano ignorarlo.
                if (!info.isHost) {
                    sendToHost(msg);
                }
                break;

            case 'bugEvent':
            case 'scoreEvent':
            case 'powerEvent':
                if (!info.isHost) break;
                broadcastExcept(ws, msg);
                break;

            case 'hostClosed':
                broadcastExcept(ws, { type: 'hostClosed' });
                break;
        }
    });

    ws.on('close', () => {
        const info = clients.get(ws);
        clients.delete(ws);
        if (info) usedIDs.delete(info.id);
        console.log(`[-] P${info?.id} left | total=${clients.size}`);

        if (info?.isHost && clients.size > 0) {
            // FIX: Promover al siguiente cliente de forma segura
            const nextEntry = clients.entries().next();
            if (!nextEntry.done) {
                const [newWs, newInfo] = nextEntry.value;
                newInfo.isHost = true;
                newWs.send(JSON.stringify({ type: 'promotedToHost' }));
                console.log(`[!] P${newInfo.id} promovido a host`);
            }
        }

        if (clients.size === 0) {
            gameStarted = false;
            usedIDs.clear();
            console.log('[!] Room empty — reset');
        }
        broadcastLobby();
    });

    ws.on('error', e => console.error(`[!] P${clients.get(ws)?.id} error:`, e.message));
});

// FIX: sendToHost ya NO excluye ningun ws en particular —
// simplemente busca quien tiene isHost=true
function sendToHost(msg) {
    const data = JSON.stringify(msg);
    for (const [ws, info] of clients) {
        if (info.isHost && ws.readyState === WebSocket.OPEN) {
            ws.send(data);
            return;
        }
    }
}

function broadcastAll(obj) {
    const d = JSON.stringify(obj);
    for (const ws of clients.keys())
        if (ws.readyState === WebSocket.OPEN) ws.send(d);
}

function broadcastExcept(skip, obj) {
    const d = JSON.stringify(obj);
    for (const ws of clients.keys())
        if (ws !== skip && ws.readyState === WebSocket.OPEN) ws.send(d);
}

function broadcastLobby() {
    const players = [...clients.values()].map(i => ({
        id: i.id, name: i.name, isHost: i.isHost
    }));
    broadcastAll({ type: 'lobby', players, gameStarted });
}

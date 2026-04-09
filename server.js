const WebSocket = require('ws');
const PORT = process.env.PORT || 7777;
const wss = new WebSocket.Server({ port: PORT });

const MAX = 4;
const clients = new Map();  // ws -> { id, name, isHost }
const usedIDs = new Set();
let gameStarted = false;

console.log(`[Relay] Puerto ${PORT}`);

wss.on('connection', ws => {
    // Asigna ID mas bajo libre
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

    // Informa al nuevo quien es
    ws.send(JSON.stringify({ type: 'welcome', id, isHost }));
    broadcastLobby();

    ws.on('message', raw => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        const info = clients.get(ws);
        if (!info) return;

        // Siempre inyecta el ID real del emisor
        msg.from = info.id;

        if (msg.type !== 'input') // no loguear inputs (muy frecuentes)
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

            // El host envia el estado del mundo a todos los clientes
            case 'worldState':
                if (!info.isHost) break;  // solo el host puede enviar worldState
                broadcastExcept(ws, msg);
                break;

            // Un cliente envia su input al host
            case 'input':
                // Reenviar solo al host
                sendToHost(msg, ws);
                break;

            // Eventos puntuales: bichos, poderes, puntos
            case 'bugEvent':
            case 'scoreEvent':
            case 'powerEvent':
                if (!info.isHost) break;  // solo el host emite eventos autoritativos
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
            const [newWs, newInfo] = clients.entries().next().value;
            newInfo.isHost = true;
            newWs.send(JSON.stringify({ type: 'promotedToHost' }));
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

function sendToHost(msg, senderWs) {
    for (const [ws, info] of clients) {
        if (info.isHost && ws !== senderWs && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
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
    const players = [...clients.values()].map(i => ({ id: i.id, name: i.name, isHost: i.isHost }));
    broadcastAll({ type: 'lobby', players, gameStarted });
}

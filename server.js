const WebSocket = require('ws');

const PORT = process.env.PORT || 7777;
const wss  = new WebSocket.Server({ port: PORT });

// Sala unica de 4 jugadores
// clients: Map<ws, { id, name, isHost }>
const clients = new Map();
let   nextID  = 0;
let   gameStarted = false;

console.log(`[Relay] Servidor iniciado en puerto ${PORT}`);

wss.on('connection', (ws) => {
    const id = nextID++;
    clients.set(ws, { id, name: `Player${id}`, isHost: clients.size === 0 });
    console.log(`[Relay] Conexion entrante — asignado ID ${id} | total: ${clients.size}`);

    // Notifica al nuevo cliente su ID y si es host
    send(ws, { type: 'assigned', id, isHost: clients.get(ws).isHost });

    // Notifica a todos el estado de la sala
    broadcastLobby();

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); }
        catch { return; }

        const sender = clients.get(ws);
        if (!sender) return;

        switch (msg.type) {
            // El cliente manda su nombre
            case 'setName':
                sender.name = msg.name || sender.name;
                broadcastLobby();
                break;

            // Host inicia la partida
            case 'startGame':
                if (!sender.isHost) break;
                gameStarted = true;
                broadcast({ type: 'startGame', timestamp: Date.now() });
                console.log('[Relay] Partida iniciada por el host.');
                break;

            // Estado del jugador -> rebroadcast a todos los demas
            case 'playerState':
                msg.senderID = sender.id;
                broadcastExcept(ws, msg);
                break;

            // Eventos de juego -> rebroadcast a todos
            case 'bugPickedUp':
            case 'bugDelivered':
            case 'scoreUpdate':
            case 'powerUsed':
            case 'eagleState':
            case 'gameOver':
                msg.senderID = sender.id;
                broadcastExcept(ws, msg);
                break;

            // El host hace broadcast autoritativo del WorldSnapshot
            case 'worldSnapshot':
                if (!sender.isHost) break;
                broadcastExcept(ws, msg);
                break;

            default:
                // Rebroadcast generico para mensajes desconocidos
                broadcastExcept(ws, msg);
        }
    });

    ws.on('close', () => {
        const info = clients.get(ws);
        clients.delete(ws);
        console.log(`[Relay] P${info?.id} desconectado | quedan: ${clients.size}`);

        // Si el host se fue, el siguiente cliente pasa a ser host
        if (info?.isHost && clients.size > 0) {
            const [newHostWs, newHostInfo] = clients.entries().next().value;
            newHostInfo.isHost = true;
            send(newHostWs, { type: 'promotedToHost' });
            console.log(`[Relay] P${newHostInfo.id} promovido a host.`);
        }

        broadcastLobby();
    });

    ws.on('error', (err) => {
        console.error(`[Relay] Error en P${clients.get(ws)?.id}: ${err.message}`);
    });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function send(ws, obj) {
    if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify(obj));
}

function broadcast(obj) {
    const data = JSON.stringify(obj);
    for (const ws of clients.keys())
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

function broadcastExcept(excludeWs, obj) {
    const data = JSON.stringify(obj);
    for (const ws of clients.keys())
        if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) ws.send(data);
}

function broadcastLobby() {
    const players = [];
    for (const [, info] of clients)
        players.push({ id: info.id, name: info.name, isHost: info.isHost });

    broadcast({ type: 'lobbyState', players, gameStarted });
}

const WebSocket = require('ws');

const PORT = process.env.PORT || 7777;
const wss  = new WebSocket.Server({ port: PORT });

const clients  = new Map();   // ws -> { id, name, isHost }
let   nextID   = 0;
let   gameStarted = false;

console.log(`[Relay] Iniciado en puerto ${PORT}`);

wss.on('connection', (ws) => {
    const id     = nextID++;
    const isHost = clients.size === 0;
    clients.set(ws, { id, name: `Jugador${id + 1}`, isHost });

    console.log(`[Relay] Conexion ID=${id} isHost=${isHost} | total=${clients.size}`);

    // Informa al nuevo cliente su ID
    send(ws, { type: 'assigned', id, isHost });

    // Informa a TODOS el estado de la sala
    broadcastLobby();

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); }
        catch (e) { console.error('[Relay] JSON invalido:', raw); return; }

        const sender = clients.get(ws);
        if (!sender) return;

        // Log de todos los mensajes para debug
        if (msg.type !== 'playerState' && msg.type !== 'eagleState')
            console.log(`[Relay] ${msg.type} de P${sender.id}`);

        switch (msg.type) {

            case 'setName':
                sender.name = msg.name || sender.name;
                broadcastLobby();
                break;

            case 'startGame':
                if (!sender.isHost) break;
                gameStarted = true;
                // Envia a TODOS incluyendo al host
                broadcastAll({ type: 'startGame', timestamp: Date.now() });
                console.log('[Relay] startGame broadcast a todos');
                break;

            // Estado del jugador -> rebroadcast a TODOS los demas
            case 'playerState':
                msg.senderID = sender.id;
                broadcastExcept(ws, msg);
                break;

            // Eventos de juego -> rebroadcast a TODOS los demas
            case 'bugPickedUp':
            case 'bugDelivered':
            case 'scoreUpdate':
            case 'eagleState':
            case 'hostClosed':
            case 'gameOver':
                msg.senderID = sender.id;
                broadcastExcept(ws, msg);
                break;

            // Escorpion -> solo al jugador objetivo, NO al que lo lanzo
            case 'powerUsed':
                msg.senderID = sender.id;
                // El relay rebroadcast a todos menos al emisor
                // El cliente ignora los poderes con senderID == su propio ID
                broadcastExcept(ws, msg);
                break;

            default:
                broadcastExcept(ws, msg);
        }
    });

    ws.on('close', () => {
        const info = clients.get(ws);
        clients.delete(ws);
        console.log(`[Relay] P${info?.id} desconectado | quedan=${clients.size}`);

        // Si el host se fue, promueve al siguiente
        if (info?.isHost && clients.size > 0) {
            const [newWs, newInfo] = clients.entries().next().value;
            newInfo.isHost = true;
            send(newWs, { type: 'promotedToHost' });
            console.log(`[Relay] P${newInfo.id} promovido a host`);
        }
        broadcastLobby();
    });

    ws.on('error', (err) => {
        console.error(`[Relay] Error P${clients.get(ws)?.id}:`, err.message);
    });
});

function send(ws, obj) {
    if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify(obj));
}

function broadcastAll(obj) {
    const data = JSON.stringify(obj);
    for (const ws of clients.keys())
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

function broadcastExcept(excludeWs, obj) {
    const data = JSON.stringify(obj);
    for (const ws of clients.keys())
        if (ws !== excludeWs && ws.readyState === WebSocket.OPEN)
            ws.send(data);
}

function broadcastLobby() {
    const players = [];
    for (const [, info] of clients)
        players.push({ id: info.id, name: info.name, isHost: info.isHost });
    broadcastAll({ type: 'lobbyState', players, gameStarted });
}

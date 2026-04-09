const WebSocket = require('ws');
const PORT = process.env.PORT || 7777;
const wss  = new WebSocket.Server({ port: PORT });

// IDs disponibles: 0,1,2,3 — se reusan cuando alguien se desconecta
const MAX_PLAYERS = 4;
let room = {
    clients:     new Map(),   // ws -> { id, name, isHost }
    usedIDs:     new Set(),   // IDs actualmente en uso
    gameStarted: false,
};

console.log(`[Relay] Puerto ${PORT}`);

wss.on('connection', (ws) => {
    // Asigna el ID mas bajo disponible (0,1,2,3)
    let id = -1;
    for (let i = 0; i < MAX_PLAYERS; i++) {
        if (!room.usedIDs.has(i)) { id = i; break; }
    }

    if (id === -1) {
        console.log('[Relay] Sala llena — rechazando conexion');
        ws.send(JSON.stringify({ type: 'roomFull' }));
        ws.close();
        return;
    }

    const isHost = room.clients.size === 0;
    room.usedIDs.add(id);
    room.clients.set(ws, { id, name: `Jugador${id+1}`, isHost });

    console.log(`[+] P${id} conectado | isHost=${isHost} | sala=${room.clients.size}`);

    send(ws, { type: 'assigned', id, isHost });
    broadcastLobby();

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        const info = room.clients.get(ws);
        if (!info) return;

        // El servidor inyecta el senderID real — el cliente no puede falsificarlo
        msg.senderID = info.id;

        if (msg.type !== 'playerState' && msg.type !== 'eagleState')
            console.log(`[>] ${msg.type} de P${info.id} | ${JSON.stringify(msg).substring(0,120)}`);

        switch (msg.type) {
            case 'setName':
                info.name = (msg.name || info.name).substring(0, 20);
                broadcastLobby();
                break;

            case 'startGame':
                if (!info.isHost) break;
                room.gameStarted = true;
                broadcastAll({ type: 'startGame', timestamp: Date.now() });
                console.log('[!] Partida iniciada');
                break;

            case 'playerState':
            case 'bugPickedUp':
            case 'bugDelivered':
            case 'scoreUpdate':
            case 'eagleState':
            case 'powerUsed':
            case 'hostClosed':
            case 'gameOver':
                broadcastExcept(ws, msg);
                break;

            default:
                broadcastExcept(ws, msg);
        }
    });

    ws.on('close', () => {
        const info = room.clients.get(ws);
        room.clients.delete(ws);
        if (info) room.usedIDs.delete(info.id);  // libera el ID para reutilizar
        console.log(`[-] P${info?.id} desconectado | sala=${room.clients.size}`);

        if (info?.isHost && room.clients.size > 0) {
            const [newWs, newInfo] = room.clients.entries().next().value;
            newInfo.isHost = true;
            send(newWs, { type: 'promotedToHost' });
            console.log(`[!] P${newInfo.id} ahora es host`);
        }

        // Si la sala queda vacia, resetea el estado del juego
        if (room.clients.size === 0) {
            room.gameStarted = false;
            console.log('[!] Sala vacia — reset');
        }

        broadcastLobby();
    });

    ws.on('error', (e) => console.error(`[!] Error P${room.clients.get(ws)?.id}:`, e.message));
});

function send(ws, obj) {
    if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify(obj));
}

function broadcastAll(obj) {
    const d = JSON.stringify(obj);
    for (const ws of room.clients.keys())
        if (ws.readyState === WebSocket.OPEN) ws.send(d);
}

function broadcastExcept(skip, obj) {
    const d = JSON.stringify(obj);
    for (const ws of room.clients.keys())
        if (ws !== skip && ws.readyState === WebSocket.OPEN) ws.send(d);
}

function broadcastLobby() {
    const players = [];
    for (const [, i] of room.clients)
        players.push({ id: i.id, name: i.name, isHost: i.isHost });
    broadcastAll({ type: 'lobbyState', players, gameStarted: room.gameStarted });
}

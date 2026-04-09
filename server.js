const WebSocket = require('ws');
const PORT = process.env.PORT || 7777;
const wss  = new WebSocket.Server({ port: PORT });

// Una sola sala global
const room = {
    clients:     new Map(),   // ws -> { id, name, isHost }
    nextID:      0,
    gameStarted: false,
};

console.log(`[Relay] Puerto ${PORT}`);

wss.on('connection', (ws) => {
    const id     = room.nextID++;
    const isHost = room.clients.size === 0;
    room.clients.set(ws, { id, name: `Jugador${id+1}`, isHost });

    console.log(`[+] P${id} conectado | isHost=${isHost} | sala=${room.clients.size}`);

    // 1. Dile al nuevo cliente quién es
    send(ws, { type:'assigned', id, isHost });

    // 2. Dile a todos el estado actual de la sala
    broadcastLobby();

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); }
        catch { return; }

        const info = room.clients.get(ws);
        if (!info) return;

        // Inyecta el senderID real siempre — el cliente no puede falsificarlo
        msg.senderID = info.id;

        if (msg.type !== 'playerState' && msg.type !== 'eagleState')
            console.log(`[>] ${msg.type} de P${info.id}`);

        switch (msg.type) {

            case 'setName':
                info.name = (msg.name || info.name).substring(0, 20);
                broadcastLobby();
                break;

            case 'startGame':
                if (!info.isHost) break;
                room.gameStarted = true;
                // Envia a TODOS (incluyendo host) para sincronizar arranque
                broadcastAll({ type:'startGame', timestamp: Date.now() });
                console.log('[!] Partida iniciada');
                break;

            // playerState: rebroadcast a TODOS menos al emisor
            // El campo senderID ya fue inyectado arriba
            case 'playerState':
                broadcastExcept(ws, msg);
                break;

            // Todos los eventos de juego: rebroadcast a los demás
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
        console.log(`[-] P${info?.id} desconectado | sala=${room.clients.size}`);

        if (info?.isHost && room.clients.size > 0) {
            const [newWs, newInfo] = room.clients.entries().next().value;
            newInfo.isHost = true;
            send(newWs, { type:'promotedToHost' });
            console.log(`[!] P${newInfo.id} ahora es host`);
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
        players.push({ id:i.id, name:i.name, isHost:i.isHost });
    broadcastAll({ type:'lobbyState', players, gameStarted: room.gameStarted });
}

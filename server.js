const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const socketToRoom = {};

function generateRoomId() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Create Game
    socket.on('createGame', () => {
        const roomId = generateRoomId();
        rooms[roomId] = {
            players: [socket.id],
            boards: {},
            ready: {},
            turn: socket.id
        };
        socketToRoom[socket.id] = roomId;
        socket.join(roomId);
        socket.emit('gameCreated', roomId);
    });

    // Join Game
    socket.on('joinGame', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players.length < 2) {
            room.players.push(socket.id);
            socketToRoom[socket.id] = roomId;
            socket.join(roomId);
            io.to(roomId).emit('playerJoined');
        } else {
            socket.emit('error', 'Room not found or full');
        }
    });

    // Player Ready
    socket.on('playerReady', ({ roomId, board }) => {
        const room = rooms[roomId];
        if (!room) return;

        room.boards[socket.id] = board;
        room.ready[socket.id] = true;

        if (Object.keys(room.ready).length === 2) {
            io.to(roomId).emit('gameStart', { turn: room.turn });
        }
    });

    // Shoot
    socket.on('shoot', ({ roomId, x, y }) => {
        const room = rooms[roomId];
        if (!room || room.turn !== socket.id) return;

        const opponentId = room.players.find(id => id !== socket.id);
        const opponentBoard = room.boards[opponentId];

        // Values: 0=Empty, 1=Ship, 2=Miss, 3=Hit, 4=Sunk
        const cellValue = opponentBoard[y][x];
        let hit = false;
        let sunkData = null;

        if (cellValue === 1) {
            // HIT LOGIC
            opponentBoard[y][x] = 3; // Mark as HIT
            hit = true;

            // Check if this hit sunk the ship
            sunkData = checkSunkenShip(opponentBoard, x, y);

            if (sunkData.isSunk) {
                // Update server state to SUNK (4)
                sunkData.shipCoords.forEach(c => {
                    opponentBoard[c.y][c.x] = 4;
                });
                // Update server state for Halo (Misses around)
                sunkData.surroundCoords.forEach(c => {
                    if (opponentBoard[c.y][c.x] === 0) {
                        opponentBoard[c.y][c.x] = 2;
                    }
                });
            }
        } else if (cellValue === 0 || cellValue === 2) {
            // MISS LOGIC
            opponentBoard[y][x] = 2;
            room.turn = opponentId; // Switch turn
        } else {
            // Already hit/sunk, ignore click
            return;
        }

        // 1. Send immediate shot result (Hit/Miss)
        io.to(roomId).emit('shotResult', {
            shooter: socket.id,
            x, y, hit,
            nextTurn: room.turn
        });

        // 2. If sunk, send specific event to repaint cells RED and draw Halo
        if (sunkData && sunkData.isSunk) {
            io.to(roomId).emit('shipSunk', {
                victim: opponentId,
                shipCoords: sunkData.shipCoords,
                surroundCoords: sunkData.surroundCoords
            });
        }

        // Check Victory
        const hasShips = opponentBoard.flat().some(val => val === 1); // Check for any '1' left
        if (!hasShips) {
            io.to(roomId).emit('gameOver', { winner: socket.id });
            cleanUpRoom(roomId);
        }
    });

    socket.on('leaveGame', (roomId) => {
        handleDisconnect(socket.id, roomId);
    });

    socket.on('disconnect', () => {
        const roomId = socketToRoom[socket.id];
        if (roomId) {
            handleDisconnect(socket.id, roomId);
        }
    });

    function handleDisconnect(loserId, roomId) {
        const room = rooms[roomId];
        if (room) {
            const winnerId = room.players.find(id => id !== loserId);
            if (winnerId) {
                io.to(roomId).emit('gameOver', { 
                    winner: winnerId, 
                    reason: 'disconnect' 
                });
            }
            cleanUpRoom(roomId);
        }
    }

    function cleanUpRoom(roomId) {
        const room = rooms[roomId];
        if (room) {
            room.players.forEach(pid => delete socketToRoom[pid]);
            delete rooms[roomId];
        }
    }
});

// === ROBUST ALGORITHM FOR SUNK CHECK ===
function checkSunkenShip(board, startX, startY) {
    let shipCoords = [];
    let stack = [{x: startX, y: startY}];
    let visited = new Set();
    visited.add(`${startX},${startY}`);
    
    let isSunk = true;

    // 1. Find all connected parts of the ship
    while (stack.length > 0) {
        const {x, y} = stack.pop();
        shipCoords.push({x, y});

        const dirs = [[0,1], [0,-1], [1,0], [-1,0]];
        
        for (let [dx, dy] of dirs) {
            const nx = x + dx;
            const ny = y + dy;
            
            if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10) {
                const val = board[ny][nx];
                const key = `${nx},${ny}`;

                if (!visited.has(key)) {
                    // If we find an intact part (1), the ship is NOT sunk.
                    if (val === 1) {
                        isSunk = false;
                        // Important: We continue traversing to ensure we don't miss logic, 
                        // but strictly speaking we could return early. 
                        // For this implementation, we simply flag it.
                    }
                    
                    // If we find a HIT part (3) or Intact part (1), it belongs to the ship.
                    if (val === 1 || val === 3) {
                        visited.add(key);
                        stack.push({x: nx, y: ny});
                    }
                }
            }
        }
    }

    if (!isSunk) {
        return { isSunk: false, shipCoords: [], surroundCoords: [] };
    }

    // 2. If Sunk, calculate the Halo (cells around the ship)
    let surroundCoords = [];
    let shipSet = new Set(shipCoords.map(c => `${c.x},${c.y}`));

    shipCoords.forEach(({x, y}) => {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                
                if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10) {
                    // If it's not part of the ship itself, add to surround
                    if (!shipSet.has(`${nx},${ny}`)) {
                        // Avoid duplicates
                        if (!surroundCoords.some(c => c.x === nx && c.y === ny)) {
                            surroundCoords.push({x: nx, y: ny});
                        }
                    }
                }
            }
        }
    });

    return { isSunk: true, shipCoords, surroundCoords };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
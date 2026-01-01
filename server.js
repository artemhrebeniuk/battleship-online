const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Роздаємо статику з папки public
app.use(express.static(path.join(__dirname, 'public')));

// Зберігання стану кімнат
const rooms = {};
// Допоміжна мапа: socketId -> roomId
const socketToRoom = {};

function generateRoomId() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

io.on('connection', (socket) => {
    console.log('Користувач підключився:', socket.id);

    // Створення гри
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

    // Приєднання до гри
    socket.on('joinGame', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players.length < 2) {
            room.players.push(socket.id);
            socketToRoom[socket.id] = roomId;
            socket.join(roomId);
            io.to(roomId).emit('playerJoined');
        } else {
            socket.emit('error', 'Кімната не знайдена або переповнена');
        }
    });

    // Готовність
    socket.on('playerReady', ({ roomId, board }) => {
        const room = rooms[roomId];
        if (!room) return;

        room.boards[socket.id] = board;
        room.ready[socket.id] = true;

        if (Object.keys(room.ready).length === 2) {
            io.to(roomId).emit('gameStart', { turn: room.turn });
        }
    });

    // Постріл
    socket.on('shoot', ({ roomId, x, y }) => {
        const room = rooms[roomId];
        if (!room || room.turn !== socket.id) return;

        const opponentId = room.players.find(id => id !== socket.id);
        const opponentBoard = room.boards[opponentId];

        let hit = false;
        if (opponentBoard[y][x] === 1) {
            opponentBoard[y][x] = 3;
            hit = true;
        } else if (opponentBoard[y][x] === 0) {
            opponentBoard[y][x] = 2;
            room.turn = opponentId;
        }

        io.to(roomId).emit('shotResult', {
            shooter: socket.id,
            x, y, hit,
            nextTurn: room.turn
        });

        // Перевірка перемоги
        const hasShips = opponentBoard.flat().includes(1);
        if (!hasShips) {
            io.to(roomId).emit('gameOver', { winner: socket.id });
            cleanUpRoom(roomId);
        }
    });

    // Гравець натиснув "Здатися"
    socket.on('leaveGame', (roomId) => {
        handleDisconnect(socket.id, roomId);
    });

    // Гравець закрив вкладку або перезавантажив сторінку
    socket.on('disconnect', () => {
        const roomId = socketToRoom[socket.id];
        if (roomId) {
            handleDisconnect(socket.id, roomId);
        }
    });

    // Універсальна функція обробки виходу
    function handleDisconnect(loserId, roomId) {
        const room = rooms[roomId];
        if (room) {
            // Знаходимо ID іншого гравця (переможця)
            const winnerId = room.players.find(id => id !== loserId);
            io.to(roomId).emit('gameOver', { 
                winner: winnerId, 
                reason: 'disconnect' 
            });

            // Очищаємо кімнату
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущено на порту ${PORT}`));
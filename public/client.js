const socket = io();

// Елементи DOM
const screens = {
    menu: document.getElementById('menu-screen'),
    lobby: document.getElementById('lobby-screen'),
    setup: document.getElementById('setup-screen'),
    game: document.getElementById('game-screen')
};

// Стан гри
let currentRoomId = null;
let myBoard = [];
let isVertical = false;
let myTurn = false;

// Конфігурація кораблів
const shipsConfig = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
let shipsToPlace = [];

// === Утиліти та UI ===
function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    screens[name].classList.remove('hidden');
}

function showToast(msg, type = 'info') {
    const container = document.getElementById('notification-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showModal(title, message) {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-message').innerText = message;
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function initBoard() {
    return Array(10).fill().map(() => Array(10).fill(0));
}

// === Меню та Лобі ===
document.getElementById('btn-create').addEventListener('click', () => {
    socket.emit('createGame');
});

document.getElementById('btn-join').addEventListener('click', () => {
    const code = document.getElementById('room-code-input').value;
    if (code.length === 6) {
        socket.emit('joinGame', code);
    } else {
        showToast('Введіть коректний код (6 цифр)', 'error');
    }
});

socket.on('gameCreated', (roomId) => {
    currentRoomId = roomId;
    document.getElementById('display-room-code').innerText = roomId;
    showScreen('lobby');
    showToast('Гру створено! Чекаємо на гравця.', 'success');
});

socket.on('playerJoined', () => {
    currentRoomId = currentRoomId || document.getElementById('room-code-input').value;
    showToast('Гравець підключився!', 'success');
    startSetupPhase();
});

socket.on('error', (msg) => showToast(msg, 'error'));

// === Розстановка ===
function startSetupPhase() {
    myBoard = initBoard();
    shipsToPlace = [...shipsConfig];
    showScreen('setup');
    renderSetupBoard();
    updateSetupStatus();
}

function updateSetupStatus() {
    const btn = document.getElementById('btn-start-game');
    const msg = document.getElementById('setup-msg');
    
    if (shipsToPlace.length > 0) {
        const size = shipsToPlace[0];
        msg.innerText = `Розмістіть корабель: ${size} кл. (${isVertical ? 'Вертикально' : 'Горизонтально'})`;
        btn.disabled = true;
    } else {
        msg.innerText = 'Флот готовий до бою!';
        btn.disabled = false;
    }
}

const rotateShip = () => {
    isVertical = !isVertical;
    updateSetupStatus();
};
document.getElementById('btn-rotate').addEventListener('click', rotateShip);
document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR' && !screens.setup.classList.contains('hidden')) {
        rotateShip();
    }
});

function renderSetupBoard() {
    const boardEl = document.getElementById('setup-board');
    boardEl.innerHTML = '';
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.x = x;
            cell.dataset.y = y;
            if (myBoard[y][x] === 1) cell.classList.add('ship');
            
            cell.addEventListener('mouseenter', () => showShipPreview(x, y));
            cell.addEventListener('mouseleave', () => clearShipPreview());
            cell.addEventListener('click', () => placeShipManually(x, y));
            
            boardEl.appendChild(cell);
        }
    }
}

function showShipPreview(x, y) {
    if (shipsToPlace.length === 0) return;
    const size = shipsToPlace[0];
    const allowed = canPlaceShip(myBoard, x, y, size, isVertical);
    const className = allowed ? 'preview-valid' : 'preview-invalid';
    for (let i = 0; i < size; i++) {
        let cx = x + (isVertical ? 0 : i);
        let cy = y + (isVertical ? i : 0);
        if (cx < 10 && cy < 10) {
            const cell = document.querySelector(`#setup-board .cell[data-x='${cx}'][data-y='${cy}']`);
            if (cell) cell.classList.add(className);
        }
    }
}

function clearShipPreview() {
    document.querySelectorAll('.preview-valid, .preview-invalid')
        .forEach(el => el.classList.remove('preview-valid', 'preview-invalid'));
}

function placeShipManually(x, y) {
    if (shipsToPlace.length === 0) return;
    const size = shipsToPlace[0];
    if (canPlaceShip(myBoard, x, y, size, isVertical)) {
        placeShip(myBoard, x, y, size, isVertical);
        shipsToPlace.shift();
        renderSetupBoard();
        updateSetupStatus();
    } else {
        showToast('Неможливо поставити корабель тут!', 'error');
    }
}

function isValid(x, y) { return x >= 0 && x < 10 && y >= 0 && y < 10; }

function canPlaceShip(board, x, y, size, vertical) {
    for (let i = 0; i < size; i++) {
        let cx = x + (vertical ? 0 : i);
        let cy = y + (vertical ? i : 0);
        if (!isValid(cx, cy) || board[cy][cx] !== 0) return false;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                let nx = cx + dx, ny = cy + dy;
                if (isValid(nx, ny) && board[ny][nx] !== 0) return false;
            }
        }
    }
    return true;
}

function placeShip(board, x, y, size, vertical) {
    for (let i = 0; i < size; i++) {
        board[y + (vertical ? i : 0)][x + (vertical ? 0 : i)] = 1;
    }
}

document.getElementById('btn-random').addEventListener('click', () => {
    myBoard = initBoard();
    const tempShips = [...shipsConfig];
    tempShips.forEach(size => {
        let placed = false;
        while (!placed) {
            let x = Math.floor(Math.random() * 10);
            let y = Math.floor(Math.random() * 10);
            let vert = Math.random() > 0.5;
            if (canPlaceShip(myBoard, x, y, size, vert)) {
                placeShip(myBoard, x, y, size, vert);
                placed = true;
            }
        }
    });
    shipsToPlace = [];
    renderSetupBoard();
    updateSetupStatus();
});

document.getElementById('btn-start-game').addEventListener('click', () => {
    socket.emit('playerReady', { roomId: currentRoomId, board: myBoard });
    document.getElementById('btn-start-game').innerText = 'Чекаємо суперника...';
    document.getElementById('btn-start-game').disabled = true;
    document.getElementById('setup-board').style.pointerEvents = 'none';
});

// === Гра ===
socket.on('gameStart', ({ turn }) => {
    showScreen('game');
    myTurn = (turn === socket.id);
    updateGameStatus();
    renderGameBoards();
    showToast('Бій почався!', 'success');
});

function updateGameStatus() {
    const statusEl = document.getElementById('game-status');
    if (myTurn) {
        statusEl.innerText = "ВАШ ХІД! Вогонь!";
        statusEl.style.color = "#28a745";
    } else {
        statusEl.innerText = "Хід суперника...";
        statusEl.style.color = "#dc3545";
    }
}

let myShotsMap = initBoard();

function renderGameBoards() {
    const myBoardEl = document.getElementById('my-board');
    myBoardEl.innerHTML = '';
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            const val = myBoard[y][x];
            if (val === 1) cell.classList.add('ship'); 
            if (val === 2) cell.classList.add('miss');
            if (val === 3) cell.classList.add('hit');
            myBoardEl.appendChild(cell);
        }
    }

    const enemyBoardEl = document.getElementById('enemy-board');
    enemyBoardEl.innerHTML = '';
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            const val = myShotsMap[y][x];
            if (val === 2) cell.classList.add('miss');
            if (val === 3) cell.classList.add('hit');
            
            cell.addEventListener('click', () => {
                if (myTurn && val === 0) {
                    socket.emit('shoot', { roomId: currentRoomId, x, y });
                } else if (!myTurn) {
                    showToast('Зараз не ваш хід!', 'error');
                }
            });
            enemyBoardEl.appendChild(cell);
        }
    }
}

socket.on('shotResult', ({ shooter, x, y, hit, nextTurn }) => {
    const isMe = shooter === socket.id;
    if (isMe) {
        myShotsMap[y][x] = hit ? 3 : 2;
        if (hit) showToast('Влучив!', 'success');
        else showToast('Мимо...', 'info');
    } else {
        myBoard[y][x] = hit ? 3 : 2;
        if (hit) showToast('У нас влучили!', 'error');
    }
    renderGameBoards();
    myTurn = (nextTurn === socket.id);
    updateGameStatus();
});

// КІНЕЦЬ ГРИ
socket.on('gameOver', ({ winner, reason }) => {
    let title = (winner === socket.id) ? '🏆 ПЕРЕМОГА!' : '💀 ПОРАЗКА!';
    let msg = (winner === socket.id) ? 'Ви знищили ворожий флот!' : 'Ваш флот потоплено.';
    
    if (reason === 'disconnect') {
        msg = (winner === socket.id) 
            ? 'Супротивник здався або відключився. \nВи перемогли!' 
            : 'Ви залишили гру.';
    }
    
    showModal(title, msg);
});

document.getElementById('btn-leave').addEventListener('click', () => {
    if (confirm('Ви впевнені, що хочете здатися? Це зарахує вам поразку.')) {
        socket.emit('leaveGame', currentRoomId);
    }
});
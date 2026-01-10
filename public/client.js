const socket = io();

// DOM Elements
const screens = {
    menu: document.getElementById('menu-screen'),
    lobby: document.getElementById('lobby-screen'),
    setup: document.getElementById('setup-screen'),
    game: document.getElementById('game-screen')
};

// --- THEME LOGIC ---
const themeBtn = document.getElementById('btn-theme-toggle');
const body = document.body;

// Load saved theme
if (localStorage.getItem('theme') === 'dark') {
    body.classList.add('dark-mode');
    themeBtn.innerText = '☀️';
} else {
    themeBtn.innerText = '🌙';
}

themeBtn.addEventListener('click', () => {
    body.classList.toggle('dark-mode');
    if (body.classList.contains('dark-mode')) {
        themeBtn.innerText = '☀️';
        localStorage.setItem('theme', 'dark');
    } else {
        themeBtn.innerText = '🌙';
        localStorage.setItem('theme', 'light');
    }
});
// -------------------

// Game State
let currentRoomId = null;
let myBoard = [];
let isVertical = false;
let myTurn = false;
let isSetupPhase = false;

// Selection State for Mobile
let selectedCell = { x: -1, y: -1 };

// Ships Config
const shipsConfig = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
let shipsToPlace = [];

// Values: 0=Unknown, 2=Miss, 3=Hit, 4=Sunk
let myShotsMap = initBoard(); 

// === Utils & UI ===
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
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// UPDATED MODAL FUNCTION
function showModal(type, title, message) {
    const modalBox = document.getElementById('modal-content-box');
    const modalIcon = document.getElementById('modal-icon-container');
    const modalBtn = document.getElementById('modal-btn');

    // Reset classes
    modalBox.classList.remove('modal-victory', 'modal-defeat');
    
    if (type === 'victory') {
        modalBox.classList.add('modal-victory');
        modalIcon.innerText = '🏆';
        modalBtn.className = 'glow-element'; // Greenish styling from css logic or default blue
    } else {
        modalBox.classList.add('modal-defeat');
        modalIcon.innerText = '💀';
        modalBtn.className = 'danger-btn'; // Red style
    }

    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-message').innerText = message;
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function initBoard() {
    return Array(10).fill().map(() => Array(10).fill(0));
}

// === Menu & Lobby ===
document.getElementById('btn-create').addEventListener('click', () => {
    socket.emit('createGame');
});

document.getElementById('btn-join').addEventListener('click', () => {
    const code = document.getElementById('room-code-input').value;
    if (code.length === 6) {
        socket.emit('joinGame', code);
    } else {
        showToast('Please enter a valid 6-digit code', 'error');
    }
});

document.getElementById('btn-back-menu').addEventListener('click', () => {
    location.reload();
});

socket.on('gameCreated', (roomId) => {
    currentRoomId = roomId;
    document.getElementById('display-room-code').innerText = roomId;
    showScreen('lobby');
    showToast('Game created! Waiting for player...', 'success');
});

socket.on('playerJoined', () => {
    currentRoomId = currentRoomId || document.getElementById('room-code-input').value;
    showToast('Player connected!', 'success');
    startSetupPhase();
});

socket.on('error', (msg) => showToast(msg, 'error'));

// === Setup Phase ===
function startSetupPhase() {
    isSetupPhase = true;
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
        msg.innerText = `Place Ship: Size ${size} (${isVertical ? 'Vertical' : 'Horizontal'})`;
        btn.disabled = true;
        btn.classList.add('secondary-btn');
    } else {
        msg.innerText = 'Fleet Ready!';
        btn.disabled = false;
        btn.classList.remove('secondary-btn');
        btn.innerText = "BATTLE!";
    }
}

const rotateShip = () => {
    isVertical = !isVertical;
    if (selectedCell.x !== -1) {
        clearShipPreview();
        showShipPreview(selectedCell.x, selectedCell.y);
    }
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
            if (myBoard[y][x] === 1) cell.classList.add('ship');
            
            cell.addEventListener('mouseenter', () => {
                if (selectedCell.x === -1) showShipPreview(x, y);
            });
            cell.addEventListener('mouseleave', () => {
                if (selectedCell.x === -1) clearShipPreview();
            });
            cell.addEventListener('click', () => handleSetupClick(x, y));
            
            boardEl.appendChild(cell);
        }
    }
}

function handleSetupClick(x, y) {
    if (selectedCell.x === x && selectedCell.y === y) {
        placeShipManually(x, y);
        selectedCell = { x: -1, y: -1 }; 
        clearShipPreview(); 
    } else {
        selectedCell = { x, y };
        clearShipPreview();
        showShipPreview(x, y);
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
            const index = cy * 10 + cx;
            const cell = document.getElementById('setup-board').children[index];
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
        if (navigator.vibrate) navigator.vibrate(50);
    } else {
        showToast('Cannot place ship here!', 'error');
        if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
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
    const btn = document.getElementById('btn-start-game');
    btn.innerText = 'Waiting for opponent...';
    btn.disabled = true;
    document.getElementById('setup-board').style.pointerEvents = 'none'; 
});

// === Game Phase ===
socket.on('gameStart', ({ turn }) => {
    isSetupPhase = false;
    showScreen('game');
    myTurn = (turn === socket.id);
    updateGameStatus();
    renderGameBoards();
    showToast('Battle Started!', 'success');
});

function updateGameStatus() {
    const statusEl = document.getElementById('game-status');
    if (myTurn) {
        statusEl.innerText = "YOUR TURN! FIRE!";
        statusEl.style.color = "#28a745";
    } else {
        statusEl.innerText = "Enemy's Turn...";
        statusEl.style.color = "#dc3545";
    }
}

function renderGameBoards() {
    // 1. My Board (Defending)
    const myBoardEl = document.getElementById('my-board');
    myBoardEl.innerHTML = '';
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            const val = myBoard[y][x];
            
            if (val === 4) cell.classList.add('sunk');
            else if (val === 3) cell.classList.add('hit');
            else if (val === 2) cell.classList.add('miss');
            else if (val === 1) cell.classList.add('ship');
            
            myBoardEl.appendChild(cell);
        }
    }

    // 2. Enemy Board (Attacking)
    const enemyBoardEl = document.getElementById('enemy-board');
    enemyBoardEl.innerHTML = '';
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            const val = myShotsMap[y][x];
            
            if (val === 4) cell.classList.add('sunk');
            else if (val === 3) cell.classList.add('hit');
            else if (val === 2) cell.classList.add('miss');
            
            cell.addEventListener('click', () => {
                if (myTurn && val === 0) {
                    socket.emit('shoot', { roomId: currentRoomId, x, y });
                } else if (!myTurn) {
                    showToast('Wait for your turn!', 'error');
                }
            });
            enemyBoardEl.appendChild(cell);
        }
    }
}

socket.on('shotResult', ({ shooter, x, y, hit, nextTurn }) => {
    const isMe = shooter === socket.id;
    if (isMe) {
        if (myShotsMap[y][x] !== 4) myShotsMap[y][x] = hit ? 3 : 2;
        
        if (hit) {
            showToast('HIT!', 'success');
            if (navigator.vibrate) navigator.vibrate(100);
        } else {
            showToast('Miss...', 'info');
        }
    } else {
        if (myBoard[y][x] !== 4) myBoard[y][x] = hit ? 3 : 2;
        
        if (hit) {
            showToast('WE ARE HIT!', 'error');
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        }
    }
    myTurn = (nextTurn === socket.id);
    updateGameStatus();
    renderGameBoards();
});

socket.on('shipSunk', ({ victim, shipCoords, surroundCoords }) => {
    const isMyShipSunk = victim === socket.id;
    const targetBoard = isMyShipSunk ? myBoard : myShotsMap;

    shipCoords.forEach(({x, y}) => targetBoard[y][x] = 4);
    surroundCoords.forEach(({x, y}) => {
        if (targetBoard[y][x] === 0) targetBoard[y][x] = 2;
    });

    renderGameBoards();

    if (isMyShipSunk) {
        showToast('Our ship has been destroyed!', 'error');
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    } else {
        showToast('Enemy ship DESTROYED!', 'success');
        if (navigator.vibrate) navigator.vibrate([50, 50, 200]);
    }
});

// UPDATED GAME OVER HANDLER
socket.on('gameOver', ({ winner, reason }) => {
    const isVictory = winner === socket.id;
    let title = isVictory ? 'VICTORY!' : 'DEFEAT';
    let msg = isVictory ? 'You destroyed the enemy fleet!' : 'Your fleet has sunk.';
    
    if (reason === 'disconnect') {
        msg = isVictory 
            ? 'Opponent surrendered or disconnected. You Win!' 
            : 'You left the game.';
    }
    
    showModal(isVictory ? 'victory' : 'defeat', title, msg);
});

document.getElementById('btn-leave').addEventListener('click', () => {
    if (confirm('Are you sure you want to surrender?')) {
        socket.emit('leaveGame', currentRoomId);
    }
});
const API_BASE = ''; // отн пути для хоста

let state = {
    gameId: null,
    mode: null,      // pvp or pve
    board: Array(9).fill(null),
    currentPlayer: 'X',
    winner: null,
    gameOver: false,
    playerIdx: null, // индекс юзера
    ws: null,
    mySymbol: null,  // знак для юзера
};

/* служебное */
function $(id) { return document.getElementById(id); }
function showScreen(name) {
    ['menu', 'lobby', 'game'].forEach(s => $(s).classList.add('hidden'));
    $(name).classList.remove('hidden');
    $('backBtn').classList.toggle('hidden', name === 'menu');
}
function showMessage(text, type = 'info') {
    const el = $('message');
    el.textContent = text;
    el.className = 'message msg-' + type;
    el.classList.remove('hidden');
    if (!text) el.classList.add('hidden');
}
function clearMessage() { showMessage('', 'info'); $('message').classList.add('hidden'); }

/* доска */
function renderBoard() {
    const cells = document.querySelectorAll('.cell');
    const wins = state.winner && state.winner !== 'draw'
        ? getWinLine(state.board, state.winner)
        : [];

    cells.forEach((cell, i) => {
        const val = state.board[i];
        cell.textContent = val || '';
        cell.className = 'cell' + (val ? ' ' + val.toLowerCase() + ' taken' : '');
        if (wins.includes(i)) cell.classList.add('winner');
    });

    updateStatus();
}

function getWinLine(board, winner) {
    const lines = [
        [0,1,2],[3,4,5],[6,7,8],
        [0,3,6],[1,4,7],[2,5,8],
        [0,4,8],[2,4,6]
    ];
    for (const line of lines) {
        if (line.every(i => board[i] === winner)) return line;
    }
    return [];
}

function updateStatus() {
    const modeEl = $('gameMode');
    const statusEl = $('gameStatus');
    const turnEl = $('turnIndicator');

    modeEl.textContent = state.mode === 'pvp' ? '👥 PvP' : '🤖 PvE';

    if (state.gameOver) {
        statusEl.textContent = 'Завершено';
        statusEl.className = 'status-badge badge-ended';
        turnEl.textContent = state.winner === 'draw' ? 'Ничья!' : `Победил ${state.winner}!`;
        turnEl.className = 'turn-indicator ' + (state.winner === 'X' ? 'turn-x' : state.winner === 'O' ? 'turn-o' : '');
    } else {
        statusEl.textContent = 'Активно';
        statusEl.className = 'status-badge badge-active';
        turnEl.textContent = `Ходит ${state.currentPlayer}`;
        turnEl.className = 'turn-indicator turn-' + state.currentPlayer.toLowerCase();
    }

    if (state.mode === 'pvp') {
        const info = $('playersInfo');
        if (state.mySymbol) {
            const myTurn = !state.gameOver && state.currentPlayer === state.mySymbol;
            info.textContent = `Вы играете за ${state.mySymbol}. ` + (myTurn ? 'Ваш ход!' : 'Ожидание соперника...');
        } else {
            info.textContent = 'Подключение...';
        }
    } else {
        $('playersInfo').textContent = state.currentPlayer === 'X' ? 'Ваш ход (X)' : 'Ход бота (O)...';
    }
}

/* работа с апи */
async function apiPost(path, body) {
    const res = await fetch(API_BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
    return data;
}

async function apiGet(path) {
    const res = await fetch(API_BASE + path);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
    return data;
}

/* создание игры */
async function createGame(mode) {
    clearState();
    try {
        const data = await apiPost('/game/create', { mode });
        state.gameId = data.game_id;
        state.mode = mode;

        if (mode === 'pvp') {
            $('lobbyCode').textContent = state.gameId;
            showScreen('lobby');
            initWs();
        } else {
            showScreen('game');
            await syncState();
        }
    } catch (e) {
        alert('Ошибка создания игры: ' + e.message);
    }
}

async function joinGame() {
    const code = $('joinCode').value.trim().toUpperCase();
    if (!code) return alert('Введите код комнаты');
    clearState();
    state.gameId = code;
    state.mode = 'pvp';
    showScreen('lobby');
    $('lobbyCode').textContent = code;
    initWs();
}

function clearState() {
    if (state.ws) { state.ws.close(); state.ws = null; }
    state = {
        gameId: null, mode: null, board: Array(9).fill(null),
        currentPlayer: 'X', winner: null, gameOver: false,
        playerIdx: null, ws: null, mySymbol: null
    };
    clearMessage();
    renderBoard();
}

async function syncState() {
    if (!state.gameId) return;
    try {
        const data = await apiGet(`/game/${state.gameId}`);
        applyState(data);
    } catch (e) {
        showMessage('Ошибка синхронизации: ' + e.message, 'error');
    }
}

function applyState(data) {
    if (data.error) { showMessage(data.error, 'error'); return; }

    clearMessage();
    
    state.board = data.board;
    state.currentPlayer = data.current_player;
    state.winner = data.winner;
    state.gameOver = data.game_over;
    state.mode = data.mode;
    renderBoard();
}

/* вебсокет для пвп */
function initWs() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/${state.gameId}`;
    const ws = new WebSocket(wsUrl);
    state.ws = ws;

    ws.onopen = () => {
        console.log('WS connected');
    };

    ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        console.log('WS msg:', msg);

        if (msg.type === 'joined') {
            state.playerIdx = msg.player;
            state.mySymbol = msg.player === 1 ? 'X' : msg.player === 2 ? 'O' : null;
            if (msg.state) applyState(msg.state);
            if (msg.player <= 2) {
            }
        }
        else if (msg.type === 'update') {
            if (msg.state) applyState(msg.state);
            const players = msg.players || 0;
            if (players >= 2 && $('lobby').classList.contains('hidden') === false) {
                showScreen('game');
            }
            if ($('lobby').classList.contains('hidden') === false) {
                if (players >= 2) {
                    $('lobbyStatus').innerHTML = '<span style="color:var(--success)">✓ Игра началась!</span>';
                    setTimeout(() => showScreen('game'), 500);
                } else {
                    $('lobbyStatus').innerHTML = '<span class="spinner"></span> Ожидание второго игрока...';
                }
            }
        }
        else if (msg.error) {
            showMessage(msg.error, 'error');
        }
    };

    ws.onclose = (ev) => {
        console.log('WS closed', ev.code, ev.reason);
        if (!state.gameOver && state.mode === 'pvp') {
            showMessage('Соединение разорвано', 'error');
        }
    };

    ws.onerror = (e) => {
        console.error('WS error', e);
        showMessage('Ошибка WebSocket', 'error');
    };
}

/* ходы */
document.getElementById('board').addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const idx = parseInt(cell.dataset.index);
    if (isNaN(idx)) return;
    makeMove(idx);
});

async function makeMove(idx) {
    if (!state.gameId || state.gameOver) return;
    if (state.board[idx] !== null) return;

    // в пве только за Х
    if (state.mode === 'pve') {
        if (state.currentPlayer !== 'X') return;
        try {
            const data = await apiPost(`/game/${state.gameId}/move`, { position: idx });
            applyState(data);
        } catch (e) {
            showMessage(e.message, 'error');
        }
        return;
    }

    // в пвп за свой символ
    if (state.mode === 'pvp') {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
            showMessage('Нет подключения', 'error'); return;
        }
        if (state.mySymbol && state.currentPlayer !== state.mySymbol) {
            showMessage('Сейчас ход соперника', 'info'); return;
        }
        state.ws.send(JSON.stringify({ type: 'move', position: idx }));
    }
}

/* рестарт или лив */
async function resetGame() {
    if (!state.gameId) return;
    if (state.mode === 'pve') {
        try {
            const data = await apiPost(`/game/${state.gameId}/reset`, {});
            clearMessage();
            applyState(data);
        } catch (e) {
            showMessage(e.message, 'error');
        }
    } else if (state.mode === 'pvp' && state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ type: 'reset' }));
        clearMessage();
    }
}

function leaveGame() {
    if (state.ws) { state.ws.close(); state.ws = null; }
    state.gameId = null;
    showScreen('menu');
    clearState();
}

function goBack() {
    leaveGame();
}

renderBoard();
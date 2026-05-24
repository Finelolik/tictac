const API = "http://127.0.0.1:8000";
let ws = null, gid = null, mode = null, myPlayer = null;

const $ = id => document.getElementById(id);
const show = id => $(id).classList.remove('hidden');
const hide = id => $(id).classList.add('hidden');
const setConn = (ok, msg) => { $('conn').className = 'conn-status ' + (ok ? 'ok' : 'err'); $('conn').textContent = msg || (ok ? '✅ Подключено' : '🔌 Отключено'); };

function start(m) {
    mode = m;
    fetch(`${API}/game/create`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({mode: m}) })
    .then(r => r.json()).then(d => {
        gid = d.game_id.toUpperCase();
        if (m === 'pve') {
        // Для PvE сразу показываем игру, ID не выводим
        show('game'); hide('menu');
        renderBoard(d);
        setConn(true, '🤖 PvE режим');
        } else {
        // Для PvP показываем комнату ожидания
        show('wait'); hide('menu');
        $('display-id').textContent = gid;
        connectWS(gid);
        }
    });
}

function join() {
    const id = $('rid').value.trim().toUpperCase();
    if (!id) return alert('Введите ID');
    fetch(`${API}/game/${id}`).then(r => {
    if (!r.ok) throw new Error('Игра не найдена');
    return r.json();
    }).then(d => {
    if (d.mode !== 'pvp') return alert('Эта игра не для PvP');
    gid = id; mode = 'pvp';
    connectWS(gid);
    hide('menu');
    }).catch(e => alert(e.message));
}

function connectWS(id) {
    ws = new WebSocket(`ws://127.0.0.1:8000/ws/${id}`);
    ws.onopen = () => setConn(true, '✅ Ожидание игрока...');
    ws.onmessage = e => {
    const d = JSON.parse(e.data);
    if (d.error) { alert(d.error); toMenu(); return; }
    if (d.type === 'joined') {
        myPlayer = d.player;
        if (d.state.players >= 2) {
        hide('wait'); show('game');
        setConn(true, `👥 Вы игрок ${myPlayer} (${myPlayer===1?'X':'O'})`);
        } else {
        $('conn').textContent = `👤 Вы игрок ${myPlayer}. Ждем второго...`;
        }
    }
    if (d.type === 'update') {
        if (d.players >= 2) { hide('wait'); show('game'); setConn(true, `👥 Игроков: ${d.players}`); }
        renderBoard(d.state);
    }
    };
    ws.onclose = () => { setConn(false, ' Отключено'); $('reset-btn').disabled = true; };
}

function renderBoard(s) {
    $('status').textContent = s.game_over ? s.message : `Ход: ${s.current_player}`;
    $('reset-btn').disabled = !s.game_over;
    const b = $('board'); b.innerHTML = '';
    s.board.forEach((v, i) => {
    const c = document.createElement('button');
    c.className = `cell ${v ? v.toLowerCase() : ''}`;
    c.textContent = v || '';
    // Определяем чей ход
    const isMyTurn = mode === 'pve' ? s.current_player === 'X' : (s.current_player === (myPlayer===1?'X':'O'));
    c.disabled = v || s.game_over || !isMyTurn || (mode==='pvp' && (!ws || ws.readyState!==1));
    if (!c.disabled) c.onclick = () => makeMove(i);
    b.appendChild(c);
    });
}

function makeMove(pos) {
    if (mode === 'pve') {
    fetch(`${API}/game/${gid}/move`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({position: pos}) })
        .then(r => r.json()).then(renderBoard);
    } else if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({type: 'move', position: pos}));
    }
}

function doReset() {
    if (mode === 'pve') {
    fetch(`${API}/game/${gid}/reset`, {method: 'POST'}).then(r => r.json()).then(renderBoard);
    } else if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({type: 'reset'}));
    }
}

function copyId() {
    navigator.clipboard.writeText(gid).then(() => {
    const b = document.querySelector('#wait button');
    const t = b.textContent; b.textContent = '✅ Скопировано!';
    setTimeout(() => b.textContent = t, 1500);
    });
}

function toMenu() {
    if (ws) ws.close();
    ws = null; gid = null; mode = null; myPlayer = null;
    hide('wait'); hide('game'); show('menu');
    setConn(false, '🔌 Отключено');
    $('rid').value = '';
}
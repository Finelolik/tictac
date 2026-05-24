from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Optional, Dict, List, Literal

import os

import uuid
import random

FRONTEND_DIR = os.path.join(os.path.dirname(__file__))

app = FastAPI(title="Крестики-нолики Online")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

games: Dict[str, dict] = {}
rooms: Dict[str, List[WebSocket]] = {}

class GameCreate(BaseModel):
    mode: Literal["pvp", "pve"] = "pve"

class MoveRequest(BaseModel):
    position: int = Field(..., ge=0, le=8)

def check_winner(board: List[Optional[str]]) -> Optional[str]:
    wins = [(0,1,2), (3,4,5), (6,7,8), (0,3,6), (1,4,7), (2,5,8), (0,4,8), (2,4,6)]
    for a, b, c in wins:
        if board[a] and board[a] == board[b] == board[c]:
            return board[a]
    return "draw" if None not in board else None

def bot_move(board: List[Optional[str]]) -> int:
    available = [i for i, v in enumerate(board) if v is None]
    if not available: return -1
    for i in available:
        board[i] = 'O'
        if check_winner(board) == 'O':
            board[i] = None
            return i
        board[i] = None
    for i in available:
        board[i] = 'X'
        if check_winner(board) == 'X':
            board[i] = None
            return i
        board[i] = None
    if 4 in available: return 4
    return random.choice(available)

def get_state(game_id: str) -> dict:
    gid = game_id.upper()
    g = games.get(gid)
    if not g:
        return {"error": "Игра не найдена"}
    msg = g.get("message", "")
    if g["game_over"] and not msg:
        msg = f"{g['winner']} победил!" if g['winner'] != "draw" else "Ничья!"
        g["message"] = msg
    return {
        "game_id": gid,
        "board": g["board"],
        "current_player": g["current_player"],
        "winner": g["winner"],
        "game_over": g["game_over"],
        "message": msg,
        "mode": g["mode"]
    }

@app.get("/")
async def root():
    return FileResponse("index.html")

@app.get("/games")
async def list_games():
    result = []
    for gid, g in games.items():
        result.append({
            "game_id": gid,
            "mode": g["mode"],
            "players": len(rooms.get(gid, [])),
            "game_over": g["game_over"],
            "winner": g["winner"],
            "current_player": g["current_player"]
        })
    return {"games": result}

app.mount("/static", StaticFiles(directory=os.path.join(FRONTEND_DIR, "static")), name="static")

@app.post("/game/create")
async def create_game(req: GameCreate):
    game_id = str(uuid.uuid4())[:8].upper()
    games[game_id] = {
        "board": [None]*9,
        "current_player": "X",
        "winner": None,
        "game_over": False,
        "message": "",
        "mode": req.mode
    }
    # комната только для пвп
    if req.mode == "pvp":
        rooms[game_id] = []
    return {"game_id": game_id, "mode": req.mode}

@app.get("/game/{game_id}")
async def get_game(game_id: str):
    state = get_state(game_id)
    if "error" in state:
        raise HTTPException(404, state["error"])
    return state

@app.post("/game/{game_id}/move")
async def http_move(game_id: str, req: MoveRequest):
    gid = game_id.upper()
    if gid not in games:
        raise HTTPException(404, "Игра не найдена")
    g = games[gid]
    if g["game_over"]:
        raise HTTPException(400, "Игра завершена")
    if g["board"][req.position] is not None:
        raise HTTPException(400, "Клетка занята")
    if g["mode"] == "pve" and g["current_player"] != "X":
        raise HTTPException(400, "Сейчас ход робота")
    if g["mode"] == "pvp":
        raise HTTPException(400, "Для PvP используйте WebSocket")

    # ход игрока
    g["board"][req.position] = "X"
    win = check_winner(g["board"])
    if win:
        g["game_over"] = True
        g["winner"] = win
    else:
        g["current_player"] = "O"
        # ход бота
        if g["mode"] == "pve":
            bp = bot_move(g["board"])
            if bp != -1:
                g["board"][bp] = "O"
                win = check_winner(g["board"])
                if win:
                    g["game_over"] = True
                    g["winner"] = win
                else:
                    g["current_player"] = "X"
    return get_state(gid)

@app.post("/game/{game_id}/reset")
async def http_reset(game_id: str):
    gid = game_id.upper()
    if gid not in games:
        raise HTTPException(404, "Игра не найдена")
    games[gid].update({
        "board": [None]*9, "current_player": "X",
        "winner": None, "game_over": False, "message": ""
    })
    return get_state(gid)

async def broadcast(room_id: str, msg: dict):
    if room_id not in rooms: return
    dead = []
    for ws in rooms[room_id]:
        try: await ws.send_json(msg)
        except: dead.append(ws)
    for ws in dead: rooms[room_id].remove(ws)
    if not rooms[room_id]: del rooms[room_id]

@app.websocket("/ws/{game_id}")
async def ws_endpoint(ws: WebSocket, game_id: str):
    gid = game_id.upper()
    if gid not in games or games[gid]["mode"] != "pvp":
        await ws.close(code=4004, reason="Игра не найдена или не PvP")
        return

    await ws.accept()
    rooms[gid].append(ws)
    player_idx = len(rooms[gid])

    if player_idx > 2:
        await ws.send_json({"error": "Комната заполнена"})
        await ws.close()
        rooms[gid].remove(ws)
        return

    await ws.send_json({"type": "joined", "player": player_idx, "state": get_state(gid)})
    await broadcast(gid, {"type": "update", "players": len(rooms[gid]), "state": get_state(gid)})

    try:
        while True:
            data = await ws.receive_json()
            if data.get("type") == "move":
                g = games[gid]
                if g["game_over"] or g["board"][data["position"]] is not None:
                    await ws.send_json({"error": "Невозможно сделать ход"})
                    continue

                g["board"][data["position"]] = g["current_player"]
                win = check_winner(g["board"])
                if win:
                    g["game_over"] = True
                    g["winner"] = win
                else:
                    g["current_player"] = "O" if g["current_player"] == "X" else "X"

                await broadcast(gid, {"type": "update", "state": get_state(gid)})

            elif data.get("type") == "reset":
                games[gid].update({
                    "board": [None]*9, "current_player": "X",
                    "winner": None, "game_over": False, "message": ""
                })
                await broadcast(gid, {"type": "update", "state": get_state(gid)})
    except WebSocketDisconnect:
        if ws in rooms.get(gid, []):
            rooms[gid].remove(ws)
            await broadcast(gid, {"type": "update", "players": len(rooms.get(gid, [])), "state": get_state(gid)})
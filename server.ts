import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.json());

// Google Search Console Verification Endpoint
app.get('/google4932b51f4e4ad751.html', (_req, res) => {
  res.type('text/html').send('google-site-verification: google4932b51f4e4ad751.html\n');
});

interface Player {
  id: string; // Persistent player session ID
  socketId: string;
  name: string;
  symbol: 'X' | 'O';
  connected: boolean;
  disconnectTimeout?: NodeJS.Timeout;
}

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
}

interface RoomData {
  roomId: string;
  board: (string | null)[];
  players: { [playerId: string]: Player };
  turn: 'X' | 'O';
  winner: 'X' | 'O' | 'draw' | null;
  winningLine: number[] | null;
  scores: { X: number; O: number; draws: number };
  chat: ChatMessage[];
  status: 'waiting' | 'playing' | 'ended';
  createdAt: number;
  turnDeadline: number;
}

const rooms = new Map<string, RoomData>();

// Helper to sanitize room state for client (omit internal NodeJS timers)
function serializeRoom(room: RoomData) {
  const playersObj: { [id: string]: { id: string; name: string; symbol: 'X' | 'O'; connected: boolean } } = {};
  for (const [id, p] of Object.entries(room.players)) {
    playersObj[id] = {
      id: p.id,
      name: p.name,
      symbol: p.symbol,
      connected: p.connected
    };
  }
  return {
    roomId: room.roomId,
    board: room.board,
    players: playersObj,
    turn: room.turn,
    winner: room.winner,
    winningLine: room.winningLine,
    scores: room.scores,
    chat: room.chat,
    status: room.status,
    createdAt: room.createdAt,
    turnDeadline: room.turnDeadline
  };
}

// Background timer ticker for turn timeouts
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (room.status === 'playing' && room.winner === null && room.turnDeadline) {
      if (now >= room.turnDeadline) {
        const timeoutWinner = room.turn === 'X' ? 'O' : 'X';
        room.winner = timeoutWinner;
        room.status = 'ended';
        if (timeoutWinner === 'X') room.scores.X++;
        else if (timeoutWinner === 'O') room.scores.O++;

        room.chat.push({
          id: Math.random().toString(36).substring(2, 9),
          sender: 'System',
          text: `⏱️ Player ${room.turn} ran out of time (30s)! Player ${timeoutWinner} wins by timeout.`,
          timestamp: Date.now()
        });

        io.to(roomId).emit('room-state', serializeRoom(room));
      }
    }
  }
}, 1000);

function checkWin(board: (string | null)[]): { winner: 'X' | 'O' | 'draw' | null; line: number[] | null } {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
    [0, 4, 8], [2, 4, 6]            // diagonals
  ];

  for (const line of lines) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a] as 'X' | 'O', line };
    }
  }

  if (board.every(cell => cell !== null)) {
    return { winner: 'draw', line: null };
  }

  return { winner: null, line: null };
}

io.on('connection', (socket: Socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join-room', ({ roomId, playerName, playerId }: { roomId: string; playerName: string; playerId: string }) => {
    if (!roomId) return;
    const cleanRoomId = roomId.toUpperCase();
    socket.join(cleanRoomId);

    let room = rooms.get(cleanRoomId);
    if (!room) {
      room = {
        roomId: cleanRoomId,
        board: Array(9).fill(null),
        players: {},
        turn: 'X',
        winner: null,
        winningLine: null,
        scores: { X: 0, O: 0, draws: 0 },
        chat: [],
        status: 'waiting',
        createdAt: Date.now(),
        turnDeadline: Date.now() + 30000
      };
      rooms.set(cleanRoomId, room);
    }

    // Check if this player is rejoining (e.g., page refresh)
    if (playerId && room.players[playerId]) {
      const existingPlayer = room.players[playerId];
      if (existingPlayer.disconnectTimeout) {
        clearTimeout(existingPlayer.disconnectTimeout);
        existingPlayer.disconnectTimeout = undefined;
      }
      existingPlayer.socketId = socket.id;
      existingPlayer.connected = true;
      if (playerName) existingPlayer.name = playerName;
    } else {
      const playerList = Object.values(room.players);
      let assignedSymbol: 'X' | 'O' = 'X';

      if (playerList.length === 0) {
        assignedSymbol = 'X';
      } else if (playerList.length === 1) {
        assignedSymbol = playerList[0].symbol === 'X' ? 'O' : 'X';
      } else {
        // Room already has 2 players, spectator or extra
        assignedSymbol = 'X';
      }

      if (playerId && !room.players[playerId] && playerList.length < 2) {
        room.players[playerId] = {
          id: playerId,
          socketId: socket.id,
          name: playerName || `Player ${assignedSymbol}`,
          symbol: assignedSymbol,
          connected: true
        };
      }
    }

    if (Object.keys(room.players).length >= 2 && room.status === 'waiting') {
      room.status = 'playing';
      room.turnDeadline = Date.now() + 30000;
    }

    io.to(cleanRoomId).emit('room-state', serializeRoom(room));
  });

  socket.on('make-move', ({ roomId, index, playerId }: { roomId: string; index: number; playerId: string }) => {
    const cleanRoomId = roomId.toUpperCase();
    const room = rooms.get(cleanRoomId);
    if (!room) return;
    if (room.winner !== null || room.status !== 'playing') return;
    if (room.board[index] !== null) return;

    const player = room.players[playerId];
    if (!player || player.symbol !== room.turn) {
      return; // Not your turn or not in room
    }

    room.board[index] = room.turn;

    const result = checkWin(room.board);
    if (result.winner) {
      room.winner = result.winner;
      room.winningLine = result.line;
      room.status = 'ended';
      if (result.winner === 'X') room.scores.X++;
      else if (result.winner === 'O') room.scores.O++;
      else if (result.winner === 'draw') room.scores.draws++;
    } else {
      room.turn = room.turn === 'X' ? 'O' : 'X';
      room.turnDeadline = Date.now() + 30000;
    }

    io.to(cleanRoomId).emit('room-state', serializeRoom(room));
  });

  socket.on('restart-game', ({ roomId }: { roomId: string }) => {
    const cleanRoomId = roomId.toUpperCase();
    const room = rooms.get(cleanRoomId);
    if (!room) return;

    room.board = Array(9).fill(null);
    room.winner = null;
    room.winningLine = null;
    room.status = Object.keys(room.players).length >= 2 ? 'playing' : 'waiting';
    // Alternate starting player
    room.turn = room.turn === 'X' ? 'O' : 'X';
    room.turnDeadline = Date.now() + 30000;

    io.to(cleanRoomId).emit('room-state', serializeRoom(room));
  });

  socket.on('send-chat', ({ roomId, text, playerId }: { roomId: string; text: string; playerId?: string }) => {
    const cleanRoomId = roomId.toUpperCase();
    const room = rooms.get(cleanRoomId);
    if (!room) return;
    const player = playerId ? room.players[playerId] : null;
    const senderName = player ? player.name : 'Spectator';

    const msg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      sender: senderName,
      text: text.slice(0, 200),
      timestamp: Date.now()
    };

    room.chat.push(msg);
    if (room.chat.length > 50) room.chat.shift();

    io.to(cleanRoomId).emit('room-state', serializeRoom(room));
  });

  socket.on('leave-room', ({ roomId, playerId }: { roomId: string; playerId: string }) => {
    const cleanRoomId = roomId.toUpperCase();
    const room = rooms.get(cleanRoomId);
    if (!room) return;

    if (playerId && room.players[playerId]) {
      const p = room.players[playerId];
      if (p.disconnectTimeout) clearTimeout(p.disconnectTimeout);
      delete room.players[playerId];
      
      if (Object.keys(room.players).length === 0) {
        rooms.delete(cleanRoomId);
      } else {
        room.status = 'waiting';
        io.to(cleanRoomId).emit('room-state', serializeRoom(room));
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    for (const [roomId, room] of rooms.entries()) {
      for (const [playerId, player] of Object.entries(room.players)) {
        if (player.socketId === socket.id) {
          player.connected = false;
          
          // Allow a grace period of 60 seconds for page reload/refresh
          if (player.disconnectTimeout) clearTimeout(player.disconnectTimeout);
          player.disconnectTimeout = setTimeout(() => {
            if (!player.connected) {
              delete room.players[playerId];
              if (Object.keys(room.players).length === 0) {
                rooms.delete(roomId);
              } else {
                room.status = 'waiting';
                io.to(roomId).emit('room-state', serializeRoom(room));
              }
            }
          }, 60000);

          io.to(roomId).emit('room-state', serializeRoom(room));
        }
      }
    }
  });
});

// Setup Vite dev middleware or static files
if (process.env.NODE_ENV !== 'production') {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: false }
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

const PORT = Number(process.env.PORT) || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

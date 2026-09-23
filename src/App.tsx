import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import confetti from 'canvas-confetti';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, Play, Copy, Check, RotateCcw, Send, MessageSquare, 
  Sparkles, Trophy, ArrowRight, Share2, Zap, Shield, Heart, Flame,
  Dices, Swords
} from 'lucide-react';

const RANDOM_NAMES = [
  'CyberAce', 'Vortex', 'ShadowStrike', 'NeonPulse', 'Nova', 'Titan',
  'Phantom', 'Echo', 'Hyperion', 'ZeroGravity', 'StormBlade', 'Apex'
];

interface Player {
  id: string;
  name: string;
  symbol: 'X' | 'O';
  connected?: boolean;
}

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
}

interface RoomState {
  roomId: string;
  board: (string | null)[];
  players: { [playerId: string]: Player };
  turn: 'X' | 'O';
  winner: 'X' | 'O' | 'draw' | null;
  winningLine: number[] | null;
  scores: { X: number; O: number; draws: number };
  chat: ChatMessage[];
  status: 'waiting' | 'playing' | 'ended';
  turnDeadline?: number;
}

export default function App() {
  const [playerId] = useState(() => {
    let id = sessionStorage.getItem('ttt_session_user_id');
    if (!id) {
      id = 'p_' + Math.random().toString(36).substring(2, 12);
      sessionStorage.setItem('ttt_session_user_id', id);
    }
    return id;
  });

  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomId, setRoomId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get('room');
    const savedRoom = sessionStorage.getItem('ttt_active_room_id');
    return (savedRoom || urlRoom || '').toUpperCase();
  });
  const [view, setView] = useState<'lobby' | 'room'>(() => {
    const savedRoom = sessionStorage.getItem('ttt_active_room_id');
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get('room');
    return (savedRoom || urlRoom) ? 'room' : 'lobby';
  });
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('ttt_player_name') || '');
  const [roomInput, setRoomInput] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room')?.toUpperCase() || '';
  });
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const roomStateRef = useRef<RoomState | null>(null);
  const [copied, setCopied] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [floatingEmojis, setFloatingEmojis] = useState<{ id: string; emoji: string; x: number }[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number>(30);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const handleRandomizeName = () => {
    playSound('click');
    const random = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
    const tag = Math.floor(Math.random() * 89 + 10);
    const newName = `${random}_${tag}`;
    setPlayerName(newName);
    localStorage.setItem('ttt_player_name', newName);
  };

  // Deterministic avatar generator based on name
  const getAvatarProps = (name: string, symbol: 'X' | 'O') => {
    const initial = name ? name.charAt(0).toUpperCase() : symbol;
    const colors = [
      'from-cyan-500 to-blue-600',
      'from-rose-500 to-pink-600',
      'from-amber-500 to-orange-600',
      'from-emerald-500 to-teal-600',
      'from-purple-500 to-indigo-600',
      'from-fuchsia-500 to-rose-600'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colorIndex = Math.abs(hash) % colors.length;
    return {
      initial,
      gradient: symbol === 'X' ? 'from-cyan-500 to-blue-600' : 'from-rose-500 to-pink-600'
    };
  };

  // Web Audio synthesizer for crisp game sound effects without external audio files
  const playSound = (type: 'move' | 'win' | 'lose' | 'click' | 'join' | 'timeout') => {
    if (!soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;

      if (type === 'click') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.05);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === 'move') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
      } else if (type === 'win') {
        // Triumphant fanfare + cheerful "Yaayy" chime
        osc.type = 'square';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.12); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.24); // G5
        osc.frequency.setValueAtTime(1046.50, now + 0.36); // C6
        osc.frequency.setValueAtTime(1318.51, now + 0.48); // E6 (triumphant peak)
        
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.85);
        osc.start(now);
        osc.stop(now + 0.85);

        // Add a joyful harmonic chime overlay for the "Yaayy" feel
        setTimeout(() => {
          try {
            const chimeOsc = ctx.createOscillator();
            const chimeGain = ctx.createGain();
            chimeOsc.connect(chimeGain);
            chimeGain.connect(ctx.destination);
            chimeOsc.type = 'triangle';
            chimeOsc.frequency.setValueAtTime(1567.98, ctx.currentTime); // G6
            chimeOsc.frequency.exponentialRampToValueAtTime(2093.00, ctx.currentTime + 0.3); // C7
            chimeGain.gain.setValueAtTime(0.08, ctx.currentTime);
            chimeGain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.35);
            chimeOsc.start(ctx.currentTime);
            chimeOsc.stop(ctx.currentTime + 0.35);
          } catch {
            // ignore
          }
        }, 360);
      } else if (type === 'lose') {
        // Dramatic descending sad trombone / defeat tone
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(349.23, now); // F4
        osc.frequency.setValueAtTime(329.63, now + 0.15); // E4
        osc.frequency.setValueAtTime(293.66, now + 0.30); // D4
        osc.frequency.setValueAtTime(261.63, now + 0.45); // C4
        osc.frequency.linearRampToValueAtTime(130.81, now + 0.9); // C3 deep slide
        
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.005, now + 0.95);
        osc.start(now);
        osc.stop(now + 0.95);

        // Add a low dissonant thud
        setTimeout(() => {
          try {
            const thudOsc = ctx.createOscillator();
            const thudGain = ctx.createGain();
            thudOsc.connect(thudGain);
            thudGain.connect(ctx.destination);
            thudOsc.type = 'sine';
            thudOsc.frequency.setValueAtTime(110, ctx.currentTime);
            thudOsc.frequency.linearRampToValueAtTime(55, ctx.currentTime + 0.3);
            thudGain.gain.setValueAtTime(0.2, ctx.currentTime);
            thudGain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.3);
            thudOsc.start(ctx.currentTime);
            thudOsc.stop(ctx.currentTime + 0.3);
          } catch {
            // ignore
          }
        }, 500);
      } else if (type === 'timeout') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.linearRampToValueAtTime(120, now + 0.3);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      }
    } catch {
      // Audio context might be restricted before interaction
    }
  };

  // Turn countdown timer effect
  useEffect(() => {
    if (!roomState || roomState.winner !== null || roomState.status !== 'playing' || !roomState.turnDeadline) {
      return;
    }

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil(((roomState.turnDeadline ?? Date.now()) - Date.now()) / 1000));
      setSecondsLeft(remaining);
    }, 200);

    return () => clearInterval(interval);
  }, [roomState?.turnDeadline, roomState?.winner, roomState?.status]);

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling']
    });

    setSocket(newSocket);

    // Check URL query for room ID (e.g., ?room=XYZ123)
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get('room');
    if (urlRoom) {
      setRoomInput(urlRoom.toUpperCase());
    }

    newSocket.on('connect', () => {
      console.log('Connected to server:', newSocket.id);
      // Auto-rejoin active session room if user refreshed
      const savedActiveRoom = sessionStorage.getItem('ttt_active_room_id') || new URLSearchParams(window.location.search).get('room');
      if (savedActiveRoom) {
        const cleanRoom = savedActiveRoom.toUpperCase();
        const curName = localStorage.getItem('ttt_player_name') || '';
        newSocket.emit('join-room', {
          roomId: cleanRoom,
          playerName: curName,
          playerId
        });
      }
    });

    newSocket.on('room-state', (state: RoomState) => {
      // Check if game just ended
      const mySymbol = playerId && state.players[playerId] ? state.players[playerId].symbol : null;
      if (roomStateRef.current?.winner === null && state.winner !== null) {
        if (state.winner === 'draw') {
          playSound('timeout');
        } else if (state.winner === mySymbol) {
          playSound('win');
          // Trigger canvas-confetti fireworks explosion
          confetti({
            particleCount: 120,
            spread: 90,
            origin: { y: 0.6 }
          });
          // Trigger win emojis
          setFloatingEmojis(prev => [
            ...prev,
            { id: Math.random().toString(), emoji: '🎉', x: 30 },
            { id: Math.random().toString(), emoji: '🏆', x: 50 },
            { id: Math.random().toString(), emoji: '⭐', x: 70 }
          ]);
        } else {
          playSound('lose');
          // Trigger lose emojis
          setFloatingEmojis(prev => [
            ...prev,
            { id: Math.random().toString(), emoji: '😢', x: 40 },
            { id: Math.random().toString(), emoji: '💔', x: 60 }
          ]);
        }
      }
      roomStateRef.current = state;
      setRoomState(state);
    });

    return () => {
      newSocket.disconnect();
    };
  }, [playerId]);

  // Haptic feedback and turn detection effect
  useEffect(() => {
    if (!roomState || roomState.winner !== null || roomState.status !== 'playing' || !playerId) {
      return;
    }
    const myPlayer = roomState.players[playerId];
    if (myPlayer && myPlayer.symbol === roomState.turn) {
      if (typeof window !== 'undefined' && navigator && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate([40, 60, 40]);
        } catch {
          // Vibration might be blocked by permission/gesture settings
        }
      }
    }
  }, [roomState?.turn, roomState?.winner, roomState?.status, playerId]);

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!socket) return;
    const name = playerName.trim() || `Player ${Math.floor(Math.random() * 900 + 100)}`;
    setPlayerName(name);
    localStorage.setItem('ttt_player_name', name);

    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(newRoomId);
    sessionStorage.setItem('ttt_active_room_id', newRoomId);
    setConnecting(true);

    socket.emit('join-room', { roomId: newRoomId, playerName: name, playerId });
    setView('room');
    setConnecting(false);

    // Update URL without reload
    const newUrl = `${window.location.pathname}?room=${newRoomId}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const targetRoom = roomInput.trim().toUpperCase();
    if (!socket || !targetRoom) return;

    const name = playerName.trim() || `Player ${Math.floor(Math.random() * 900 + 100)}`;
    setPlayerName(name);
    localStorage.setItem('ttt_player_name', name);

    setRoomId(targetRoom);
    sessionStorage.setItem('ttt_active_room_id', targetRoom);
    setConnecting(true);

    socket.emit('join-room', { roomId: targetRoom, playerName: name, playerId });
    setView('room');
    setConnecting(false);

    const newUrl = `${window.location.pathname}?room=${targetRoom}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
  };

  const handleLeaveRoom = () => {
    if (socket && roomId) {
      socket.emit('leave-room', { roomId, playerId });
    }
    sessionStorage.removeItem('ttt_active_room_id');
    setView('lobby');
    setRoomState(null);
    setRoomId('');
    window.history.pushState({}, '', window.location.pathname);
  };

  const handleCellClick = (index: number) => {
    if (!socket || !roomState) return;
    if (roomState.board[index] !== null || roomState.winner !== null) return;

    const myPlayer = playerId && roomState ? roomState.players[playerId] : null;
    if (!myPlayer || myPlayer.symbol !== roomState.turn) {
      return; // Not your turn
    }

    playSound('move');
    socket.emit('make-move', { roomId, index, playerId });
  };

  const handleRestart = () => {
    if (!socket) return;
    playSound('click');
    socket.emit('restart-game', { roomId });
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!socket || !chatText.trim()) return;
    socket.emit('send-chat', { roomId, text: chatText.trim(), playerId });
    setChatText('');
  };

  const sendEmojiReaction = (emoji: string) => {
    // Show locally and send via chat or broadcast
    const id = Math.random().toString(36).substring(2, 9);
    const x = Math.floor(Math.random() * 80) + 10;
    setFloatingEmojis(prev => [...prev, { id, emoji, x }]);
    setTimeout(() => {
      setFloatingEmojis(prev => prev.filter(e => e.id !== id));
    }, 2000);

    if (socket) {
      socket.emit('send-chat', { roomId, text: ` reacted with ${emoji}`, playerId });
    }
  };

  const copyInviteLink = () => {
    const link = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const myPlayer = roomState && playerId ? roomState.players[playerId] : null;
  const mySymbol = myPlayer?.symbol || null;
  const isMyTurn = roomState && mySymbol && roomState.turn === mySymbol && roomState.winner === null;
  const playerCount = roomState ? Object.keys(roomState.players).length : 0;
  const playersArray = roomState ? Object.values(roomState.players) : [];
  const opponent = roomState && playerId ? playersArray.find(p => p.id !== playerId) : null;
  const me = myPlayer;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-between font-sans relative overflow-x-hidden selection:bg-indigo-500 selection:text-white">
      {/* Background ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-96 bg-indigo-600/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-rose-600/10 blur-[120px] rounded-full pointer-events-none" />

      {/* Floating Emoji Layer */}
      <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
        {floatingEmojis.map(item => (
          <div
            key={item.id}
            className="absolute bottom-16 text-4xl animate-bounce transition-all duration-1000 opacity-90"
            style={{ left: `${item.x}%`, transform: 'translateY(-150px)' }}
          >
            {item.emoji}
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="w-full max-w-md px-4 py-4 flex items-center justify-between z-10 border-b border-slate-900 bg-slate-950/60 backdrop-blur-xl sticky top-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-rose-500 via-indigo-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 border border-indigo-500/30">
            <Heart className="w-5 h-5 text-white fill-white/20 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-black text-base tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
                Hm♥️D
              </h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 font-mono font-bold tracking-wider uppercase">
                Tic-Tac-Toe
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">Real-Time Mobile 2-Player</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-xl border text-xs font-bold transition flex items-center gap-1 ${
              soundEnabled 
                ? 'bg-slate-900 border-slate-800 text-indigo-400 hover:bg-slate-800' 
                : 'bg-slate-900/50 border-slate-800 text-slate-500 hover:bg-slate-800'
            }`}
            title={soundEnabled ? 'Mute Sound' : 'Enable Sound'}
          >
            {soundEnabled ? '🔊' : '🔇'}
          </button>

          {view === 'room' && (
            <button
              onClick={handleLeaveRoom}
              className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-bold text-slate-300 transition active:scale-95"
            >
              Leave
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="w-full max-w-md px-4 flex-1 flex flex-col justify-center z-10 pb-6">
        {view === 'lobby' ? (
          <div className="space-y-4">
            {/* Arena Hero Console */}
            <div className="relative p-5 rounded-3xl bg-slate-900/80 border border-slate-800/90 backdrop-blur-xl shadow-2xl space-y-4">
              {/* Header Title & Status */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
                    <Swords className="w-5 h-5 text-indigo-400" />
                    1v1 Duel Arena
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Real-time PvP · 30s blitz clock · Auto reconnect
                  </p>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-medium text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
                  <span>Online</span>
                </div>
              </div>

              {/* Player Identity Bar */}
              <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium">Player Identity</span>
                  <button
                    type="button"
                    onClick={handleRandomizeName}
                    className="text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1 transition active:scale-95 text-[11px]"
                    title="Roll Random Handle"
                  >
                    <Dices className="w-3.5 h-3.5" /> Randomize
                  </button>
                </div>

                <div className="flex items-center gap-2.5">
                  {(() => {
                    const avatar = getAvatarProps(playerName || 'Player', 'X');
                    return (
                      <div className={`w-9 h-9 shrink-0 rounded-xl bg-gradient-to-tr ${avatar.gradient} flex items-center justify-center text-white font-black text-sm shadow-md border border-white/20`}>
                        {avatar.initial}
                      </div>
                    );
                  })()}
                  <input
                    type="text"
                    placeholder="Enter nickname..."
                    value={playerName}
                    onChange={e => setPlayerName(e.target.value)}
                    maxLength={16}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 text-xs font-semibold tracking-wide transition"
                  />
                </div>
              </div>

              {/* Primary Action - Play Game */}
              <div className="space-y-3 pt-1">
                <button
                  onClick={handleCreateRoom}
                  className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-rose-600 hover:from-indigo-500 hover:to-rose-500 text-white font-black text-sm shadow-xl shadow-indigo-600/25 flex items-center justify-center gap-2 transition active:scale-[0.98]"
                >
                  <Play className="w-4 h-4 fill-current" /> Play Game
                </button>
                <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400">
                  <span>Instant room link</span>
                  <span aria-hidden="true">·</span>
                  <span>No install required</span>
                  <span aria-hidden="true">·</span>
                  <span>Cross-device</span>
                </div>
              </div>

              {/* Join Code Input Form */}
              <form onSubmit={handleJoinRoom} className="space-y-2 pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium">Join with Code</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="ENTER 6-CHAR CODE"
                    value={roomInput}
                    onChange={e => setRoomInput(e.target.value.toUpperCase())}
                    maxLength={6}
                    className="flex-1 px-3 py-2.5 rounded-2xl bg-slate-950 border border-slate-800 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 uppercase font-mono tracking-widest text-center text-xs font-bold"
                  />
                  <button
                    type="submit"
                    disabled={!roomInput.trim()}
                    className="px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white font-bold text-xs transition flex items-center gap-1.5 active:scale-95 border border-slate-700/60"
                  >
                    Join <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </form>
            </div>

            {/* Quick Spec Row (Zero-Pill, Unboxed) */}
            <div className="grid grid-cols-3 gap-2 text-center text-[11px] text-slate-400">
              <div className="p-2.5 rounded-2xl bg-slate-900/60 border border-slate-800/60 flex flex-col items-center gap-1">
                <Zap className="w-4 h-4 text-amber-400" />
                <span className="font-semibold text-slate-300">Live Sync</span>
                <span className="text-[10px] text-slate-500">Zero Latency</span>
              </div>
              <div className="p-2.5 rounded-2xl bg-slate-900/60 border border-slate-800/60 flex flex-col items-center gap-1">
                <Users className="w-4 h-4 text-cyan-400" />
                <span className="font-semibold text-slate-300">2-Player PvP</span>
                <span className="text-[10px] text-slate-500">Mobile Ready</span>
              </div>
              <div className="p-2.5 rounded-2xl bg-slate-900/60 border border-slate-800/60 flex flex-col items-center gap-1">
                <Flame className="w-4 h-4 text-rose-400" />
                <span className="font-semibold text-slate-300">Audio & FX</span>
                <span className="text-[10px] text-slate-500">Haptics & Chat</span>
              </div>
            </div>
          </div>
        ) : (
          /* Room View */
          <div className="space-y-4">
            {/* Room Info Bar */}
            {playerCount < 2 && (
              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-900/80 border border-slate-800 backdrop-blur-md">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                  <span className="text-xs font-mono text-slate-300">Room: <strong className="text-white font-bold">{roomId}</strong></span>
                </div>
                <button
                  onClick={copyInviteLink}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 text-xs font-medium transition"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Link Copied!' : 'Share Invite'}
                </button>
              </div>
            )}

            {/* Waiting for opponent banner if < 2 players */}
            {playerCount < 2 && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-center space-y-2">
                <div className="inline-flex p-2 rounded-full bg-amber-500/20 text-amber-400 animate-pulse">
                  <Users className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-amber-300 text-sm">Waiting for opponent to join...</h3>
                <p className="text-xs text-amber-400/80">
                  Send this invite link to your friend on another mobile device!
                </p>
                <div className="pt-1">
                  <button
                    onClick={copyInviteLink}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition inline-flex items-center gap-2"
                  >
                    <Share2 className="w-3.5 h-3.5" /> Copy Invite Link Now
                  </button>
                </div>
              </div>
            )}

            {/* Score & Player Cards */}
            <div className="grid grid-cols-2 gap-3">
              {/* Player X */}
              {(() => {
                const playerX = playersArray.find(p => p.symbol === 'X');
                const avatar = getAvatarProps(playerX?.name || 'Player X', 'X');
                return (
                  <div className={`p-3 rounded-2xl border transition-all ${
                    roomState?.turn === 'X' && roomState?.winner === null
                      ? 'bg-cyan-500/10 border-cyan-500/50 shadow-lg shadow-cyan-500/10 scale-[1.02]'
                      : 'bg-slate-900/60 border-slate-800'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-xl bg-gradient-to-tr ${avatar.gradient} flex items-center justify-center text-white font-black text-xs shadow-md border border-white/20`}>
                          {avatar.initial}
                        </div>
                        <span className="w-5 h-5 rounded-md bg-cyan-500/20 text-cyan-400 font-black text-[10px] flex items-center justify-center border border-cyan-500/40">X</span>
                      </div>
                      <span className="text-xs font-bold text-cyan-400 font-mono">Score: {roomState?.scores.X || 0}</span>
                    </div>
                    <p className="text-xs font-bold text-white truncate">
                      {playerX?.name || 'Waiting...'}
                      {me?.symbol === 'X' && <span className="text-[10px] text-cyan-400 font-normal ml-1">(You)</span>}
                    </p>
                  </div>
                );
              })()}

              {/* Player O */}
              {(() => {
                const playerO = playersArray.find(p => p.symbol === 'O');
                const avatar = getAvatarProps(playerO?.name || 'Player O', 'O');
                return (
                  <div className={`p-3 rounded-2xl border transition-all ${
                    roomState?.turn === 'O' && roomState?.winner === null
                      ? 'bg-rose-500/10 border-rose-500/50 shadow-lg shadow-rose-500/10 scale-[1.02]'
                      : 'bg-slate-900/60 border-slate-800'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-xl bg-gradient-to-tr ${avatar.gradient} flex items-center justify-center text-white font-black text-xs shadow-md border border-white/20`}>
                          {avatar.initial}
                        </div>
                        <span className="w-5 h-5 rounded-md bg-rose-500/20 text-rose-400 font-black text-[10px] flex items-center justify-center border border-rose-500/40">O</span>
                      </div>
                      <span className="text-xs font-bold text-rose-400 font-mono">Score: {roomState?.scores.O || 0}</span>
                    </div>
                    <p className="text-xs font-bold text-white truncate">
                      {playerO?.name || 'Waiting...'}
                      {me?.symbol === 'O' && <span className="text-[10px] text-rose-400 font-normal ml-1">(You)</span>}
                    </p>
                  </div>
                );
              })()}
            </div>

            {/* Turn Status Banner */}
            <div className="space-y-2">
              <div className="text-center py-1">
                {roomState?.winner !== null ? (
                  (() => {
                    const isDraw = roomState?.winner === 'draw';
                    const isWinner = !isDraw && roomState?.winner === mySymbol;
                    return (
                      <div className={`inline-block px-5 py-2.5 rounded-2xl border text-sm font-black shadow-2xl transition-all duration-500 ${
                        isDraw 
                          ? 'bg-slate-900 border-slate-700 text-slate-300 animate-pulse'
                          : isWinner
                          ? 'bg-gradient-to-r from-emerald-600 to-teal-600 border-emerald-400 text-white animate-bounce shadow-emerald-500/50 scale-105'
                          : 'bg-gradient-to-r from-rose-900/90 to-red-950/90 border-rose-500/60 text-rose-300 animate-pulse scale-95 opacity-90'
                      }`}>
                        {isDraw ? '🤝 It\'s a Draw Match!' : isWinner ? '👑 VICTORY! You Won the Duel! 🏆' : '💀 DEFEAT! Better Luck Next Time!'}
                      </div>
                    );
                  })()
                ) : playerCount < 2 ? (
                  <span className="text-xs text-slate-400">Need 2 players to start</span>
                ) : (
                  <div className="flex items-center justify-between px-2">
                    <span className={`text-xs font-bold px-3 py-1 rounded-full border ${
                      isMyTurn ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300 animate-pulse' : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}>
                      {isMyTurn ? '👉 Your Turn!' : `⏳ Waiting for Player ${roomState?.turn}...`}
                    </span>
                    <span className={`text-xs font-mono font-bold px-3 py-1 rounded-full border ${
                      secondsLeft <= 10 
                        ? 'bg-rose-500/20 border-rose-500/50 text-rose-400 animate-pulse' 
                        : 'bg-slate-900 border-slate-800 text-indigo-400'
                    }`}>
                      ⏱️ {secondsLeft}s
                    </span>
                  </div>
                )}
              </div>

              {/* Countdown Progress Bar */}
              {roomState?.winner === null && playerCount >= 2 && roomState?.status === 'playing' && (
                <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800/80">
                  <div 
                    className={`h-full transition-all duration-300 ${secondsLeft <= 10 ? 'bg-rose-500 animate-pulse' : 'bg-indigo-500'}`}
                    style={{ width: `${(secondsLeft / 30) * 100}%` }}
                  />
                </div>
              )}
            </div>

            {/* Tic-Tac-Toe Board Wrapper with Animated Particle Background */}
            <div className="relative w-full max-w-[340px] mx-auto">
              {/* Floating animated particle background */}
              <div className="absolute inset-0 -inset-x-6 -inset-y-6 pointer-events-none overflow-hidden rounded-[40px] opacity-60">
                {[...Array(6)].map((_, i) => (
                  <motion.div
                    key={i}
                    className={`absolute w-3 h-3 rounded-full ${i % 2 === 0 ? 'bg-indigo-500/30' : 'bg-cyan-400/20'} blur-[1px]`}
                    initial={{
                      x: Math.random() * 320,
                      y: Math.random() * 320,
                      scale: Math.random() * 0.8 + 0.5
                    }}
                    animate={{
                      y: [null, Math.random() * -100 - 50, Math.random() * 100 + 50],
                      x: [null, Math.random() * 80 - 40, Math.random() * 80 - 40],
                      scale: [1, 1.4, 0.8]
                    }}
                    transition={{
                      duration: 6 + i * 2,
                      repeat: Infinity,
                      repeatType: 'reverse',
                      ease: 'easeInOut'
                    }}
                  />
                ))}
              </div>

              {/* Tic-Tac-Toe Board (3x3) */}
              <div className="relative aspect-square w-full grid grid-cols-3 gap-3 p-3 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-2xl backdrop-blur-xl">
                {roomState?.board.map((cell, index) => {
                  const isWinningCell = roomState.winningLine?.includes(index);
                  return (
                    <button
                      key={index}
                      onClick={() => handleCellClick(index)}
                      disabled={cell !== null || roomState.winner !== null || !isMyTurn || playerCount < 2}
                      className={`aspect-square rounded-2xl flex items-center justify-center text-5xl font-black transition-all duration-200 shadow-inner ${
                        cell === 'X' 
                          ? 'bg-cyan-500/15 border-2 border-cyan-500/50 text-cyan-400 shadow-cyan-500/20' 
                          : cell === 'O' 
                          ? 'bg-rose-500/15 border-2 border-rose-500/50 text-rose-400 shadow-rose-500/20'
                          : isMyTurn && roomState.winner === null && playerCount >= 2
                          ? 'bg-slate-950/60 border border-slate-800/80 hover:border-indigo-500/50 hover:bg-slate-950 cursor-pointer active:scale-95'
                          : 'bg-slate-950/40 border border-slate-900 cursor-not-allowed opacity-60'
                      } ${isWinningCell ? 'ring-4 ring-yellow-400 scale-105 animate-pulse' : ''}`}
                    >
                      {cell && <span className="animate-symbol-pop inline-block">{cell}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Game Over Actions / Rematch */}
            {roomState?.winner !== null && (
              <div className="text-center pt-1 animate-fade-in">
                <button
                  onClick={handleRestart}
                  className="px-6 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-rose-600 hover:from-indigo-500 hover:to-rose-500 text-white font-bold text-sm shadow-xl shadow-indigo-600/30 flex items-center justify-center gap-2 mx-auto transition active:scale-95"
                >
                  <RotateCcw className="w-4 h-4" /> Play Rematch
                </button>
              </div>
            )}

            {/* Emojis & Chat Toolbar */}
            <div className="flex items-center justify-between gap-2 pt-2">
              <div className="flex gap-1 bg-slate-900/80 p-1.5 rounded-2xl border border-slate-800">
                {['🔥', '👏', '😂', '😱', '👍', '❤️'].map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => sendEmojiReaction(emoji)}
                    className="w-8 h-8 rounded-xl hover:bg-slate-800 flex items-center justify-center text-base transition active:scale-90"
                    title={`Send ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setChatOpen(!chatOpen)}
                className="px-4 py-2.5 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-bold text-slate-300 flex items-center gap-1.5 transition"
              >
                <MessageSquare className="w-4 h-4 text-indigo-400" />
                Chat ({roomState?.chat.length || 0})
              </button>
            </div>

            {/* Chat Drawer / Modal */}
            {chatOpen && (
              <div className="p-3 rounded-2xl bg-slate-900/95 border border-slate-800 shadow-xl space-y-2 animate-fade-in">
                <div className="flex items-center justify-between pb-1 border-b border-slate-800">
                  <span className="text-xs font-bold text-slate-300">Room Chat</span>
                  <button onClick={() => setChatOpen(false)} className="text-xs text-slate-500 hover:text-slate-300">Close</button>
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1.5 pr-1 text-xs">
                  {roomState?.chat.length === 0 ? (
                    <p className="text-slate-500 text-center py-2">No messages yet. Say hi!</p>
                  ) : (
                    roomState?.chat.map(msg => (
                      <div key={msg.id} className="bg-slate-950/60 p-2 rounded-xl border border-slate-800/60">
                        <span className="font-bold text-indigo-400 mr-1.5">{msg.sender}:</span>
                        <span className="text-slate-200">{msg.text}</span>
                      </div>
                    ))
                  )}
                  <div ref={chatEndRef} />
                </div>
                <form onSubmit={handleSendChat} className="flex gap-1.5 pt-1">
                  <input
                    type="text"
                    placeholder="Type message..."
                    value={chatText}
                    onChange={e => setChatText(e.target.value)}
                    maxLength={100}
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-600 text-xs focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="submit"
                    className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition flex items-center justify-center"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="w-full max-w-md py-4 text-center text-[10px] text-slate-500 z-10">
        Duels Real-Time Tic-Tac-Toe • Open room link on any 2 mobile devices to play instantly.
      </footer>
    </div>
  );
}

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// Store rooms and participants
const rooms = new Map();
const participants = new Map();

class Room {
  constructor(id) {
    this.id = id;
    this.participants = new Map();
    this.createdAt = new Date();
  }

  addParticipant(socketId, participantData) {
    this.participants.set(socketId, participantData);
  }

  removeParticipant(socketId) {
    this.participants.delete(socketId);
    return this.participants.size === 0;
  }

  getParticipants() {
    return Array.from(this.participants.values());
  }
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

app.post('/api/create-room', (req, res) => {
  const roomId = generateRoomId();
  rooms.set(roomId, new Room(roomId));
  res.json({ roomId, url: `/room/${roomId}` });
});

// Socket.IO handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (data) => {
    const { roomId, userName } = data;
    
    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Room(roomId));
    }
    
    const room = rooms.get(roomId);
    socket.join(roomId);
    
    // Store participant info
    const participantData = {
      socketId: socket.id,
      userName,
      joinedAt: new Date()
    };
    
    room.addParticipant(socket.id, participantData);
    participants.set(socket.id, { roomId, userName });
    
    // Notify existing participants about new user
    socket.to(roomId).emit('user-joined', {
      socketId: socket.id,
      userName
    });
    
    // Send existing participants to new user
    const existingParticipants = room.getParticipants().filter(p => p.socketId !== socket.id);
    socket.emit('existing-participants', existingParticipants);
    
    console.log(`${userName} joined room ${roomId}`);
  });

  // WebRTC signaling
  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  // Media control events
  socket.on('toggle-video', (data) => {
    const participant = participants.get(socket.id);
    if (participant) {
      socket.to(participant.roomId).emit('user-video-toggle', {
        socketId: socket.id,
        videoEnabled: data.videoEnabled
      });
    }
  });

  socket.on('toggle-audio', (data) => {
    const participant = participants.get(socket.id);
    if (participant) {
      socket.to(participant.roomId).emit('user-audio-toggle', {
        socketId: socket.id,
        audioEnabled: data.audioEnabled
      });
    }
  });

  socket.on('disconnect', () => {
    const participant = participants.get(socket.id);
    if (participant) {
      const { roomId } = participant;
      const room = rooms.get(roomId);
      
      if (room) {
        const isEmpty = room.removeParticipant(socket.id);
        
        // Notify other participants
        socket.to(roomId).emit('user-left', {
          socketId: socket.id
        });
        
        // Remove empty room
        if (isEmpty) {
          rooms.delete(roomId);
        }
      }
      
      participants.delete(socket.id);
    }
    
    console.log('User disconnected:', socket.id);
  });
});

function generateRoomId() {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to start video conferencing`);
});

module.exports = app;
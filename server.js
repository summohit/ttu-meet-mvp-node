const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// Data structures
const rooms = {}; // roomName => { password, createdBy, createdAt, users: []}
const usersInRoom = {}; // roomName => [socket.id, ...]
const userInfo = {}; // socket.id => { username, roomName }

io.on("connection", socket => {
  console.log("New client connected:", socket.id);

  // Create a new room
  socket.on("create-room", ({ roomName, username, password }) => {
    console.log(`Create room request: ${roomName} by ${username}`);
    
    // Validate input
    if (!roomName || !username || !password) {
      socket.emit("room-error", { message: "All fields are required" });
      return;
    }

    // Check if room already exists
    if (rooms[roomName]) {
      socket.emit("room-error", { message: "Room already exists" });
      return;
    }

    // Create the room
    rooms[roomName] = {
      password: password,
      createdBy: username,
      createdAt: new Date(),
      users: []
    };
    
    usersInRoom[roomName] = [];
    userInfo[socket.id] = { username, roomName };

    // Join the creator to the room
    socket.join(roomName);
    usersInRoom[roomName].push(socket.id);
    rooms[roomName].users.push({ socketId: socket.id, username });

    socket.emit("room-created", { 
      roomName, 
      username, 
      message: "Room created successfully" 
    });

    console.log(`Room ${roomName} created by ${username}`);
  });

  // Join an existing room
  socket.on("join-room", ({ roomName, username, password }) => {
    console.log(`Join room request: ${roomName} by ${username}`);
    
    // Validate input
    if (!roomName || !username || !password) {
      socket.emit("room-error", { message: "All fields are required" });
      return;
    }

    // Check if room exists
    if (!rooms[roomName]) {
      socket.emit("room-error", { message: "Room does not exist" });
      return;
    }

    // Verify password
    if (rooms[roomName].password !== password) {
      socket.emit("room-error", { message: "Incorrect password" });
      return;
    }

    // Check if username is already taken in this room
    const existingUser = rooms[roomName].users.find(user => user.username === username);
    if (existingUser) {
      socket.emit("room-error", { message: "Username already taken in this room" });
      return;
    }

    // Join the room
    socket.join(roomName);
    userInfo[socket.id] = { username, roomName };
    
    if (!usersInRoom[roomName]) usersInRoom[roomName] = [];
    
    // Notify new user of existing users
    const others = usersInRoom[roomName].filter(id => id !== socket.id);
    const otherUsers = others.map(id => ({
      socketId: id,
      username: userInfo[id]?.username || 'Unknown'
    }));
    
    socket.emit("room-joined", { 
      roomName, 
      username,
      existingUsers: otherUsers
    });

    // Notify existing users about the newcomer
    socket.to(roomName).emit("user-joined", { 
      socketId: socket.id, 
      username 
    });

    // Update room data
    usersInRoom[roomName].push(socket.id);
    rooms[roomName].users.push({ socketId: socket.id, username });

    console.log(`${username} (${socket.id}) joined room ${roomName}`);
  });

  // Get room info
  socket.on("get-room-info", (roomName) => {
    if (rooms[roomName]) {
      socket.emit("room-info", {
        roomName,
        createdBy: rooms[roomName].createdBy,
        createdAt: rooms[roomName].createdAt,
        userCount: rooms[roomName].users.length,
        users: rooms[roomName].users.map(u => u.username)
      });
    } else {
      socket.emit("room-error", { message: "Room not found" });
    }
  });

  // WebRTC signaling events - FIXED: Now passing username
  socket.on("offer", ({ to, offer, username }) => {
    const senderInfo = userInfo[socket.id];
    const senderUsername = username || senderInfo?.username || 'Unknown';
    console.log(`Forwarding offer from ${senderUsername} (${socket.id}) to ${to}`);
    io.to(to).emit("offer", { 
      from: socket.id, 
      offer, 
      username: senderUsername 
    });
  });

  socket.on("answer", ({ to, answer }) => {
    const senderInfo = userInfo[socket.id];
    const answerUsername = senderInfo?.username || 'Unknown';
    console.log(`Forwarding answer from ${answerUsername} (${socket.id}) to ${to}`);
    io.to(to).emit("answer", { 
      from: socket.id, 
      answer,
      username: answerUsername
    });
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    io.to(to).emit("ice-candidate", { from: socket.id, candidate });
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    
    const user = userInfo[socket.id];
    if (user && user.roomName) {
      const roomName = user.roomName;
      
      // Remove from room tracking
      if (usersInRoom[roomName]) {
        usersInRoom[roomName] = usersInRoom[roomName].filter(id => id !== socket.id);
        
        // If room is empty, clean it up
        if (usersInRoom[roomName].length === 0) {
          delete usersInRoom[roomName];
          delete rooms[roomName];
          console.log(`Room ${roomName} deleted (empty)`);
        }
      }
      
      // Remove from room users list
      if (rooms[roomName]) {
        rooms[roomName].users = rooms[roomName].users.filter(u => u.socketId !== socket.id);
      }
      
      // Notify other users in the room
      socket.to(roomName).emit("user-left", { 
        socketId: socket.id, 
        username: user.username 
      });
      
      console.log(`${user.username} left room ${roomName}`);
    }
    
    // Clean up user info
    delete userInfo[socket.id];
  });

  // Leave room manually
  socket.on("leave-room", () => {
    const user = userInfo[socket.id];
    if (user && user.roomName) {
      const roomName = user.roomName;
      
      socket.leave(roomName);
      
      // Remove from tracking
      if (usersInRoom[roomName]) {
        usersInRoom[roomName] = usersInRoom[roomName].filter(id => id !== socket.id);
      }
      
      if (rooms[roomName]) {
        rooms[roomName].users = rooms[roomName].users.filter(u => u.socketId !== socket.id);
      }
      
      // Notify others
      socket.to(roomName).emit("user-left", { 
        socketId: socket.id, 
        username: user.username 
      });
      
      socket.emit("left-room", { roomName });
      delete userInfo[socket.id];
      
      console.log(`${user.username} manually left room ${roomName}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
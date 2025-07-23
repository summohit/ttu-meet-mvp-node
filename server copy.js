const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins (change in production)
    methods: ["GET", "POST"]
  }
});

const rooms = {}; // Keep track of users in rooms

io.on("connection", (socket) => {
  console.log("🔌 New client connected:", socket.id);

  socket.on("join", (room) => {
    socket.join(room);
    console.log(`📺 ${socket.id} joined room: ${room}`);

    if (!rooms[room]) rooms[room] = [];
    rooms[room].push(socket.id);

    const otherUsers = rooms[room].filter(id => id !== socket.id);
    if (otherUsers.length > 0) {
      socket.emit("joined"); // tell this user to initiate offer
    }

    // Forward signaling messages
    socket.on("offer", (data) => {
      socket.to(room).emit("offer", data);
    });

    socket.on("answer", (data) => {
      socket.to(room).emit("answer", data);
    });

    socket.on("ice-candidate", (data) => {
      socket.to(room).emit("ice-candidate", data);
    });

    socket.on("disconnect", () => {
      console.log(`❌ ${socket.id} disconnected`);
      if (rooms[room]) {
        rooms[room] = rooms[room].filter(id => id !== socket.id);
        if (rooms[room].length === 0) delete rooms[room];
      }
      socket.to(room).emit("user-disconnected", socket.id);
    });
  });
});

server.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
});

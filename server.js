const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const usersInRoom = {}; // roomName => [socket.id, ...]

io.on("connection", socket => {
  console.log("New client:", socket.id);

  socket.on("join", room => {
    socket.join(room);
    console.log(`${socket.id} joined ${room}`);
    if (!usersInRoom[room]) usersInRoom[room] = [];
    
    // Notify new user of existing users
    const others = usersInRoom[room].filter(id => id !== socket.id);
    socket.emit("all-users", others);

    // Notify existing users about the newcomer
    others.forEach(id =>
      io.to(id).emit("new-user", socket.id)
    );

    usersInRoom[room].push(socket.id);

    // Relay signaling messages
    socket.on("offer", ({ to, offer }) =>
      io.to(to).emit("offer", { from: socket.id, offer })
    );
    socket.on("answer", ({ to, answer }) =>
      io.to(to).emit("answer", { from: socket.id, answer })
    );
    socket.on("ice-candidate", ({ to, candidate }) =>
      io.to(to).emit("ice-candidate", { from: socket.id, candidate })
    );
    socket.on("disconnect", () => {
      console.log("Disconnected:", socket.id);
      usersInRoom[room] = usersInRoom[room].filter(id => id !== socket.id);
      socket.to(room).emit("user-left", socket.id);
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on port ${PORT}`));

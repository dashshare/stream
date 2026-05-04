const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

io.on('connection', (socket) => {
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(`ID ${socket.id} vào phòng: ${roomId}`);
  });

  socket.on('signal', (data) => {
    socket.to(data.roomId).emit('signal', data);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server đang chạy...`));

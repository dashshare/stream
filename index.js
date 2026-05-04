const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});
io.on('connection', (socket) => {
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    socket.to(roomId).emit('user-joined'); 
  });
  socket.on('signal', (data) => {
    socket.to(data.roomId).emit('signal', data);
  });
  socket.on('send-chat', (data) => {
    io.to(data.roomId).emit('receive-chat', data);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log("Server Stream & Chat đang chạy..."));

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('Thiết bị kết nối:', socket.id);

  socket.on('signal', (data) => {
    socket.broadcast.emit('signal', data);
  });

  socket.on('disconnect', () => {
    console.log('Thiết bị đã thoát:', socket.id);
  });
});
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server chạy tại: ${PORT}`);
});

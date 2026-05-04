const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: "*" }
});

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('Một thiết bị đã kết nối:', socket.id);
  socket.on('signal', (data) => {
    socket.broadcast.emit('signal', data);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server đang chạy tại port ${PORT}`);
});

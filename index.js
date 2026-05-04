const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

app.use(express.static('public'));

io.on('connection', (socket) => {
    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        socket.to(roomId).emit('user-joined', socket.id);
    });

    socket.on('signal', (data) => {
        socket.to(data.roomId).emit('signal', data);
    });

    socket.on('send-chat', (data) => {
        io.to(data.roomId).emit('receive-chat', data);
    });

    socket.on('disconnect', () => {
        console.log('Thiết bị thoát:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server chạy tại cổng ${PORT}`));

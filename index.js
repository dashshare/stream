const v2 = require('webdav-server').v2;
const express = require('express');
const auth = require('basic-auth');
const fs = require('fs');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 8080;
const STORAGE_ROOT = path.join(__dirname, 'storage_data');

if (!fs.existsSync(STORAGE_ROOT)) {
    fs.mkdirSync(STORAGE_ROOT, { recursive: true, mode: 0o777 });
}

const userRooms = {};

function createPrivateRoom(u, p) {
    const roomPath = path.join(STORAGE_ROOT, u);
    if (!fs.existsSync(roomPath)) {
        fs.mkdirSync(roomPath, { recursive: true, mode: 0o777 });
    }
    
    const server = new v2.WebDAVServer({
        requireSerializer: false
    });

    server.setFileSystemSync('/', new v2.PhysicalFileSystem(roomPath));
    
    return { server, pass: p };
}

app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; text-align:center; padding:50px; background:#f4f7f6;">
            <div style="display:inline-block; background:white; padding:40px; border-radius:20px; box-shadow: 0 10px 25px rgba(0,0,0,0.1);">
                <h2 style="color:#2c3e50;">🏠 Dashshare Room</h2>
                <form action="/setup-room" method="POST" style="text-align:left;">
                    <p>Tên người dùng:</p>
                    <input name="user" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:5px;" required>
                    <p>Mật khẩu:</p>
                    <input name="pass" type="password" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:5px;" required><br><br>
                    <button type="submit" style="width:100%; padding:12px; background:#3498db; color:white; border:none; border-radius:5px; cursor:pointer; font-weight:bold;">KÍCH HOẠT PHÒNG</button>
                </form>
            </div>
        </body>
    `);
});

app.post('/setup-room', (req, res) => {
    const { user, pass } = req.body;
    const u = user.trim();
    userRooms[u] = createPrivateRoom(u, pass.trim());
    res.send(`
        <div style="font-family:sans-serif; padding:30px; line-height:1.6;">
            <h3 style="color:#27ae60;">✅ Khởi tạo thành công!</h3>
            <p>Sử dụng Owlfiles kết nối với thông tin sau:</p>
            <ul style="background:#f9f9f9; padding:20px; border-radius:10px; list-style:none;">
                <li><b>Đường dẫn:</b> <code>/storage/${u}/</code></li>
                <li><b>User:</b> <code>${u}</code></li>
                <li><b>Password:</b> <code>(Mật khẩu bạn vừa đặt)</code></li>
            </ul>
            <p style="color:#e74c3c;">⚠️ <b>Lưu ý:</b> Phải có dấu / ở cuối đường dẫn.</p>
            <a href="/" style="text-decoration:none; color:#3498db;">← Quay lại trang chủ</a>
        </div>
    `);
});

app.use('/storage/:username*', (req, res) => {
    const username = req.params.username;
    const room = userRooms[username];

    if (!room) return res.status(404).send('Phòng này không tồn tại.');

    const credentials = auth(req);
    if (!credentials || credentials.name !== username || credentials.pass !== room.pass) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Dashshare Private"');
        return res.status(401).send('Sai tài khoản hoặc mật khẩu!');
    }

    const prefix = `/storage/${username}`;
    let targetUrl = (req.originalUrl || req.url).split('?')[0];

    if (targetUrl.startsWith(prefix)) {
        targetUrl = targetUrl.substring(prefix.length) || '/';
    }
    req.url = targetUrl.startsWith('/') ? targetUrl : '/' + targetUrl;

    room.server.executeRequest(req, res, '/');
});

app.listen(PORT, () => console.log(`Server Dashshare đang chạy tại cổng ${PORT}`));

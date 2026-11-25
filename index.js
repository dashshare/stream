const express = require('express');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 100 * 1024 * 1024
    }
});

const TEMP_DIR = path.join(__dirname, 'temp_media');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const fileStore = new Map();

function getBaseUrl(req) {
    const forwardedProto = req.get('x-forwarded-proto');
    const proto = forwardedProto ? forwardedProto.split(',')[0].trim() : (req.protocol || 'https');
    const host = req.get('x-forwarded-host') || req.get('host');
    return `${proto}://${host}`;
}

function cleanupFile(fileId) {
    const item = fileStore.get(fileId);
    if (item && item.timeoutId) {
        clearTimeout(item.timeoutId);
    }
    fileStore.delete(fileId);

    const filePath = item?.filePath || path.join(TEMP_DIR, `${fileId}.mp3`);
    if (fs.existsSync(filePath)) {
        fs.unlink(filePath, (err) => {
            if (err) {
                console.error(`[Cleanup Error] ${fileId}:`, err.message);
            }
        });
    }
}

function registerCachedFile(req, res, sendOnce, fileId, filePath, ttlSeconds) {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size < 1024) {
        cleanupFile(fileId);
        return sendOnce(502, { success: false, message: 'Cached mp3 file is empty or invalid' });
    }

    fileStore.set(fileId, {
        filePath,
        ttlSeconds,
        isTimerStarted: false,
        timeoutId: null
    });

    const baseUrl = getBaseUrl(req);
    return sendOnce(200, {
        success: true,
        media_id: fileId,
        local_stream_url: `${baseUrl}/media/${fileId}`
    });
}

app.post('/api/cache-media', upload.single('file'), async (req, res) => {
    const body = req.body || {};
    const parsedDuration = parseInt(body.duration, 10);
    const songDuration = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 240;
    const bufferSeconds = body.load_as_file ? 30 : 60;
    const ttlSeconds = songDuration + bufferSeconds;

    const fileId = crypto.randomBytes(16).toString('hex');
    const filePath = path.join(TEMP_DIR, `${fileId}.mp3`);
    let responded = false;

    const sendOnce = (statusCode, payload) => {
        if (!responded) {
            responded = true;
            res.status(statusCode).json(payload);
        }
    };

    if (req.file && req.file.buffer) {
        try {
            fs.writeFileSync(filePath, req.file.buffer);
            return registerCachedFile(req, res, sendOnce, fileId, filePath, ttlSeconds);
        } catch (writeErr) {
            cleanupFile(fileId);
            console.error('[Form File Write Error]:', writeErr.message);
            return sendOnce(500, { success: false, message: 'Failed to save uploaded mp3 file', error: writeErr.message });
        }
    }

    // 2. Fallback nếu gửi JSON { stream_url, duration }
    const { stream_url } = body;
    if (!stream_url || typeof stream_url !== 'string') {
        return res.status(400).json({ success: false, message: 'Missing file in form or invalid stream_url' });
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(stream_url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            return res.status(400).json({ success: false, message: 'Unsupported stream_url protocol' });
        }
    } catch (_) {
        return res.status(400).json({ success: false, message: 'Malformed stream_url' });
    }

    try {
        const response = await axios({
            method: 'get',
            url: parsedUrl.toString(),
            responseType: 'stream',
            timeout: 30000,
            maxRedirects: 5,
            validateStatus: (status) => status >= 200 && status < 300,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                'Accept': 'audio/mpeg,audio/*,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': `${parsedUrl.origin}/`
            }
        });

        const writer = fs.createWriteStream(filePath);

        response.data.on('error', (err) => {
            console.error('[Stream Read Error]:', err.message);
            writer.destroy();
            cleanupFile(fileId);
            sendOnce(502, { success: false, message: 'Upstream stream interrupted' });
        });

        writer.on('error', (err) => {
            console.error('[File Write Error]:', err.message);
            cleanupFile(fileId);
            sendOnce(500, { success: false, message: 'Failed to write cached mp3 file' });
        });

        writer.on('finish', () => {
            try {
                return registerCachedFile(req, res, sendOnce, fileId, filePath, ttlSeconds);
            } catch (statErr) {
                cleanupFile(fileId);
                return sendOnce(500, { success: false, message: 'Failed to verify cached mp3 file', error: statErr.message });
            }
        });

        response.data.pipe(writer);
    } catch (error) {
        cleanupFile(fileId);
        const upstreamStatus = error.response?.status;
        console.error('[Cache Error]:', upstreamStatus ? `HTTP ${upstreamStatus}` : '', error.message);
        return sendOnce(upstreamStatus === 403 ? 403 : 500, {
            success: false,
            message: upstreamStatus === 403 ? 'Upstream forbidden (403)' : 'Download failed',
            error: error.message
        });
    }
});

app.get('/media/:id', (req, res) => {
    const fileId = String(req.params.id || '').replace(/[^a-f0-9]/gi, '');
    if (!fileId) {
        return res.status(400).send('Invalid media ID.');
    }

    const item = fileStore.get(fileId);
    const filePath = item?.filePath || path.join(TEMP_DIR, `${fileId}.mp3`);

    if (!fs.existsSync(filePath)) {
        fileStore.delete(fileId);
        return res.status(404).send('Audio file expired or already deleted.');
    }

    if (item && !item.isTimerStarted) {
        item.isTimerStarted = true;
        const deleteDelayMs = item.ttlSeconds * 1000;

        console.log(`[Timer Started] GET request received for ${fileId}. File will auto-delete in ${item.ttlSeconds}s`);

        item.timeoutId = setTimeout(() => {
            cleanupFile(fileId);
            console.log(`[Auto Cleaned] File ${fileId}.mp3 deleted after ${item.ttlSeconds}s`);
        }, deleteDelayMs);
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'audio/mpeg');

    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (isNaN(start) || isNaN(end) || start > end || end >= fileSize) {
            res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
            return res.end();
        }

        const chunkSize = (end - start) + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Content-Length', chunkSize);

        const stream = fs.createReadStream(filePath, { start, end });
        stream.on('error', (err) => {
            console.error('[Stream Serve Error]:', err.message);
            if (!res.headersSent) res.status(500).end();
        });
        stream.pipe(res);
    } else {
        res.status(200);
        res.setHeader('Content-Length', fileSize);

        const stream = fs.createReadStream(filePath);
        stream.on('error', (err) => {
            console.error('[Stream Serve Error]:', err.message);
            if (!res.headersSent) res.status(500).end();
        });
        stream.pipe(res);
    }
});

app.delete('/media/:id', (req, res) => {
    const fileId = String(req.params.id || '').replace(/[^a-f0-9]/gi, '');
    if (fileId) {
        cleanupFile(fileId);
        console.log(`[Manual Delete] File ${fileId}.mp3 removed immediately.`);
    }
    return res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CDN Gateway active on port ${PORT}`));

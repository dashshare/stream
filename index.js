const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const TEMP_DIR = path.join(__dirname, 'temp_media');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const fileStore = new Map();

app.post('/api/cache-media', async (req, res) => {
    const { stream_url, duration, load_as_file } = req.body; 

    if (!stream_url) {
        return res.status(400).json({ success: false, message: 'Missing stream_url' });
    }

    const songDuration = parseInt(duration) || 240;
    const bufferSeconds = load_as_file ? 30 : 60;
    const ttlSeconds = songDuration + bufferSeconds;

    try {
        const fileId = crypto.randomBytes(16).toString('hex');
        const filePath = path.join(TEMP_DIR, `${fileId}.mp3`);

        const response = await axios({
            method: 'get',
            url: stream_url,
            responseType: 'stream',
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        writer.on('finish', () => {
            fileStore.set(fileId, {
                filePath,
                ttlSeconds,
                isTimerStarted: false,
                timeoutId: null
            });

            const serverHost = req.protocol + '://' + req.get('host');
            return res.json({
                success: true,
                media_id: fileId,
                local_stream_url: `${serverHost}/media/${fileId}`
            });
        });

        writer.on('error', (err) => {
            console.error('[Download Error]:', err);
            return res.status(500).json({ success: false, message: 'Failed to cache audio file' });
        });

    } catch (error) {
        console.error('[Cache Error]:', error.message);
        return res.status(500).json({ success: false, message: 'Download failed', error: error.message });
    }
});

app.get('/media/:id', (req, res) => {
    const fileId = req.params.id;
    const item = fileStore.get(fileId);

    if (!item || !fs.existsSync(item.filePath)) {
        return res.status(404).send('Audio file expired or already deleted.');
    }

    if (!item.isTimerStarted) {
        item.isTimerStarted = true;
        const deleteDelayMs = item.ttlSeconds * 1000;

        console.log(`[Timer Started] GET request received for ${fileId}. File will auto-delete in ${item.ttlSeconds}s`);

        item.timeoutId = setTimeout(() => {
            if (fs.existsSync(item.filePath)) {
                fs.unlink(item.filePath, (err) => {
                    if (!err) console.log(`[Auto Cleaned] File ${fileId}.mp3 deleted after ${item.ttlSeconds}s`);
                });
            }
            fileStore.delete(fileId);
        }, deleteDelayMs);
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    fs.createReadStream(item.filePath).pipe(res);
});

app.delete('/media/:id', (req, res) => {
    const fileId = req.params.id;
    const item = fileStore.get(fileId);

    if (item) {
        if (item.timeoutId) clearTimeout(item.timeoutId);
        if (fs.existsSync(item.filePath)) {
            fs.unlink(item.filePath, () => {});
        }
        fileStore.delete(fileId);
        console.log(`[Manual Delete] File ${fileId}.mp3 removed immediately.`);
    }

    return res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CDN Gateway active on port ${PORT}`));

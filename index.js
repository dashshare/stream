const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(express.json());

const KEY_SECRET = process.env.KEY_SECRET || "YOUR_SHARED_KEY_SECRET_HERE";
const JWT_SECRET = process.env.JWT_SECRET || "YOUR_INTERNAL_JWT_SECRET_KEY";
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "YOUR_DISCORD_BOT_TOKEN";
const PORT = process.env.PORT || 3000;

const activeSessions = new Map();

app.post('/auth/token', async (req, res) => {
    const { secret, guild_id } = req.body;

    if (!secret || secret !== KEY_SECRET) {
        return res.status(403).json({ success: false, error: 'Unauthorized: Invalid Key Secret' });
    }

    if (!guild_id) {
        return res.status(400).json({ success: false, error: 'Missing guild_id' });
    }

    try {
        const discordRes = await axios.get(`https://discord.com/api/v10/guilds/${guild_id}`, {
            headers: {
                'Authorization': `Bot ${DISCORD_BOT_TOKEN}`
            },
            timeout: 5000
        });

        if (discordRes.status !== 200 || !discordRes.data.id) {
            return res.status(404).json({ success: false, error: 'Discord Guild not found' });
        }

        const token = jwt.sign(
            { 
                guild_id: discordRes.data.id,
                guild_name: discordRes.data.name,
                timestamp: Date.now() 
            },
            JWT_SECRET,
            { expiresIn: '5m' }
        );

        return res.json({ success: true, token });

    } catch (error) {
        console.error("Discord Guild Validation Error:", error.response?.data || error.message);
        return res.status(400).json({ 
            success: false, 
            error: 'Failed to validate Discord Guild ID with Discord API' 
        });
    }
});

app.post('/auth/verify-token', (req, res) => {
    const token = req.headers['x-token'] || req.headers['authorization']?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ success: false, error: 'Missing X-TOKEN header' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        const sessionToken = crypto.randomBytes(24).toString('hex');

        activeSessions.set(sessionToken, {
            guild_id: decoded.guild_id,
            createdAt: Date.now(),
            expiresAt: Date.now() + 60 * 60 * 1000 
        });

        return res.json({ 
            success: true, 
            sessionToken: sessionToken 
        });

    } catch (err) {
        return res.status(403).json({ success: false, error: 'Invalid or expired JWT token' });
    }
});

app.get('/media/:mediaId', (req, res) => {
    const { mediaId } = req.params;
    const sessionToken = req.query.session;

    if (!sessionToken || !activeSessions.has(sessionToken)) {
        return res.status(403).send('Forbidden: Invalid or missing Session Token');
    }

    const session = activeSessions.get(sessionToken);
    if (Date.now() > session.expiresAt) {
        activeSessions.delete(sessionToken);
        return res.status(403).send('Forbidden: Session Token expired');
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    return res.send(`[Audio Stream Streamed Content for ${mediaId}]`);
});

app.listen(PORT, () => {
    console.log(`DashCDN Server running on port ${PORT}`);
});

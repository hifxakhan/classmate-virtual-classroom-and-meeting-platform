import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { AccessToken } from 'livekit-server-sdk';
import { installSocketHandlers } from './socket-handlers.js';

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

installSocketHandlers(io);

app.get('/health', (_req, res) => {
  res.json({
    success: true,
    service: 'classmate-sfu-signaling',
    timestamp: Date.now()
  });
});

app.post('/api/sfu/token', async (req, res) => {
  try {
    const { roomName, identity, name, role } = req.body || {};

    if (!roomName || !identity) {
      return res.status(400).json({ success: false, error: 'roomName and identity are required' });
    }

    if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      return res.status(500).json({ success: false, error: 'Missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET' });
    }

    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity,
      name: name || identity,
      metadata: JSON.stringify({
        role: role || 'student'
      }),
      ttl: '2h'
    });

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    });

    return res.json({
      success: true,
      token: await token.toJwt(),
      roomName,
      identity
    });
  } catch (err) {
    console.error('Token generation error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Token generation failed' });
  }
});

const port = Number(process.env.PORT || 4001);
server.listen(port, () => {
  console.log(`SFU signaling server listening on ${port}`);
});

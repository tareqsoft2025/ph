import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { Server } from 'socket.io';
import { buildRouter } from './routes.js';
import { verifyToken } from './auth.js';
import { ensureSeed } from './seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

ensureSeed();

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// كل جهاز متصل يجب أن يرسل التوكن
io.use((socket, next) => {
  try {
    socket.user = verifyToken(socket.handshake.auth?.token);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

const emit = (event, payload) => io.emit(event, payload ?? {});

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/api', buildRouter(emit));
app.use('/api', (req, res) => res.status(404).json({ error: 'المسار غير موجود' }));

// تقديم واجهة الويب المبنية
const webDist = join(__dirname, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|socket\.io).*/, (req, res) => res.sendFile(join(webDist, 'index.html')));
}

// معالج الأخطاء
app.use((err, req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'خطأ في الخادم' : err.message });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ خادم المطعم يعمل على المنفذ ${PORT}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`   عنوان الخادم للأجهزة: http://${n.address}:${PORT}`);
    }
  }
});

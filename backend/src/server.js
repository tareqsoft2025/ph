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
import { get } from './db.js';
import { loadServiceAccount, createPushSender } from './push.js';
import { setPushSender, setWebPush } from './notify.js';
import { createWebPush } from './webpush.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

ensureSeed();

// الإشعارات الفورية (Firebase) — اختيارية
const serviceAccount = loadServiceAccount();
const pushSender = createPushSender(serviceAccount);
if (pushSender) {
  setPushSender(pushSender);
  console.log(`🔔 الإشعارات الفورية مفعّلة (Firebase: ${serviceAccount.project_id})`);
} else {
  console.log('ℹ️  الإشعارات الفورية غير مفعّلة — راجع docs/FIREBASE.md');
}

// إشعارات Web Push لزبائن QR (VAPID): تُفعَّل تلقائياً وتُولَّد مفاتيحها مرة واحدة
try { setWebPush(createWebPush()); } catch (e) { console.error('⚠️ تعذّر تفعيل Web Push:', e.message); }

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

// قناة الزبون العامة: تتابع طلباً واحداً برمز المتابعة فقط، ولا تستقبل أحداث النظام
const pub = io.of('/public');
pub.on('connection', (socket) => {
  socket.on('watch', (msg, ack) => {
    const o = get("SELECT id, track_token FROM orders WHERE code = ? AND source = 'online'", String(msg?.code || ''));
    const ok = !!(o && o.track_token && o.track_token === String(msg?.token || ''));
    if (ok) socket.join(`o:${o.id}`);
    if (typeof ack === 'function') ack(ok);
  });
});

const emit = (event, payload) => {
  if (event === 'public-order') { pub.to(`o:${payload}`).emit('update'); return; }
  io.emit(event, payload ?? {});
};

app.use(cors());
app.use(express.json({ limit: '5mb' })); // يتسع لمستندات الموظفين
app.use('/api', buildRouter(emit));
app.use('/api', (req, res) => res.status(404).json({ error: 'المسار غير موجود' }));

// تنزيل تطبيق الأندرويد من مجلد apk/ في المشروع
const apkDir = join(__dirname, '..', '..', 'apk');
app.get('/apk/restaurant-app.apk', (req, res, next) => {
  const file = join(apkDir, 'restaurant-app.apk');
  if (!existsSync(file)) return next();
  res.download(file, 'restaurant-app.apk', { headers: { 'Content-Type': 'application/vnd.android.package-archive', 'Cache-Control': 'no-cache' } });
});
app.get('/apk/version.json', (req, res, next) => {
  const file = join(apkDir, 'version.json');
  if (!existsSync(file)) return next();
  res.set('Cache-Control', 'no-cache').sendFile(file);
});

// تقديم واجهة الويب المبنية
const webDist = join(__dirname, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|apk|socket\.io).*/, (req, res) => res.sendFile(join(webDist, 'index.html')));
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

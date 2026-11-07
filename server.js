// Server kecil: menyajikan aplikasi + API sinkronisasi ke database Neon (PostgreSQL).
// Variabel lingkungan (diisi di dashboard hosting, BUKAN di GitHub):
//   DATABASE_URL  = connection string dari Neon (wajib)
//   APP_API_KEY   = kunci bebas buatanmu (opsional, harus sama dengan SYNC_KEY di index.html)
//   PORT          = diisi otomatis oleh hosting

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.APP_API_KEY || '';
const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
    console.error('DATABASE_URL belum diisi. Tambahkan di Environment Variables hosting.');
}

const pool = new Pool({
    connectionString: DB_URL,
    ssl: DB_URL && /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false }
});

const ready = pool.query(
    "CREATE TABLE IF NOT EXISTS app_state (id text PRIMARY KEY, data jsonb NOT NULL, version bigint NOT NULL DEFAULT 1)"
).then(() => console.log('Database siap.')).catch(err => console.error('Gagal menyiapkan database:', err.message));

const MIME = {
    '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.css': 'text/css', '.txt': 'text/plain'
};
// Berkas yang tidak boleh diunduh lewat web
const BLOCKED = new Set(['server.js', 'package.json', 'package-lock.json', '.env', 'capacitor.config.json']);

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key');
    res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
}

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', c => {
            size += c.length;
            if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

async function handleApi(req, res) {
    if (API_KEY && req.headers['x-app-key'] !== API_KEY) {
        return sendJson(res, 401, { error: 'Kunci aplikasi salah' });
    }
    await ready;

    if (req.method === 'GET') {
        const r = await pool.query("SELECT data, version FROM app_state WHERE id = 'main'");
        if (r.rows.length === 0) return sendJson(res, 200, { empty: true });
        return sendJson(res, 200, { data: r.rows[0].data, version: Number(r.rows[0].version) });
    }

    if (req.method === 'PUT') {
        let body;
        try { body = JSON.parse(await readBody(req, 5 * 1024 * 1024)); }
        catch (e) { return sendJson(res, e.status || 400, { error: 'Data tidak valid' }); }

        const { expectedVersion, data } = body || {};
        if (!Array.isArray(data)) return sendJson(res, 400, { error: 'data harus berupa array' });
        const json = JSON.stringify(data);

        let r;
        if (expectedVersion === null || expectedVersion === undefined) {
            r = await pool.query(
                "INSERT INTO app_state (id, data, version) VALUES ('main', $1::jsonb, 1) ON CONFLICT (id) DO NOTHING RETURNING version",
                [json]
            );
        } else {
            r = await pool.query(
                "UPDATE app_state SET data = $1::jsonb, version = version + 1 WHERE id = 'main' AND version = $2 RETURNING version",
                [json, Number(expectedVersion)]
            );
        }
        if (r.rows.length === 0) return sendJson(res, 409, { error: 'Versi berubah, ulangi' });
        return sendJson(res, 200, { version: Number(r.rows[0].version) });
    }

    sendJson(res, 405, { error: 'Metode tidak didukung' });
}

function serveStatic(req, res) {
    let pathname = decodeURIComponent(req.url.split('?')[0]);
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    const file = path.normalize(path.join(__dirname, pathname));
    const name = path.basename(file).toLowerCase();
    const ext = path.extname(file).toLowerCase();

    const allowed = file.startsWith(__dirname + path.sep) && !BLOCKED.has(name) && !name.startsWith('.') && MIME[ext];
    const target = allowed && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(__dirname, 'index.html');

    fs.readFile(target, (err, buf) => {
        if (err) { res.writeHead(404); return res.end('Tidak ditemukan'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
    });
}

http.createServer(async (req, res) => {
    try {
        if (req.url.startsWith('/api/')) {
            cors(res);
            if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
            if (req.url.split('?')[0] === '/api/health') return sendJson(res, 200, { ok: true });
            if (req.url.split('?')[0] === '/api/state') return await handleApi(req, res);
            return sendJson(res, 404, { error: 'Tidak ditemukan' });
        }
        serveStatic(req, res);
    } catch (err) {
        console.error(err);
        if (!res.headersSent) sendJson(res, 500, { error: 'Kesalahan server' });
    }
}).listen(PORT, () => console.log('Server berjalan di port ' + PORT));

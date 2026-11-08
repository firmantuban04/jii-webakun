// Fungsi Vercel: dokumentasi kegiatan (daftar publik; tambah/ubah/hapus hanya untuk Ketua Umum, Mentor, Pengurus).
const { DB_URL, getPool, ensureTables } = require('./_db');

const API_KEY = process.env.APP_API_KEY || '';
const ALLOWED_ROLES = ['ketua', 'mentor', 'pengurus'];
const MAX_FOTO_BYTES = 1500000;

function sendJson(res, status, obj) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(obj));
}

function readJson(req) {
    if (req.body !== undefined && req.body !== null) {
        if (typeof req.body === 'string') return Promise.resolve(JSON.parse(req.body));
        if (Buffer.isBuffer(req.body)) return Promise.resolve(JSON.parse(req.body.toString('utf8')));
        return Promise.resolve(req.body);
    }
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', c => {
            size += c.length;
            if (size > 4 * 1024 * 1024) { reject(new Error('too large')); return; }
            chunks.push(c);
        });
        req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
        req.on('error', reject);
    });
}

// Periksa NIS + password terhadap data santri/pengurus yang tersimpan di server
async function verifyUser(auth) {
    if (!auth || typeof auth.nis !== 'string' || typeof auth.password !== 'string') return null;
    const r = await getPool().query("SELECT data FROM app_state WHERE id = 'main'");
    if (r.rows.length === 0 || !Array.isArray(r.rows[0].data)) return null;
    const nis = auth.nis.trim().toUpperCase();
    const user = r.rows[0].data.find(s => s && String(s.nis).toUpperCase() === nis);
    if (!user) return null;
    if ((user.password || '123456') !== auth.password) return null;
    if (!ALLOWED_ROLES.includes(user.role)) return null;
    return user;
}

function mapRow(row) {
    return {
        id: row.id,
        judul: row.judul,
        tanggal: row.tanggal,
        deskripsi: row.deskripsi,
        tautan: row.tautan,
        dibuat_oleh: row.dibuat_oleh,
        diubah: Number(row.diubah),
        ada_foto: !!row.ada_foto
    };
}

const LIST_SQL = "SELECT id, judul, tanggal, deskripsi, tautan, dibuat_oleh, diubah, (foto IS NOT NULL) AS ada_foto FROM dokumentasi ORDER BY tanggal DESC, diubah DESC LIMIT 200";

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    if (!DB_URL) return sendJson(res, 503, { error: 'DATABASE_URL belum diisi di Vercel' });

    try {
        await ensureTables();

        if (req.method === 'GET') {
            const r = await getPool().query(LIST_SQL);
            return sendJson(res, 200, { items: r.rows.map(mapRow) });
        }

        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Metode tidak didukung' });

        if (API_KEY && req.headers['x-app-key'] !== API_KEY) return sendJson(res, 401, { error: 'Kunci aplikasi salah' });

        let body;
        try { body = await readJson(req); }
        catch (e) { return sendJson(res, 400, { error: 'Data tidak valid' }); }

        const user = await verifyUser(body && body.auth);
        if (!user) return sendJson(res, 403, { error: 'Akun tidak berhak mengubah dokumentasi' });

        if (body.aksi === 'hapus') {
            const id = String(body.id || '');
            const r = await getPool().query('DELETE FROM dokumentasi WHERE id = $1 RETURNING id', [id]);
            if (r.rows.length === 0) return sendJson(res, 404, { error: 'Dokumentasi tidak ditemukan' });
            return sendJson(res, 200, { ok: true });
        }

        if (body.aksi !== 'simpan') return sendJson(res, 400, { error: 'Aksi tidak dikenal' });

        const item = body.item || {};
        const judul = String(item.judul || '').trim();
        const tanggal = String(item.tanggal || '').trim();
        const deskripsi = String(item.deskripsi || '').trim();
        const tautan = String(item.tautan || '').trim();
        if (!judul || judul.length > 150) return sendJson(res, 400, { error: 'Judul wajib diisi (maksimal 150 huruf)' });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return sendJson(res, 400, { error: 'Tanggal tidak valid' });
        if (deskripsi.length > 2000) return sendJson(res, 400, { error: 'Deskripsi terlalu panjang' });
        if (tautan && (tautan.length > 500 || !/^https?:\/\//i.test(tautan))) return sendJson(res, 400, { error: 'Tautan harus diawali http:// atau https://' });

        // foto: tidak ada kunci = tidak diubah, null = hapus, string = foto baru
        let fotoAksi = 'tetap', fotoBuf = null, fotoTipe = null;
        if (Object.prototype.hasOwnProperty.call(item, 'foto')) {
            if (item.foto === null) {
                fotoAksi = 'hapus';
            } else {
                const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(item.foto));
                if (!m) return sendJson(res, 400, { error: 'Format foto tidak didukung' });
                fotoBuf = Buffer.from(m[2], 'base64');
                if (fotoBuf.length > MAX_FOTO_BYTES) return sendJson(res, 400, { error: 'Foto terlalu besar' });
                fotoTipe = m[1];
                fotoAksi = 'ganti';
            }
        }

        const now = Date.now();
        let id = item.id ? String(item.id) : '';
        if (id) {
            const ada = await getPool().query('SELECT id FROM dokumentasi WHERE id = $1', [id]);
            if (ada.rows.length === 0) return sendJson(res, 404, { error: 'Dokumentasi tidak ditemukan' });
            await getPool().query(
                'UPDATE dokumentasi SET judul = $2, tanggal = $3, deskripsi = $4, tautan = $5, diubah = $6 WHERE id = $1',
                [id, judul, tanggal, deskripsi, tautan, now]
            );
            if (fotoAksi !== 'tetap') {
                await getPool().query('UPDATE dokumentasi SET foto = $2, foto_tipe = $3 WHERE id = $1', [id, fotoBuf, fotoTipe]);
            }
        } else {
            id = 'dok_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 8);
            await getPool().query(
                'INSERT INTO dokumentasi (id, judul, tanggal, deskripsi, tautan, dibuat_oleh, foto, foto_tipe, diubah) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                [id, judul, tanggal, deskripsi, tautan, String(user.nama || ''), fotoBuf, fotoTipe, now]
            );
        }
        return sendJson(res, 200, { ok: true, id: id });
    } catch (err) {
        console.error(err);
        return sendJson(res, 500, { error: 'Kesalahan server' });
    }
};

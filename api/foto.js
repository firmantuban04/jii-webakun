// Fungsi Vercel: menyajikan foto dokumentasi (publik, di-cache lama karena alamatnya memuat versi).
const { DB_URL, getPool, ensureTables } = require('./_db');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }
    if (!DB_URL) { res.statusCode = 503; return res.end(); }

    try {
        const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
        await ensureTables();
        const r = await getPool().query('SELECT foto, foto_tipe FROM dokumentasi WHERE id = $1', [id]);
        if (r.rows.length === 0 || !r.rows[0].foto) { res.statusCode = 404; return res.end(); }
        res.statusCode = 200;
        res.setHeader('Content-Type', r.rows[0].foto_tipe || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.end(r.rows[0].foto);
    } catch (err) {
        console.error(err);
        res.statusCode = 500;
        res.end();
    }
};

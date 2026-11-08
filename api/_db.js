// Bagian bersama untuk fungsi Vercel yang memakai database Neon.
const { Pool } = require('pg');

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

let pool = null;
let ready = null;

function getPool() {
    if (!pool) {
        pool = new Pool({
            connectionString: DB_URL,
            max: 1,
            idleTimeoutMillis: 10000,
            ssl: /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false }
        });
        pool.on('error', e => console.error('Pool error:', e.message));
    }
    return pool;
}

function ensureTables() {
    if (!ready) {
        ready = getPool()
            .query('CREATE TABLE IF NOT EXISTS app_state (id text PRIMARY KEY, data jsonb NOT NULL, version bigint NOT NULL DEFAULT 1)')
            .then(() => getPool().query(
                'CREATE TABLE IF NOT EXISTS dokumentasi (' +
                'id text PRIMARY KEY, judul text NOT NULL, tanggal text NOT NULL, ' +
                "deskripsi text NOT NULL DEFAULT '', tautan text NOT NULL DEFAULT '', " +
                "dibuat_oleh text NOT NULL DEFAULT '', foto bytea, foto_tipe text, diubah bigint NOT NULL)"
            ))
            .catch(err => { ready = null; throw err; });
    }
    return ready;
}

module.exports = { DB_URL, getPool, ensureTables };

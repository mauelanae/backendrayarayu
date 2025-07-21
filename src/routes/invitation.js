// invitation-and-message-routes.js
// -----------------------------------------------------------------------------
// Refactored Express router + message controller integrating invitations ⇄ checkins ⇄ messages.
// Key improvements:
// - Consistent column names (rsvp_status, checked_in, checked_in_at) to match DB schema.
// - Parameter validation + helpful error responses.
// - Central query helpers to reduce duplication.
// - Automatic check-in flow: updates invitations + inserts/updates checkins log.
// - Safer slug generation + collision retry.
// - Expanded list endpoint: optional include=checkins,messages query flags.
// - Unified error handler wrapper.
// -----------------------------------------------------------------------------

import express from 'express';
import db from '../config/db.js';
import slugify from 'slugify';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const BASE_LINK = process.env.INVITATION_LINK_BASE ?? '';

// -----------------------------------------------------------------------------
// Utility: async route wrapper to bubble errors to express error handler
// -----------------------------------------------------------------------------
const awrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// -----------------------------------------------------------------------------
// Utility: build QR link + image URL
// -----------------------------------------------------------------------------
function buildInvitationLink(slug) {
  return `${BASE_LINK}/confirm/${slug}`;
}
function buildQrUrl(link) {
  return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(link)}&size=200x200`;
}

// -----------------------------------------------------------------------------
// Utility: generate a unique slug (retry up to N times if collision)
// -----------------------------------------------------------------------------
async function generateUniqueSlug(name, maxAttempts = 5) {
  let attempt = 0;
  const base = slugify(name || 'guest', { lower: true, strict: true });
  while (attempt < maxAttempts) {
    const rand = Math.floor(1000 + Math.random() * 9000);
    const slug = `${base}-${rand}`;
    const [rows] = await db.query('SELECT id FROM invitations WHERE slug = ? LIMIT 1', [slug]);
    if (rows.length === 0) return slug;
    attempt++;
  }
  throw new Error('Failed to generate unique slug after multiple attempts');
}

// -----------------------------------------------------------------------------
// Validation helpers
// -----------------------------------------------------------------------------
function required(v) {
  return v !== undefined && v !== null && v !== '';
}

function isEnum(v, allowed) {
  return allowed.includes(v);
}

// -----------------------------------------------------------------------------
// SQL snippets
// -----------------------------------------------------------------------------
const INVITATION_COLUMNS = `id, \`from\`, name, category, phone, qty, type, slug, qrcode, rsvp_status, checked_in, checked_in_at, created_at, real_qty`;

const SELECT_INVITATION_BASE = `SELECT ${INVITATION_COLUMNS} FROM invitations`;

// -----------------------------------------------------------------------------
// 🚀 1. CREATE Invitation
// -----------------------------------------------------------------------------
router.post('/', awrap(async (req, res) => {
  const { from, name, category, phone, qty, type } = req.body;

  // Basic validation
  if (!required(name)) return res.status(400).json({ error: 'Field name wajib diisi.' });
  if (!required(type) || !isEnum(type, ['digital', 'cetak'])) return res.status(400).json({ error: "Field type harus 'digital' atau 'cetak'." });

  const qtyVal = qty == null ? null : Number(qty);
  const catVal = category == null ? null : Number(category);

  const slug = await generateUniqueSlug(name);
  const link = buildInvitationLink(slug);
  const qrcode = buildQrUrl(link);

  const sql = `
    INSERT INTO invitations (
      \`from\`, name, category, phone, qty, type, slug, qrcode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const values = [from ?? null, name, catVal, phone ?? null, qtyVal, type, slug, qrcode];

  const [result] = await db.query(sql, values);

  res.status(201).json({
    message: 'Undangan berhasil dibuat.',
    id: result.insertId,
    slug,
    qrcode,
    link,
  });
}));

// -----------------------------------------------------------------------------
// 🚀 2. GET Invitation list (filter by type, category, checked_in, rsvp_status, search)
// Optional include=checkins,messages to embed related summaries.
// -----------------------------------------------------------------------------
router.get('/', awrap(async (req, res) => {
  const { type, category, checked_in, rsvp_status, search, include } = req.query;

  const where = [];
  const params = [];

  if (required(type)) { where.push('type = ?'); params.push(type); }
  if (required(category)) { where.push('category = ?'); params.push(Number(category)); }
  if (required(checked_in)) { where.push('checked_in = ?'); params.push(Number(checked_in) ? 1 : 0); }
  if (required(rsvp_status)) { where.push('rsvp_status = ?'); params.push(rsvp_status); }
  if (required(search)) {
    where.push('(name LIKE ? OR phone LIKE ? OR slug LIKE ? OR `from` LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  const sql = `${SELECT_INVITATION_BASE} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC`;
  const [rows] = await db.query(sql, params);

  // If include flags -> attach related minimal data in arrays keyed by invitation id
  const includes = (include || '').split(',').map(s => s.trim()).filter(Boolean);
  const needCheckins = includes.includes('checkins');
  const needMessages = includes.includes('messages');

  let checkinMap = {};
  let messageMap = {};

  if (rows.length && (needCheckins || needMessages)) {
    const ids = rows.map(r => r.id);

    if (needCheckins) {
      const [crows] = await db.query(`
        SELECT c.*, i.id AS invitation_id
        FROM checkins c
        JOIN invitations i ON i.id = c.invitation_id
        WHERE c.invitation_id IN (${ids.map(() => '?').join(',')})
        ORDER BY c.checked_in_at ASC
      `, ids);
      for (const c of crows) {
        (checkinMap[c.invitation_id] ||= []).push(c);
      }
    }

    if (needMessages) {
      const [mrows] = await db.query(`
        SELECT m.*, i.id AS invitation_id
        FROM messages m
        JOIN invitations i ON i.id = m.invitation_id
        WHERE m.invitation_id IN (${ids.map(() => '?').join(',')})
        ORDER BY m.created_at ASC
      `, ids);
      for (const m of mrows) {
        (messageMap[m.invitation_id] ||= []).push(m);
      }
    }
  }

  const data = rows.map(r => ({
    ...r,
    checkins: needCheckins ? (checkinMap[r.id] ?? []) : undefined,
    messages: needMessages ? (messageMap[r.id] ?? []) : undefined,
  }));

  res.json(data);
}));

// -----------------------------------------------------------------------------
// 🚀 3. GET Invitation detail by slug (optionally include relations via ?include=checkins,messages)
// -----------------------------------------------------------------------------
router.get('/:slug', awrap(async (req, res) => {
  const { slug } = req.params;
  const { include } = req.query;

  const [rows] = await db.query(`${SELECT_INVITATION_BASE} WHERE slug = ? LIMIT 1`, [slug]);
  if (!rows.length) return res.status(404).json({ error: 'Undangan tidak ditemukan.' });
  const inv = rows[0];

  const includes = (include || '').split(',').map(s => s.trim()).filter(Boolean);
  if (includes.includes('checkins')) {
    const [crows] = await db.query('SELECT * FROM checkins WHERE invitation_id = ? ORDER BY checked_in_at ASC', [inv.id]);
    inv.checkins = crows;
  }
  if (includes.includes('messages')) {
    const [mrows] = await db.query('SELECT * FROM messages WHERE invitation_id = ? ORDER BY created_at ASC', [inv.id]);
    inv.messages = mrows;
  }

  res.json(inv);
}));

// -----------------------------------------------------------------------------
// 🚀 4. PATCH Kehadiran manual (input status + jumlah_real)
// Body: { rsvp_status: 'Hadir'|'Tidak Hadir'|'Belum Konfirmasi', jumlah_real: <int|null> }
// -----------------------------------------------------------------------------
router.patch('/:slug/kehadiran', awrap(async (req, res) => {
  const { slug } = req.params;
  let { rsvp_status, jumlah_real } = req.body; // renamed from hadir -> rsvp_status for clarity

  if (!required(rsvp_status)) return res.status(400).json({ error: 'rsvp_status wajib diisi.' });
  if (!isEnum(rsvp_status, ['Belum Konfirmasi', 'Hadir', 'Tidak Hadir'])) {
    return res.status(400).json({ error: "rsvp_status harus salah satu: 'Belum Konfirmasi','Hadir','Tidak Hadir'." });
  }
  jumlah_real = jumlah_real == null || jumlah_real === '' ? null : Number(jumlah_real);

  const [result] = await db.query('UPDATE invitations SET rsvp_status = ?, real_qty = ? WHERE slug = ?', [rsvp_status, jumlah_real, slug]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Undangan tidak ditemukan.' });

  const [rows] = await db.query('SELECT rsvp_status, real_qty, qrcode FROM invitations WHERE slug = ? LIMIT 1', [slug]);
  res.json({
    message: 'Kehadiran berhasil dikonfirmasi.',
    rsvp_status: rows[0].rsvp_status,
    real_qty: rows[0].real_qty,
    qrcode: rows[0].qrcode,
  });
}));

// -----------------------------------------------------------------------------
// 🚀 5. PATCH Check-in otomatis dari QR scanner
// Flow:
//  - lookup invitation by slug
//  - if already checked_in, increment scan_count in checkins + update last_scan_at
//  - else mark invitations.checked_in=1, checked_in_at=NOW(), rsvp_status='Hadir', real_qty=qty (default) unless provided override
//  - insert checkins row (or update existing) with checked_in_qty
// Body optional: { checked_in_qty, device_note }
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// 🚀 5. PATCH Check-in otomatis dari QR scanner (Revisi: TIDAK menyentuh rsvp_status)
// Body optional: { checked_in_qty, device_note, refresh_rsvp: boolean? (ignored) }
// -----------------------------------------------------------------------------
router.patch('/checkin/:slug', awrap(async (req, res) => {
  const { slug } = req.params;
  const { checked_in_qty, device_note } = req.body ?? {};

  // 1. Ambil undangan
  const [rows] = await db.query('SELECT * FROM invitations WHERE slug = ? LIMIT 1', [slug]);
  if (!rows.length) return res.status(404).json({ error: 'Undangan tidak ditemukan.' });
  const inv = rows[0];

  // 2. Tentukan jumlah hadir yang dicatat
  //    - Prioritas body.checked_in_qty
  //    - Kalau kosong, fallback ke inv.real_qty
  //    - Kalau itu juga null, fallback ke inv.qty (jumlah undangan awal)
  const qtyToUse =
    checked_in_qty != null
      ? Number(checked_in_qty)
      : (inv.real_qty != null ? inv.real_qty : inv.qty);

  // 3. Upsert log checkins
  const [cRows] = await db.query(
    'SELECT id, scan_count, checked_in_qty, device_note FROM checkins WHERE invitation_id = ? LIMIT 1',
    [inv.id]
  );

  let scanCount;
  if (!cRows.length) {
    // Insert pertama
    scanCount = 1;
    await db.query(
      `INSERT INTO checkins (invitation_id, checked_in_qty, scan_count, device_note)
       VALUES (?, ?, ?, ?)`,
      [inv.id, qtyToUse ?? 0, scanCount, device_note ?? null]
    );
  } else {
    // Update existing
    const c = cRows[0];
    scanCount = Number(c.scan_count) + 1;
    await db.query(
      `UPDATE checkins
         SET checked_in_qty = ?,
             scan_count = ?,
             device_note = ?
       WHERE id = ?`,
      [qtyToUse ?? c.checked_in_qty ?? 0, scanCount, device_note ?? c.device_note ?? null, c.id]
    );
  }

  // 4. Update status check-in pada invitations (TANPA menyentuh rsvp_status)
  if (!inv.checked_in) {
    await db.query(
      `UPDATE invitations
          SET checked_in = 1,
              checked_in_at = NOW(),
              real_qty = COALESCE(?, real_qty, qty)  -- jika real_qty belum ada, isi
       WHERE id = ?`,
      [qtyToUse, inv.id]
    );
  } else {
    // Sudah pernah check-in → hanya update checked_in_at (opsional, berguna untuk log terakhir scan)
    await db.query(
      `UPDATE invitations
          SET checked_in_at = NOW()
       WHERE id = ?`,
      [inv.id]
    );
  }

  // 5. Ambil data terbaru untuk response
  const [[updated]] = await db.query('SELECT checked_in, checked_in_at, real_qty FROM invitations WHERE id = ? LIMIT 1', [inv.id]);

  res.json({
    message: inv.checked_in ? 'Scan diterima (tamu sudah pernah check-in).' : 'Check-in berhasil.',
    name: inv.name,
    qty_recorded: qtyToUse,
    scan_count: scanCount,
    checked_in: updated.checked_in === 1,
    checked_in_at: updated.checked_in_at,
    real_qty: updated.real_qty,
    rsvp_status: inv.rsvp_status, // tidak diubah
  });
}));

// -----------------------------------------------------------------------------
// 🗑️ DELETE Invitation (optional helper)
// -----------------------------------------------------------------------------
router.delete('/:id', awrap(async (req, res) => {
  const { id } = req.params;
  const [result] = await db.query('DELETE FROM invitations WHERE id = ?', [id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Undangan tidak ditemukan.' });
  res.json({ message: 'Undangan dihapus.' });
}));

// ============================================================================
// MESSAGE CONTROLLERS + ROUTER SEGMENT
// ============================================================================
const messageRouter = express.Router();

// ✅ Get all messages (join invitations)
messageRouter.get('/', awrap(async (req, res) => {
  const [rows] = await db.query(`
    SELECT 
      m.id,
      m.message,
      m.created_at,
      m.invitation_id,
      i.name AS guest_name,
      i.rsvp_status AS attendance_status,
      i.checked_in AS checked_in,
      i.checked_in_at AS checked_in_at
    FROM messages m
    JOIN invitations i ON m.invitation_id = i.id
    ORDER BY m.created_at DESC
  `);
  res.json(rows);
}));

// ✅ Get message by ID
messageRouter.get('/:id', awrap(async (req, res) => {
  const { id } = req.params;
  const [rows] = await db.query(`
    SELECT 
      m.id,
      m.message,
      m.created_at,
      m.invitation_id,
      i.name AS guest_name,
      i.rsvp_status AS attendance_status,
      i.checked_in AS checked_in,
      i.checked_in_at AS checked_in_at
    FROM messages m
    JOIN invitations i ON m.invitation_id = i.id
    WHERE m.id = ?
    LIMIT 1
  `, [id]);
  if (!rows.length) return res.status(404).json({ message: 'Pesan tidak ditemukan.' });
  res.json(rows[0]);
}));

// ✅ Create message
messageRouter.post('/', awrap(async (req, res) => {
  const { invitation_id, message } = req.body;
  if (!required(invitation_id) || !required(message)) {
    return res.status(400).json({ message: 'Semua field wajib diisi (invitation_id, message).' });
  }

  // ensure invitation exists
  const [inv] = await db.query('SELECT id FROM invitations WHERE id = ? LIMIT 1', [invitation_id]);
  if (!inv.length) return res.status(404).json({ message: 'Invitation tidak ditemukan.' });

  const [result] = await db.query('INSERT INTO messages (invitation_id, message) VALUES (?, ?)', [invitation_id, message]);
  res.status(201).json({ message: 'Pesan berhasil dikirim.', id: result.insertId });
}));

// ✅ Delete message
messageRouter.delete('/:id', awrap(async (req, res) => {
  const { id } = req.params;
  const [result] = await db.query('DELETE FROM messages WHERE id = ?', [id]);
  if (!result.affectedRows) return res.status(404).json({ message: 'Pesan tidak ditemukan.' });
  res.json({ message: 'Pesan dihapus.' });
}));

// Summary
router.get('/summary', awrap(async (req, res) => {
  const [rows] = await db.query(`
    SELECT
      COUNT(*) AS total_undangan,
      COALESCE(SUM(qty),0) AS total_tamu,
      SUM(CASE WHEN checked_in = 1 THEN 1 ELSE 0 END) AS checked_in_undangan,
      COALESCE(SUM(CASE WHEN checked_in = 1 THEN COALESCE(real_qty, qty) ELSE 0 END),0) AS checked_in_tamu
    FROM invitations
  `);

  const summary = rows[0];

  res.json({
    totalUndangan: Number(summary.total_undangan) || 0,
    totalTamu: Number(summary.total_tamu) || 0,
    checkedInUndangan: Number(summary.checked_in_undangan) || 0,
    checkedInTamu: Number(summary.checked_in_tamu) || 0
  });
}));
// -----------------------------------------------------------------------------
// EXPORTERS
// -----------------------------------------------------------------------------
export { router as invitationRouter, messageRouter };

// -----------------------------------------------------------------------------
// HOW TO USE IN YOUR APP (example):
// import { invitationRouter, messageRouter } from './routes/invitation-and-message-routes.js';
// app.use('/api/invitations', invitationRouter);
// app.use('/api/messages', messageRouter);
// -----------------------------------------------------------------------------

import express from 'express';
import db from '../config/db.js';
import slugify from 'slugify';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const messageRouter = express.Router();

const BASE_LINK = process.env.INVITATION_LINK_BASE ?? '';
const INVITE_PATH = process.env.INVITATION_INVITE_PATH ?? '/invite';        // Link yang dikirim ke tamu
const CONFIRM_PATH = process.env.INVITATION_CONFIRM_PATH ?? '/confirm';     // Link konfirmasi internal

// -----------------------------------------------------------------------------
// Utility: async wrapper untuk error handler
// -----------------------------------------------------------------------------
const awrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// -----------------------------------------------------------------------------
// Utility: build invitation link & QR
// -----------------------------------------------------------------------------
const buildInvitationLink = slug => `${BASE_LINK}${CONFIRM_PATH}/${slug}`; // internal confirm link
const buildInviteViewLink = slug => `${BASE_LINK}${INVITE_PATH}/${slug}`;  // untuk kirim WA
const buildQrUrl = link => `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(link)}&size=200x200`;

// -----------------------------------------------------------------------------
// Utility: generate unique slug
// -----------------------------------------------------------------------------
async function generateUniqueSlug() {
  let slug;
  let exists = true;

  while (exists) {
    slug = Math.floor(100000 + Math.random() * 900000).toString(); // angka 6 digit
    const [rows] = await db.query('SELECT id FROM invitations WHERE slug = ?', [slug]);
    exists = rows.length > 0;
  }

  return slug;
}

// -----------------------------------------------------------------------------
// Validation helpers
// -----------------------------------------------------------------------------
const required = v => v !== undefined && v !== null && v !== '';
const isEnum = (v, allowed) => allowed.includes(v);

// -----------------------------------------------------------------------------
// SQL snippet
// -----------------------------------------------------------------------------
const INVITATION_COLUMNS = `id, \`from\`, name, category, phone, qty, type, slug, qrcode, rsvp_status, checked_in, checked_in_at, created_at, real_qty, is_sent, is_copied`;
const SELECT_INVITATION_BASE = `SELECT ${INVITATION_COLUMNS} FROM invitations`;

const SELECT_WITH_CAPTION = `
  SELECT
    i.id, i.\`from\`, i.name, i.category, i.phone, i.qty, i.type, i.slug, i.qrcode,
    i.rsvp_status, i.checked_in, i.checked_in_at, i.created_at, i.real_qty,
    c.name AS category_name,
    (
      SELECT cap.caption_text
      FROM caption cap
      WHERE cap.category_id = i.category AND cap.is_active = 1
      ORDER BY cap.id DESC
      LIMIT 1
    ) AS caption_text
  FROM invitations i
  LEFT JOIN categories c ON i.category = c.id
`;

// ============================================================================
// INVITATION ROUTES
// ============================================================================

// ✅ SUMMARY
router.get('/summary', awrap(async (req, res) => {
  const [rows] = await db.query(`
    SELECT
      COUNT(*) AS total_undangan,
      COALESCE(SUM(qty),0) AS total_tamu,
      SUM(CASE WHEN checked_in = 1 THEN 1 ELSE 0 END) AS checked_in_undangan,
      COALESCE(SUM(CASE WHEN checked_in = 1 THEN COALESCE(real_qty, qty) ELSE 0 END),0) AS checked_in_tamu,
      SUM(CASE WHEN type = 'digital' THEN 1 ELSE 0 END) AS digital,
      SUM(CASE WHEN type = 'cetak' THEN 1 ELSE 0 END) AS cetak,
      SUM(CASE WHEN rsvp_status = 'Hadir' THEN 1 ELSE 0 END) AS hadir,
      SUM(CASE WHEN rsvp_status = 'Tidak Hadir' THEN 1 ELSE 0 END) AS tidak_hadir,
      SUM(CASE WHEN rsvp_status = 'Belum Konfirmasi' THEN 1 ELSE 0 END) AS belum_konfirmasi
    FROM invitations
  `);

  const s = rows[0] || {};
  const totalUndangan = Number(s.total_undangan || 0);
  const totalTamu = Number(s.total_tamu || 0);
  const checkedInUndangan = Number(s.checked_in_undangan || 0);
  const checkedInTamu = Number(s.checked_in_tamu || 0);

  res.json({
    totalUndangan,
    totalTamu,
    checkedInUndangan,
    checkedInTamu,
    belumCheckInUndangan: totalUndangan - checkedInUndangan,
    belumCheckInTamu: totalTamu - checkedInTamu,
    digital: Number(s.digital || 0),
    cetak: Number(s.cetak || 0),
    confirmed: {
      hadir: Number(s.hadir || 0),
      tidak_hadir: Number(s.tidak_hadir || 0),
      belum_konfirmasi: Number(s.belum_konfirmasi || 0),
    },
    total: totalUndangan,
    estimasi_tamu: totalTamu,
  });
}));

// ✅ SEARCH
router.get('/search', awrap(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);

  const like = `%${q}%`;
  const [rows] = await db.query(
    `SELECT
        slug,
        name,
        qty,
        COALESCE(real_qty, qty) AS qty_use,
        checked_in,
        checked_in_at
     FROM invitations
     WHERE name LIKE ? OR phone LIKE ? OR slug LIKE ? OR \`from\` LIKE ?
     ORDER BY checked_in = 1 DESC, name ASC
     LIMIT 50`,
    [like, like, like, like]
  );

  const results = rows.map(r => ({
    slug: r.slug,
    name: r.name,
    qty: Number(r.qty_use ?? r.qty ?? 0),
    checked_in: !!r.checked_in,
    checked_in_at: r.checked_in_at,
  }));
  res.json(results);
}));

// ✅ CREATE Invitation
router.post('/', awrap(async (req, res) => {
  const { from, name, category, phone, qty, type } = req.body;

  if (!required(name)) return res.status(400).json({ error: 'Field name wajib diisi.' });
  if (!required(type) || !isEnum(type, ['digital', 'cetak']))
    return res.status(400).json({ error: "Field type harus 'digital' atau 'cetak'." });

  const qtyVal = qty == null ? null : Number(qty);
  const catVal = category == null ? null : Number(category);
  const slug = await generateUniqueSlug();
  const link = buildInvitationLink(slug);
  const qrcode = buildQrUrl(slug); // QR hanya mengandung slug

  const sql = `INSERT INTO invitations (\`from\`, name, category, phone, qty, type, slug, qrcode)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const values = [from ?? null, name, catVal, phone ?? null, qtyVal, type, slug, qrcode];
  const [result] = await db.query(sql, values);

  res.status(201).json({
    message: 'Undangan berhasil dibuat.',
    id: result.insertId,
    slug,
    qrcode,
    confirm_link: link,
    invite_link: buildInviteViewLink(slug)
  });
}));

// ✅ PATCH Status kirim WA / copy link
router.patch('/:slug/status', awrap(async (req, res) => {
  const { slug } = req.params;
  const { is_sent, is_copied } = req.body;

  if (is_sent === undefined && is_copied === undefined) {
    return res.status(400).json({ error: 'Minimal satu dari is_sent atau is_copied harus disertakan.' });
  }

  const updates = [];
  const params = [];

  if (is_sent !== undefined) {
    updates.push('is_sent = ?');
    params.push(!!is_sent ? 1 : 0);
  }
  if (is_copied !== undefined) {
    updates.push('is_copied = ?');
    params.push(!!is_copied ? 1 : 0);
  }

  params.push(slug);

  const sql = `UPDATE invitations SET ${updates.join(', ')} WHERE slug = ?`;
  const [result] = await db.query(sql, params);

  if (result.affectedRows === 0) {
    // Cek apakah slug benar-benar tidak ada, atau hanya nilainya tidak berubah
    const [[existing]] = await db.query('SELECT id FROM invitations WHERE slug = ?', [slug]);
    if (!existing) return res.status(404).json({ error: 'Undangan tidak ditemukan.' });

    // Nilai sama → tetap dianggap berhasil
    return res.json({ message: 'Status tidak berubah (sudah sama).' });
  }

  const [[updated]] = await db.query(
    'SELECT is_sent, is_copied FROM invitations WHERE slug = ? LIMIT 1',
    [slug]
  );

  res.json({
    message: 'Status berhasil diperbarui.',
    ...updated,
  });
}));

// ✅ UPDATE Invitation
router.put('/:id', awrap(async (req, res) => {
  const { id } = req.params;
  const { from, name, category, phone, qty, type } = req.body;

  if (!required(name)) return res.status(400).json({ error: 'Field name wajib diisi.' });
  if (!required(type) || !isEnum(type, ['digital', 'cetak']))
    return res.status(400).json({ error: "Field type harus 'digital' atau 'cetak'." });

  const sql = `
    UPDATE invitations
    SET \`from\`=?, name=?, category=?, phone=?, qty=?, type=?
    WHERE id=?`;
  const values = [from ?? null, name, category ?? null, phone ?? null, qty ?? null, type, id];

  await db.query(sql, values);

  res.status(200).json({ message: 'Undangan berhasil diperbarui.' });
}));

// ✅ GET Invitation List
router.get('/', awrap(async (req, res) => {
  const { type, category, checked_in, rsvp_status, search } = req.query;
  const where = [];
  const params = [];

  if (required(type)) { where.push('i.type = ?'); params.push(type); }
  if (required(category)) { where.push('i.category = ?'); params.push(Number(category)); }
  if (required(checked_in)) { where.push('i.checked_in = ?'); params.push(Number(checked_in) ? 1 : 0); }
  if (required(rsvp_status)) { where.push('i.rsvp_status = ?'); params.push(rsvp_status); }
  if (required(search)) {
    where.push('(i.name LIKE ? OR i.phone LIKE ? OR i.slug LIKE ? OR i.\`from\` LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  const sql = `${SELECT_WITH_CAPTION} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.id DESC`;
  const [rows] = await db.query(sql, params);
  res.json(rows);
}));

// ✅ GET Invitation Detail by Slug
router.get('/:slug', awrap(async (req, res) => {
  const { slug } = req.params;
  const sql = `${SELECT_WITH_CAPTION} WHERE i.slug = ? LIMIT 1`;
  const [rows] = await db.query(sql, [slug]);
  if (!rows.length) return res.status(404).json({ error: 'Undangan tidak ditemukan.' });
  res.json(rows[0]);
}));

// ✅ PATCH Kehadiran Manual
router.patch('/:slug/kehadiran', awrap(async (req, res) => {
  const { slug } = req.params;
  let { rsvp_status, jumlah_real } = req.body;

  // Validasi status wajib diisi
  if (!required(rsvp_status)) {
    return res.status(400).json({ error: 'rsvp_status wajib diisi.' });
  }

  // Validasi status harus salah satu dari 3 opsi
  if (!isEnum(rsvp_status, ['Belum Konfirmasi', 'Hadir', 'Tidak Hadir'])) {
    return res.status(400).json({
      error: "rsvp_status harus salah satu: 'Belum Konfirmasi', 'Hadir', 'Tidak Hadir'."
    });
  }

  // Jika Tidak Hadir → jumlah_real otomatis 0
  if (rsvp_status === 'Tidak Hadir') {
    jumlah_real = 0;
  } else {
    // Konversi ke angka, atau null jika kosong
    jumlah_real = jumlah_real == null || jumlah_real === '' ? null : Number(jumlah_real);
  }

  // Update ke DB
  const [result] = await db.query(
    'UPDATE invitations SET rsvp_status = ?, real_qty = ? WHERE slug = ?',
    [rsvp_status, jumlah_real, slug]
  );

  if (!result.affectedRows) {
    return res.status(404).json({ error: 'Undangan tidak ditemukan.' });
  }

  // Ambil data yang sudah diupdate + QR jika ada
  const [[updated]] = await db.query(
    'SELECT rsvp_status, real_qty AS jumlah_real, qrcode FROM invitations WHERE slug = ?',
    [slug]
  );

  res.json({
    message: 'Kehadiran berhasil dikonfirmasi.',
    ...updated,
  });
}));

// ✅ PATCH Check-in via QR
router.patch('/checkin/:slug', awrap(async (req, res) => {
  const { slug } = req.params;
  const { checked_in_qty, device_note } = req.body ?? {};

  const [rows] = await db.query('SELECT * FROM invitations WHERE slug = ? LIMIT 1', [slug]);
  if (!rows.length) return res.status(404).json({ error: 'Undangan tidak ditemukan.' });
  const inv = rows[0];

  const qtyToUse = checked_in_qty != null ? Number(checked_in_qty) : (inv.real_qty != null ? inv.real_qty : inv.qty);

  const [cRows] = await db.query('SELECT id, scan_count FROM checkins WHERE invitation_id = ? LIMIT 1', [inv.id]);
  let scanCount;
  if (!cRows.length) {
    scanCount = 1;
    await db.query(`INSERT INTO checkins (invitation_id, checked_in_qty, scan_count, device_note) VALUES (?, ?, ?, ?)`,
      [inv.id, qtyToUse ?? 0, scanCount, device_note ?? null]);
  } else {
    scanCount = cRows[0].scan_count + 1;
    await db.query(`UPDATE checkins SET checked_in_qty = ?, scan_count = ?, device_note = ? WHERE id = ?`,
      [qtyToUse ?? 0, scanCount, device_note ?? null, cRows[0].id]);
  }

  if (!inv.checked_in) {
    await db.query(`UPDATE invitations SET checked_in = 1, checked_in_at = NOW(), real_qty = COALESCE(?, real_qty, qty) WHERE id = ?`,
      [qtyToUse, inv.id]);
  } else {
    await db.query(`UPDATE invitations SET checked_in_at = NOW() WHERE id = ?`, [inv.id]);
  }

  res.json({
    message: inv.checked_in ? 'Scan diterima (tamu sudah pernah check-in).' : 'Check-in berhasil.',
    name: inv.name,
    qty_recorded: qtyToUse,
    scan_count: scanCount
  });
}));

// ============================================================================
// MESSAGE ROUTES
// ============================================================================
messageRouter.get('/', awrap(async (req, res) => {
  const [rows] = await db.query(`
    SELECT m.id, m.message, m.created_at, m.invitation_id,
           i.name AS guest_name, i.rsvp_status, i.checked_in
    FROM messages m
    JOIN invitations i ON i.id = m.invitation_id
    ORDER BY m.created_at DESC
  `);
  res.json(rows);
}));

messageRouter.get('/invitation/:id', awrap(async (req, res) => {
  const { id } = req.params;
  const [rows] = await db.query('SELECT * FROM messages WHERE invitation_id = ? ORDER BY created_at ASC', [id]);
  res.json(rows);
}));

messageRouter.post('/', awrap(async (req, res) => {
  const { invitation_id, message } = req.body;
  if (!required(invitation_id) || !required(message)) return res.status(400).json({ error: 'invitation_id dan message wajib diisi.' });

  const [inv] = await db.query('SELECT id FROM invitations WHERE id = ?', [invitation_id]);
  if (!inv.length) return res.status(404).json({ error: 'Invitation tidak ditemukan.' });

  const [result] = await db.query('INSERT INTO messages (invitation_id, message) VALUES (?, ?)', [invitation_id, message]);
  res.status(201).json({ message: 'Pesan berhasil dikirim.', id: result.insertId });
}));

messageRouter.delete('/:id', awrap(async (req, res) => {
  const { id } = req.params;
  const [result] = await db.query('DELETE FROM messages WHERE id = ?', [id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Pesan tidak ditemukan.' });
  res.json({ message: 'Pesan dihapus.' });
}));

// ============================================================================
// EXPORT ROUTERS
// ============================================================================
export { router as invitationRouter, messageRouter };
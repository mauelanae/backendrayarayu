// messageController.js
// -----------------------------------------------------------------------------
// Controller functions untuk resource `messages` yang terhubung dengan tabel
// `invitations` (relasi many-to-one: banyak pesan untuk satu undangan).
//
// Fitur:
// - List all messages (dengan filter & pagination).
// - Ambil message by ID.
// - List messages by invitation_id.
// - Create message.
// - Delete message.
// - (Opsional) Update message (aktifkan jika dibutuhkan).
//
// Catatan Skema DB (pastikan sesuai DB Anda):
//   messages(id PK AI, invitation_id FK -> invitations.id, message TEXT, created_at TIMESTAMP)
//   invitations(id PK AI, name, rsvp_status, checked_in, checked_in_at, ...)
//
// Dependensi: mysql2/promise pool yg diexport sbg `db`.
// -----------------------------------------------------------------------------

import db from '../config/db.js';

// -----------------------------------------------------------------------------
// Utils
// -----------------------------------------------------------------------------
const required = v => v !== undefined && v !== null && v !== '';

function mapRow(row) {
  // Normalisasi nama field agar konsisten di FE
  return {
    id: row.id,
    invitation_id: row.invitation_id,
    message: row.message,
    created_at: row.created_at,
    guest_name: row.guest_name ?? null,
    rsvp_status: row.rsvp_status ?? row.attendance_status ?? null,
    attendance_status: row.rsvp_status ?? row.attendance_status ?? null, // alias lama
    checked_in: row.checked_in != null ? Number(row.checked_in) === 1 : null,
    checked_in_at: row.checked_in_at ?? null,
  };
}

// -----------------------------------------------------------------------------
// GET /api/messages
// Query params:
//   invitation_id   => filter pesan milik undangan tertentu
//   search           => LIKE filter isi pesan atau nama tamu
//   page, limit      => pagination (default: page=1, limit=25)
//   include_inv=0/1  => sertakan data undangan penuh? (0 default; 1 attach minimal info)
// -----------------------------------------------------------------------------
export const getAllMessages = async (req, res) => {
  try {
    const {
      invitation_id,
      search,
      page = 1,
      limit = 25,
      include_inv = '0',
    } = req.query;

    const where = [];
    const params = [];

    if (required(invitation_id)) {
      where.push('m.invitation_id = ?');
      params.push(Number(invitation_id));
    }

    if (required(search)) {
      where.push('(m.message LIKE ? OR i.name LIKE ? OR i.phone LIKE ? OR i.slug LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    // Count total
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
         FROM messages m
         JOIN invitations i ON m.invitation_id = i.id
        ${whereSql}`,
      params
    );
    const total = countRows[0]?.total ?? 0;

    // Pagination math
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Number(limit));
    const offset = (pageNum - 1) * limitNum;

    // Main query
    const [rows] = await db.query(
      `SELECT 
          m.id,
          m.invitation_id,
          m.message,
          m.created_at,
          i.name AS guest_name,
          i.rsvp_status,
          i.checked_in,
          i.checked_in_at
         FROM messages m
         JOIN invitations i ON m.invitation_id = i.id
         ${whereSql}
         ORDER BY m.created_at DESC
         LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const data = rows.map(mapRow);

    // Optionally include invitation snapshot map (minimal)
    let invitationsMap = undefined;
    if (include_inv === '1' && rows.length) {
      const ids = [...new Set(rows.map(r => r.invitation_id))];
      const [invRows] = await db.query(
        `SELECT id, \`from\`, name, phone, qty, type, slug, rsvp_status, checked_in, checked_in_at, real_qty, category
           FROM invitations
          WHERE id IN (${ids.map(()=>'?').join(',')})`,
        ids
      );
      invitationsMap = {};
      for (const inv of invRows) invitationsMap[inv.id] = inv;
    }

    res.json({
      total,
      page: pageNum,
      limit: limitNum,
      data,
      invitations: invitationsMap,
    });
  } catch (err) {
    console.error('❌ Error di getAllMessages:', err);
    res.status(500).json({ message: 'Gagal mengambil pesan', error: err.message });
  }
};

// -----------------------------------------------------------------------------
// GET /api/messages/:id
// -----------------------------------------------------------------------------
export const getMessageById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      `SELECT 
          m.id,
          m.invitation_id,
          m.message,
          m.created_at,
          i.name AS guest_name,
          i.rsvp_status,
          i.checked_in,
          i.checked_in_at
         FROM messages m
         JOIN invitations i ON m.invitation_id = i.id
        WHERE m.id = ?
        LIMIT 1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Pesan tidak ditemukan' });
    }

    res.json(mapRow(rows[0]));
  } catch (err) {
    console.error('❌ Error di getMessageById:', err);
    res.status(500).json({ message: 'Gagal mengambil pesan', error: err.message });
  }
};

// -----------------------------------------------------------------------------
// GET /api/invitations/:invitationId/messages  (helper khusus per undangan)
// Bisa di-mount di router undangan.
// -----------------------------------------------------------------------------
export const getMessagesByInvitationId = async (req, res) => {
  try {
    const invitationId = Number(req.params.invitationId ?? req.params.id);
    if (!invitationId) return res.status(400).json({ message: 'invitationId tidak valid' });

    // Pastikan undangan ada
    const [invRows] = await db.query('SELECT id, name FROM invitations WHERE id = ? LIMIT 1', [invitationId]);
    if (!invRows.length) return res.status(404).json({ message: 'Invitation tidak ditemukan' });

    const [rows] = await db.query(
      `SELECT id, invitation_id, message, created_at
         FROM messages
        WHERE invitation_id = ?
        ORDER BY created_at DESC`,
      [invitationId]
    );

    res.json({ invitation: invRows[0], data: rows });
  } catch (err) {
    console.error('❌ Error di getMessagesByInvitationId:', err);
    res.status(500).json({ message: 'Gagal mengambil pesan', error: err.message });
  }
};

// -----------------------------------------------------------------------------
// POST /api/messages  { invitation_id, message }
// -----------------------------------------------------------------------------
export const createMessage = async (req, res) => {
  const { invitation_id, message } = req.body;

  if (!required(invitation_id) || !required(message)) {
    return res.status(400).json({ message: 'Semua field wajib diisi (invitation_id, message).' });
  }

  try {
    // Pastikan undangan ada
    const [inv] = await db.query('SELECT id, name FROM invitations WHERE id = ? LIMIT 1', [invitation_id]);
    if (!inv.length) return res.status(404).json({ message: 'Invitation tidak ditemukan.' });

    const [result] = await db.query(
      'INSERT INTO messages (invitation_id, message) VALUES (?, ?)',
      [invitation_id, message]
    );

    res.status(201).json({
      message: 'Pesan berhasil dikirim.',
      id: result.insertId,
      invitation_id,
    });
  } catch (err) {
    console.error('❌ Error di createMessage:', err);
    res.status(500).json({ message: 'Gagal menyimpan pesan', error: err.message });
  }
};

// -----------------------------------------------------------------------------
// PATCH /api/messages/:id  { message }
// (Opsional; aktifkan bila perlu edit pesan)
// -----------------------------------------------------------------------------
export const updateMessage = async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;

  if (!required(message)) return res.status(400).json({ message: 'Field message wajib diisi.' });

  try {
    const [result] = await db.query('UPDATE messages SET message = ? WHERE id = ?', [message, id]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Pesan tidak ditemukan.' });
    res.json({ message: 'Pesan diperbarui.' });
  } catch (err) {
    console.error('❌ Error di updateMessage:', err);
    res.status(500).json({ message: 'Gagal mengupdate pesan', error: err.message });
  }
};

// -----------------------------------------------------------------------------
// DELETE /api/messages/:id
// -----------------------------------------------------------------------------
export const deleteMessage = async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await db.query('DELETE FROM messages WHERE id = ?', [id]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Pesan tidak ditemukan.' });
    res.json({ message: 'Pesan dihapus.' });
  } catch (err) {
    console.error('❌ Error di deleteMessage:', err);
    res.status(500).json({ message: 'Gagal menghapus pesan', error: err.message });
  }
};

// -----------------------------------------------------------------------------
// Router Helper (optional): generate express.Router() siap pakai
// Pakai jika ingin mounting cepat tanpa buat routes terpisah.
// -----------------------------------------------------------------------------
import express from 'express';
export function buildMessageRouter() {
  const router = express.Router();
  router.get('/', getAllMessages);
  router.get('/:id', getMessageById);
  router.post('/', createMessage);
  router.patch('/:id', updateMessage); // opsional
  router.delete('/:id', deleteMessage);
  return router;
}

// Ambil semua pesan berdasarkan ID invitation
export const getMessagesByInvitation = async (req, res) => {
  const { invitation_id } = req.params;

  try {
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
      WHERE m.invitation_id = ?
      ORDER BY m.created_at ASC
    `, [invitation_id]);

    res.json(rows);
  } catch (err) {
    console.error('❌ Error di getMessagesByInvitation:', err);
    res.status(500).json({ message: 'Gagal mengambil pesan berdasarkan invitation', error: err.message });
  }
};

// END messageController.js

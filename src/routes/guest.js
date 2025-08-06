import express from 'express';
import db from '../config/db.js';

const router = express.Router();

/* ========================
   ✅ GET All Invitations
=========================== */
router.get('/', async (req, res) => {
  try {
    const [data] = await db.query(`
      SELECT
        i.id, i.\`from\`, i.name, i.category, i.phone, i.qty, i.type, i.slug, i.qrcode,
        i.rsvp_status, i.checked_in, i.checked_in_at, i.created_at, i.real_qty,
        i.status_pengiriman,
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
    `);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json(data);
  } catch (err) {
    console.error('❌ Error fetching guest data:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/* ========================
   ➕ CREATE Invitation
=========================== */
router.post('/', async (req, res) => {
  try {
    const { from, name, category, phone, qty, type } = req.body;

    if (!name || !category) {
      return res.status(400).json({ message: "Nama dan kategori wajib diisi." });
    }

    await db.query(`
      INSERT INTO invitations (name, \`from\`, category, phone, qty, type)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [name, from, category, phone, qty, type]);

    res.status(201).json({ message: "Tamu berhasil ditambahkan." });
  } catch (err) {
    console.error("❌ Error inserting guest:", err);
    res.status(500).json({ message: "Gagal menambahkan tamu." });
  }
});

/* ================================
   🔄 UPDATE Status Pengiriman
=================================== */
router.patch('/:slug/status', async (req, res) => {
  const { slug } = req.params;
  const { status_pengiriman } = req.body;

  const allowedStatus = ['terkirim', 'belum_terkirim'];

  if (!allowedStatus.includes(status_pengiriman)) {
    return res.status(400).json({
      error: 'Status tidak valid. Gunakan "terkirim" atau "belum_terkirim".'
    });
  }

  try {
    const [result] = await db.query(
      'UPDATE invitations SET status_pengiriman = ? WHERE slug = ?',
      [status_pengiriman, slug]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Undangan tidak ditemukan.' });
    }

    res.json({ message: 'Status pengiriman berhasil diperbarui.', status_pengiriman });
  } catch (err) {
    console.error("❌ Error updating status_pengiriman:", err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

/* ========================
   ✏️ UPDATE Invitation
=========================== */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { from, name, category, phone, qty, type } = req.body;

  try {
    await db.query(`
      UPDATE invitations 
      SET name = ?, \`from\` = ?, category = ?, phone = ?, qty = ?, type = ?
      WHERE id = ?
    `, [name, from, category, phone, qty, type, id]);

    res.json({ message: "Tamu berhasil diupdate." });
  } catch (err) {
    console.error("❌ Error updating guest:", err);
    res.status(500).json({ message: "Gagal mengubah tamu." });
  }
});

export default router;
import express from 'express';
import db from '../config/db.js';

const router = express.Router();

// Ambil semua caption
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM caption');
    res.json(rows);
  } catch (err) {
    console.error('Error get captions:', err);
    res.status(500).json({ error: 'Gagal mengambil data caption' });
  }
});

// Ambil caption berdasarkan category_id
router.get('/:category_id', async (req, res) => {
  try {
    const { category_id } = req.params;
    const [rows] = await db.query('SELECT * FROM caption WHERE category_id = ? AND is_active = 1 LIMIT 1', [category_id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Caption tidak ditemukan' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error get caption by category:', err);
    res.status(500).json({ error: 'Gagal mengambil caption' });
  }
});

// Tambah caption
router.post('/', async (req, res) => {
  try {
    const { category_id, caption_text } = req.body;
    await db.query('INSERT INTO caption (category_id, caption_text) VALUES (?, ?)', [category_id, caption_text]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error create caption:', err);
    res.status(500).json({ error: 'Gagal membuat caption' });
  }
});

export default router;
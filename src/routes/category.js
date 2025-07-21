// routes/category.js
import express from 'express';
import db from '../config/db.js';

const router = express.Router();

// ✅ Tambah kategori baru
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;

    const [result] = await db.query('INSERT INTO categories (name) VALUES (?)', [name]);

    res.status(201).json({ message: 'Kategori ditambahkan', id: result.insertId });
  } catch (err) {
    console.error('❌ Gagal menambah kategori:', err);
    res.status(500).json({ error: 'Gagal menambah kategori' });
  }
});

// ✅ Ambil semua kategori + total tamu
router.get('/', async (req, res) => {
  try {
    const sql = `
      SELECT c.id, c.name, COUNT(i.id) AS total_guests
      FROM categories c
      LEFT JOIN invitations i ON i.category = c.id
      GROUP BY c.id
      ORDER BY c.id DESC
    `;

    const [results] = await db.query(sql);
    res.json(results);
  } catch (err) {
    console.error('❌ Gagal mengambil kategori:', err);
    res.status(500).json({ error: 'Gagal mengambil kategori' });
  }
});

// ✅ Edit kategori berdasarkan ID
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  try {
    await db.query('UPDATE categories SET name = ? WHERE id = ?', [name, id]);
    res.json({ message: 'Kategori berhasil diperbarui' });
  } catch (err) {
    console.error('❌ Gagal memperbarui kategori:', err);
    res.status(500).json({ error: 'Gagal memperbarui kategori' });
  }
});

// ✅ Hapus kategori berdasarkan ID
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await db.query('DELETE FROM categories WHERE id = ?', [id]);
    res.json({ message: 'Kategori berhasil dihapus' });
  } catch (err) {
    console.error('❌ Gagal menghapus kategori:', err);
    res.status(500).json({ error: 'Gagal menghapus kategori' });
  }
});

export default router;
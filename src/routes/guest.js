import express from 'express';
import db from '../config/db.js';

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const [data] = await db.query(`
            SELECT 
                i.id,
                i.name AS nama,
                i.phone,
                i.qty AS jumlah_diundang,
                i.real_qty AS jumlah_hadir,
                i.rsvp_status AS rsvp,
                i.slug,
                i.qrcode AS linkUndangan,
                i.created_at,
                c.name AS kategori,
                i.type,
                i.checked_in AS checked_in,
                i.checked_in_at AS checked_in_at
            FROM invitations i
            LEFT JOIN categories c ON i.category = c.id
        `);

        res.json(data);
    } catch (err) {
        console.error('❌ Error fetching guest data:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
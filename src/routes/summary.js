import express from "express";
import db from "../config/db.js";

const router = express.Router();

/**
 * GET /api/invitations/summary
 * (boleh juga dimount di /api/summary untuk kompatibilitas)
 */
router.get("/", async (_req, res) => {
  try {
    // Total undangan + total estimasi tamu
    const [[totals]] = await db.query(`
      SELECT 
        COUNT(*)        AS total_undangan,
        COALESCE(SUM(qty), 0) AS total_tamu
      FROM invitations
    `);

    // Breakdown type
    const [[digital]] = await db.query(`
      SELECT COUNT(*) AS digital
      FROM invitations
      WHERE type = 'digital'
    `);

    const [[cetak]] = await db.query(`
      SELECT COUNT(*) AS cetak
      FROM invitations
      WHERE type = 'cetak'
    `);

    // RSVP breakdown (enum case-sensitive)
    const [[hadir]] = await db.query(`
      SELECT COUNT(*) AS hadir
      FROM invitations
      WHERE rsvp_status = 'Hadir'
    `);

    const [[tidakHadir]] = await db.query(`
      SELECT COUNT(*) AS tidak_hadir
      FROM invitations
      WHERE rsvp_status = 'Tidak Hadir'
    `);

    const [[belum]] = await db.query(`
      SELECT COUNT(*) AS belum_konfirmasi
      FROM invitations
      WHERE rsvp_status = 'Belum Konfirmasi'
    `);

    // Checked-in stats
    const [[checkins]] = await db.query(`
      SELECT
        SUM(CASE WHEN checked_in = 1 THEN 1 ELSE 0 END) AS checked_in_undangan,
        COALESCE(SUM(CASE WHEN checked_in = 1 THEN COALESCE(real_qty, qty) ELSE 0 END), 0) AS checked_in_tamu
      FROM invitations
    `);

    // Normalisasi angka
    const totalUndangan       = Number(totals.total_undangan)    || 0;
    const totalTamu           = Number(totals.total_tamu)        || 0;
    const totalDigital        = Number(digital.digital)          || 0;
    const totalCetak          = Number(cetak.cetak)              || 0;
    const rsvpHadir           = Number(hadir.hadir)              || 0;
    const rsvpTidakHadir      = Number(tidakHadir.tidak_hadir)   || 0;
    const rsvpBelumKonfirmasi = Number(belum.belum_konfirmasi)   || 0;
    const checkedInUndangan   = Number(checkins.checked_in_undangan) || 0;
    const checkedInTamu       = Number(checkins.checked_in_tamu) || 0;

    // Derived (berguna untuk ScanPage / dashboard)
    const belumCheckInUndangan = totalUndangan - checkedInUndangan;
    const belumCheckInTamu     = totalTamu - checkedInTamu;

    // Payload gabungan
    const payload = {
      // --- Baru (digunakan ScanPage, Header) ---
      totalUndangan,
      totalTamu,
      checkedInUndangan,
      checkedInTamu,
      belumCheckInUndangan,
      belumCheckInTamu,

      // --- Breakdown untuk UI ---
      digital: totalDigital,
      cetak: totalCetak,
      confirmed: {
        hadir: rsvpHadir,
        tidak_hadir: rsvpTidakHadir,
        belum_konfirmasi: rsvpBelumKonfirmasi,
      },

      // --- Legacy compatibility (komponen lama) ---
      total: totalUndangan,
      estimasi_tamu: totalTamu,
    };

    res.json(payload);
  } catch (err) {
    console.error("❌ Gagal mengambil summary:", err);
    res.status(500).json({ error: "Gagal mengambil data summary" });
  }
});

export default router;
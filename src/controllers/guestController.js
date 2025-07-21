// controllers/guestController.js
const Invitation = require("../models/invitation"); // pastikan path-nya benar

exports.getFilteredGuests = async (req, res) => {
    try {
        const { status, category, search } = req.query;
        const filter = {};

        if (status && status !== "all") {
            filter.rsvp = new RegExp(status, "i");
        }

        if (category && category !== "all") {
            filter.category = new RegExp(category, "i");
        }

        if (search && search.trim() !== "") {
            filter.name = { $regex: search, $options: "i" };
        }

        const guests = await Invitation.find(filter).sort({ createdAt: -1 });
        res.status(200).json(guests);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Gagal mengambil data tamu." });
    }
};
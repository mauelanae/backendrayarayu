import express from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/client/data', verifyToken('client'), (req, res) => {
  res.json({ message: 'Data khusus client', user: req.user });
});

router.get('/user/data', verifyToken('user'), (req, res) => {
  res.json({ message: 'Data khusus user', user: req.user });
});

export default router;
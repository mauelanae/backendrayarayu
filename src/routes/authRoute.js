import express from 'express';
import { login, logout, getMe } from '../controllers/authController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// Login & Logout
router.post('/login', login);
router.post('/logout', logout);

// GetMe berdasarkan role
router.get('/client/me', verifyToken('client'), getMe);
router.get('/user/me', verifyToken('user'), getMe);

export default router;
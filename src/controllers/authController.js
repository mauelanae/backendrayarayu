import db from '../config/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username dan password wajib diisi' });
  }

  try {
    const [users] = await db.query('SELECT * FROM users WHERE username = ?', [username]);

    if (users.length === 0) {
      return res.status(401).json({ message: 'Username tidak ditemukan' });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: 'Password salah' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Buat cookie sesuai role
    const cookieName = user.role === 'client' ? 'token_client' : 'token_user';

    res.cookie(cookieName, token, {
      httpOnly: true,
      path: '/', // Bisa diakses semua route
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'Lax',
      secure: false // Ubah ke true jika pakai HTTPS
    });

    return res.json({
      message: 'Login berhasil',
      role: user.role,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (err) {
    console.error('❌ Login error:', err);
    return res.status(500).json({ message: 'Terjadi kesalahan di server' });
  }
};

export const logout = (req, res) => {
  res.clearCookie('token_client', { path: '/' });
  res.clearCookie('token_user', { path: '/' });
  return res.json({ message: 'Logout berhasil' });
};

export const getMe = async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, username, role FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }

    return res.json(users[0]);
  } catch (error) {
    return res.status(500).json({ message: 'Terjadi kesalahan di server' });
  }
};
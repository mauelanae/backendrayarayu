import jwt from 'jsonwebtoken';

// Middleware untuk role spesifik
export const verifyToken = (role) => {
  return (req, res, next) => {
    const cookieName = role === 'client' ? 'token_client' : 'token_user';
    const token = req.cookies[cookieName];

    if (!token) {
      return res.status(401).json({ message: 'Tidak ada token' });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.role !== role) {
        return res.status(403).json({ message: 'Akses ditolak' });
      }
      req.user = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ message: 'Token tidak valid' });
    }
  };
};
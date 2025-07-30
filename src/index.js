import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';

// Import Routes
import authRoutes from './routes/authRoute.js';
import summaryRouter from './routes/summary.js';
import { invitationRouter, messageRouter } from './routes/invitation-and-message-routes.js';
import categoryRoutes from './routes/category.js';
import captionRoutes from './routes/caption.js';
import Guest from './routes/guest.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8081;

// ✅ Middleware
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug logging
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  next();
});

// ✅ Routes
app.use('/api', authRoutes);

// ✅ Summary Routes (utama & alias lama)
app.use('/api/summary', summaryRouter); // route utama
app.use('/api/invitations/summary', summaryRouter); // alias (untuk kompatibilitas lama)

// ✅ Invitations & Messages
app.use('/api/invitations', invitationRouter);
app.use('/api/messages', messageRouter);

// ✅ Categories & Guest
app.use('/api/categories', categoryRoutes);
app.use('/api/guest', Guest);

// ✅ Captions
app.use('/api/captions', captionRoutes);

// ✅ Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running at http://0.0.0.0:${PORT}`);
});
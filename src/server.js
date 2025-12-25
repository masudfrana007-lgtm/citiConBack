import "./env.js";

import express from "express";
import cors from "cors";
import session from "express-session";

import authRoutes from "./routes/auth.js";
import driveRoutes from "./routes/drive.js";
import postRoutes from "./routes/post.js";
import facebookRoutes from "./routes/facebook.js";
import youtubeRoutes from "./routes/youtube.js";
import instagramRoutes from "./routes/instagram.js";
import linkedinRoutes from "./routes/linkedin.js";

const app = express();

app.use(cors({
  origin: [
    "http://localhost:5173",
    "http://ucext.com",
    "https://ucext.com",
    "http://www.ucext.com",
    "https://www.ucext.com"
  ],
  credentials: true,
}));

app.use(express.json());

// ENABLE SESSION — IMPORTANT
app.set("trust proxy", 1); // 🔑 REQUIRED behind Nginx

app.use(
  session({
    name: "citizenconnect.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      secure: true,          // 🔑 HTTPS only
      httpOnly: true,
      sameSite: "none",      // 🔑 REQUIRED for OAuth popups
//      domain: ".ucext.com",
//	sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000
    },
  })
);

app.use((req, res, next) => {
  if (req.path.startsWith("/auth")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

// Routes
app.use("/auth", authRoutes);
app.use("/drive", driveRoutes);
app.use("/post", postRoutes);
app.use("/auth/facebook", facebookRoutes);
app.use("/auth/youtube", youtubeRoutes);
app.use("/instagram", instagramRoutes);
app.use("/auth/linkedin", linkedinRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

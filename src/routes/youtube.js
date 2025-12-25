// src/routes/youtube.js
import express from "express";
import multer from "multer";
import {
  youtubeLogin,
  youtubeCallback,
  youtubeStatus,
  getYoutubeChannels,
  youtubeLogout,
  youtubeUploadVideo,
} from "../controllers/youtubeController.js";

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

router.get("/login", youtubeLogin);
router.get("/callback", youtubeCallback);
router.get("/status", youtubeStatus);
router.get("/channels", getYoutubeChannels);
router.post("/logout", youtubeLogout);

// video upload: form-data: file, title, description, channelId
router.post("/upload", upload.single("file"), youtubeUploadVideo);

export default router;

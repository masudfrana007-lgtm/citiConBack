// routes/instagram.js
import express from "express";
import {
  postInstagramMedia,
  instagramStatus,
  getInstagramAccounts,
  instagramLogout
} from "../controllers/instagramController.js";
import multer from "multer";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/status", instagramStatus);
router.get("/accounts", getInstagramAccounts);
router.post("/logout", instagramLogout);
router.post("/media", upload.single("file"), postInstagramMedia); // Remove upload.single("file")

export default router;
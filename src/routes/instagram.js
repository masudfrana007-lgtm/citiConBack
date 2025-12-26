// routes/instagram.js
import express from "express";
import {
  instagramStatus,
  getInstagramAccounts,
  instagramLogout
} from "../controllers/instagramController.js";

const router = express.Router();

router.get("/status", instagramStatus);
router.get("/accounts", getInstagramAccounts);
router.post("/logout", instagramLogout);

export default router;
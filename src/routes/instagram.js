import express from "express";
import {
  syncInstagramAccounts,
  postToInstagram
} from "../controllers/instagramController.js";

const router = express.Router();

router.post("/sync", syncInstagramAccounts);
router.post("/post", postToInstagram);

export default router;

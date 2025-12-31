import express from "express";
import multer from "multer";
import {
  handlePost,
  createPostRecord,
  updatePlatformStatus,
} from "../controllers/postController.js";

const router = express.Router();

// Temporary upload storage
const upload = multer({ dest: "tmp/" });

router.post("/", upload.single("file"), handlePost);
router.post("/save", createPostRecord);           // Called once at start
router.post("/platform/update", updatePlatformStatus); // Called after each platform

export default router;

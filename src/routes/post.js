import express from "express";
import multer from "multer";
import { handlePost } from "../controllers/postController.js";

const router = express.Router();

// Temporary upload storage
const upload = multer({ dest: "tmp/" });

router.post("/", upload.single("file"), handlePost);

export default router;

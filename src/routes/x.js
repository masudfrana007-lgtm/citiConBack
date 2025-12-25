import express from "express";
import {
  xConnect,
  xCallback,
  xStatus,
  postToX,
  xLogout
} from "../controllers/xController.js";

const router = express.Router();

router.get("/connect", xConnect);
router.get("/callback", xCallback);

router.get("/status", xStatus);
router.post("/post", postToX);
router.post("/logout", xLogout);

export default router;

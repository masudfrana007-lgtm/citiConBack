import express from "express";
import {
  xInit,
  xConnect,
  xCallback,
  xStatus,
  postToX,
  xLogout
} from "../controllers/xController.js";

const router = express.Router();

router.get("/init", xInit);
router.get("/connect", xConnect);
router.get("/callback", xCallback);

router.get("/status", xStatus);
router.post("/post", postToX);
router.post("/logout", xLogout);

export default router;

import express from "express";
import {
  linkedinConnect,
  linkedinCallback,
  linkedinStatus,
  postToLinkedin,
  linkedinLogout
} from "../controllers/linkedinController.js";

const router = express.Router();

router.get("/connect", linkedinConnect);
router.get("/callback", linkedinCallback);
router.get("/status", linkedinStatus);
router.post("/post", postToLinkedin);
router.post("/logout", linkedinLogout);

export default router;

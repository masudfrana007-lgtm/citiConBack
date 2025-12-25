import express from "express";
import multer from "multer";
import {
  facebookLogin,
  facebookConnectPages,
  facebookCallback,
  facebookStatus,
  getFacebookPages,
  postToPage,
  facebookPostMedia,
  facebookLogout
} from "../controllers/facebookController.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/login", facebookLogin);            // optional
router.get("/connect", facebookConnectPages);  // ✅ IMPORTANT
router.get("/callback", facebookCallback);

router.get("/status", facebookStatus);
router.get("/pages", getFacebookPages);

router.post("/post", postToPage);
router.post("/media", upload.single("file"), facebookPostMedia);
router.post("/logout", facebookLogout);

export default router;

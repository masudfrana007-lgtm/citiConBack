// controllers/instagramController.js
import db from "../config/db.js";
import fetch from "node-fetch";
import FormData from "form-data"; // at top if not already
import path from "path";
import fs from "fs";

// Check if user has any Instagram accounts
export const instagramStatus = async (req, res) => {
  if (!req.session.user_id) {
    return res.json({ connected: false });
  }
  try {
    const result = await db.query(
      `SELECT 1 
       FROM social_sub_accounts ssa
       JOIN social_accounts sa ON ssa.account_id = sa.id
       WHERE sa.user_id = $1 AND ssa.type = 'instagram_account'
       LIMIT 1`,
      [req.session.user_id]
    );
    res.json({ connected: result.rowCount > 0 });
  } catch (err) {
    console.error("Instagram status error:", err);
    res.json({ connected: false });
  }
};

// List all connected Instagram accounts
export const getInstagramAccounts = async (req, res) => {
  if (!req.session.user_id) {
    return res.json([]);
  }
  try {
    const result = await db.query(
      `SELECT 
         ssa.sub_id AS ig_id,
         ssa.name AS username,
         ssa.image_url AS profile_picture
       FROM social_sub_accounts ssa
       JOIN social_accounts sa ON ssa.account_id = sa.id
       WHERE sa.user_id = $1 AND ssa.type = 'instagram_account'
       ORDER BY ssa.name`,
      [req.session.user_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Get IG accounts error:", err);
    res.json([]);
  }
};


// ===== BACKEND FIX (instagramController.js) =====

export const postInstagramMedia = async (req, res) => {
  const { caption = "", igId } = req.body;
  const file = req.file;

  const steps = {
    token: null,
    file: null,
    container: null,
    processing: [],
    publish: null,
    cleanup: null
  };

  let uploadedFilePath = null;

  try {
    // STEP 1 — TOKEN
    if (!igId) {
      steps.token = { success: false, error: "No Instagram account selected" };
      return res.status(400).json({ steps });
    }

    const acc = await db.query(
      `SELECT token FROM social_sub_accounts WHERE sub_id = $1 AND type = 'instagram_account'`,
      [igId]
    );

    if (!acc.rows.length) {
      steps.token = { success: false, error: "Instagram account not found" };
      throw new Error("Instagram account not found");
    }

    const token = acc.rows[0].token;
    steps.token = { success: true, token };

    // STEP 2 — FILE SAVE
    if (!file) {
      steps.file = { success: false, error: "Media file required" };
      throw new Error("Media file required");
    }

    const uploadDir = path.join(process.cwd(), "public/uploads");
    fs.mkdirSync(uploadDir, { recursive: true });

    const filename = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    uploadedFilePath = path.join(uploadDir, filename);
    fs.writeFileSync(uploadedFilePath, file.buffer);

    const publicMediaUrl = `https://ucext.com/uploads/${filename}`;
    const isVideo = file.mimetype.startsWith("video/");

    steps.file = {
      success: true,
      filename,
      url: publicMediaUrl,
      type: file.mimetype
    };

    // STEP 3 — CREATE CONTAINER
    const params = new URLSearchParams({
      access_token: token,
      caption
    });

    // ✅ FIX: Use correct parameter based on media type
    if (isVideo) {
      params.append("media_type", "REELS");
      params.append("video_url", publicMediaUrl);
    } else {
      params.append("media_type", "IMAGE");
      params.append("image_url", publicMediaUrl);
    }

    const createRes = await fetch(
      `https://graph.facebook.com/v19.0/${igId}/media`,
      { method: "POST", body: params }
    );

    const createData = await createRes.json();

    if (!createData.id) {
      steps.container = { success: false, response: createData };
      throw new Error(createData.error?.message || "Container creation failed");
    }

    const creationId = createData.id;
    steps.container = { success: true, creationId };

    // STEP 4 — PROCESSING
    let status = "IN_PROGRESS";
    const start = Date.now();

    while (status !== "FINISHED") {
      await new Promise(r => setTimeout(r, 3000)); // Increased to 3s for videos

      const sRes = await fetch(
        `https://graph.facebook.com/v19.0/${creationId}?fields=status_code,status,error_message&access_token=${token}`
      );

      const sData = await sRes.json();
      status = sData.status_code;

      steps.processing.push({
        time: new Date().toISOString(),
        status: sData.status_code,
        error: sData.error_message || null
      });

      if (status === "ERROR") {
        throw new Error(sData.error_message || "Instagram processing failed");
      }

      // ✅ Increased timeout for videos (120s instead of 60s)
      if (Date.now() - start > 120000) {
        throw new Error("Instagram processing timeout");
      }
    }

    // STEP 5 — PUBLISH
    const publishRes = await fetch(
      `https://graph.facebook.com/v19.0/${igId}/media_publish`,
      {
        method: "POST",
        body: new URLSearchParams({
          creation_id: creationId,
          access_token: token
        })
      }
    );

    const publishData = await publishRes.json();

    if (publishData.error) {
      steps.publish = { success: false, response: publishData };
      throw new Error(publishData.error.message);
    }

    steps.publish = {
      success: true,
      mediaId: publishData.id
    };

    // STEP 6 — CLEANUP (Keep file for 5 minutes in case of retry)
    setTimeout(() => {
      if (fs.existsSync(uploadedFilePath)) {
        fs.unlinkSync(uploadedFilePath);
      }
    }, 300000); // 5 minutes

    steps.cleanup = { success: true, note: "Scheduled for cleanup" };

    res.json({
      success: true,
      steps
    });

  } catch (err) {
    // Cleanup on error
    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      fs.unlinkSync(uploadedFilePath);
      steps.cleanup = { success: true, note: "Deleted after failure" };
    }

    res.status(500).json({
      success: false,
      error: err.message,
      steps
    });
  }
};



// Optional: logout clears only Instagram sub-accounts
export const instagramLogout = async (req, res) => {
  if (!req.session.user_id) {
    return res.json({ success: false });
  }
  try {
    await db.query(
      `DELETE FROM social_sub_accounts
       WHERE account_id IN (
         SELECT id FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'
       ) AND type = 'instagram_account'`,
      [req.session.user_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
};
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


export const postInstagramMedia = async (req, res) => {
  const { caption = "", igId } = req.body;
  const file = req.file; // from multer

  if (!igId) return res.status(400).json({ error: "No Instagram account selected" });
  if (!file) return res.status(400).json({ error: "Media file required" });

  let uploadedFilePath = null;
  let publicMediaUrl = null;

  try {
    // 1. Load Instagram token
    const acc = await db.query(
      `SELECT token FROM social_sub_accounts WHERE sub_id = $1 AND type = 'instagram_account'`,
      [igId]
    );
    if (!acc.rows.length) {
      return res.status(400).json({ error: "Instagram account not found" });
    }
    const token = acc.rows[0].token;

    // 2. Save file to server public folder
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filename = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    uploadedFilePath = path.join(uploadDir, filename);
    fs.writeFileSync(uploadedFilePath, file.buffer);

    publicMediaUrl = `https://ucext.com/uploads/${filename}`;
    console.log("File uploaded to server:", publicMediaUrl);

    const isVideo = file.mimetype.startsWith("video/");

    // 3. Create Instagram container
    const createParams = new URLSearchParams({
      access_token: token,
      caption
    });

    if (isVideo) {
      createParams.append("video_url", publicMediaUrl);
      createParams.append("media_type", "REELS");
    } else {
      createParams.append("image_url", publicMediaUrl);
    }

    const createRes = await fetch(
      `https://graph.facebook.com/v19.0/${igId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: createParams.toString()
      }
    );
    const createData = await createRes.json();

    if (!createData.id) {
      throw new Error(createData.error?.message || "Container creation failed");
    }

    const creationId = createData.id;
    console.log("Instagram container created:", creationId);

    // 4. Poll until processing finished
    let status = "IN_PROGRESS";
    const startTime = Date.now();
    while (status !== "FINISHED") {
      await new Promise(r => setTimeout(r, 2000));

      const statusRes = await fetch(
        `https://graph.facebook.com/v19.0/${creationId}?fields=status_code&access_token=${token}`
      );
      const statusData = await statusRes.json();

      if (statusData.error) {
        throw new Error(statusData.error.message);
      }
      status = statusData.status_code;

      if (status === "ERROR") {
        throw new Error("Instagram media processing failed");
      }

      if (Date.now() - startTime > 60000) {
        throw new Error("Instagram processing timeout");
      }
    }

    // 5. Publish
    const publishRes = await fetch(
      `https://graph.facebook.com/v19.0/${igId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          creation_id: creationId,
          access_token: token
        }).toString()
      }
    );
    const publishData = await publishRes.json();

    if (publishData.error) {
      throw new Error(publishData.error.message);
    }

    console.log("Instagram post published:", publishData.id);

    // 6. Delete file from server
    if (fs.existsSync(uploadedFilePath)) {
      fs.unlinkSync(uploadedFilePath);
      console.log("Temporary file deleted:", filename);
    }

    res.json(publishData);
  } catch (err) {
    console.error("Instagram post error:", err);

    // Clean up file on error
    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      fs.unlinkSync(uploadedFilePath);
      console.log("Temporary file deleted after error:", uploadedFilePath);
    }

    res.status(500).json({ error: "Server error", message: err.message });
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
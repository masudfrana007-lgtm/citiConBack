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
  const file = req.file;

  if (!igId) return res.status(400).json({ error: "No Instagram account selected" });
  if (!file) return res.status(400).json({ error: "Media file required" });

  let uploadedFilePath = null;

  try {
    // 1. Get token
    const acc = await db.query(
      `SELECT token FROM social_sub_accounts WHERE sub_id = $1 AND type = 'instagram_account'`,
      [igId]
    );
    if (!acc.rows.length) throw new Error("Instagram account not found");

    const token = acc.rows[0].token;

    // 2. Save file
    const uploadDir = path.join(process.cwd(), "public/uploads");
    fs.mkdirSync(uploadDir, { recursive: true });

    const filename = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    uploadedFilePath = path.join(uploadDir, filename);
    fs.writeFileSync(uploadedFilePath, file.buffer);

    const publicMediaUrl = `https://ucext.com/uploads/${filename}`;
    const isVideo = file.mimetype.startsWith("video/");

    // 3. Create container
    const params = new URLSearchParams({
      access_token: token,
      caption
    });

    if (isVideo) {
      params.append("video_url", publicMediaUrl);
      params.append("media_type", "REELS");
    } else {
      params.append("image_url", publicMediaUrl);
    }

    const createRes = await fetch(
      `https://graph.facebook.com/v19.0/${igId}/media`,
      { method: "POST", body: params }
    );

    const createData = await createRes.json();
    if (!createData.id) throw new Error(createData.error?.message);

    const creationId = createData.id;

    // 4. Poll status
    let status = "IN_PROGRESS";
    const start = Date.now();

    while (status !== "FINISHED") {
      await new Promise(r => setTimeout(r, 2000));

      const sRes = await fetch(
        `https://graph.facebook.com/v19.0/${creationId}?fields=status_code&access_token=${token}`
      );
      const sData = await sRes.json();

      status = sData.status_code;
      if (status === "ERROR") throw new Error("Instagram processing failed");
      if (Date.now() - start > 60000) throw new Error("Instagram timeout");
    }

    // 5. Publish
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
    if (publishData.error) throw new Error(publishData.error.message);

    // 6. Cleanup
    fs.unlinkSync(uploadedFilePath);

    res.json(publishData);

  } catch (err) {
    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      fs.unlinkSync(uploadedFilePath);
    }
    res.status(500).json({ error: "Instagram post failed", message: err.message });
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
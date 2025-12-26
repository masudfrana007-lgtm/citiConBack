// controllers/instagramController.js
import db from "../config/db.js";
import fetch from "node-fetch";
import FormData from "form-data"; // at top if not already

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
  const { caption, igId } = req.body;
  const file = req.file;

  if (!igId) return res.status(400).json({ error: "No Instagram account selected" });

  try {
    const acc = await db.query(
      `SELECT token FROM social_sub_accounts WHERE sub_id = $1 AND type = 'instagram_account'`,
      [igId]
    );
    if (!acc.rows.length) return res.status(400).json({ error: "Instagram account not found" });

    const token = acc.rows[0].token;

    // Step 1: Create media container
    const containerUrl = `https://graph.facebook.com/v19.0/${igId}/media`;
    const form = new FormData();
    form.append("access_token", token);
    form.append("caption", caption || "");

    if (file) {
        const mediaType = file.mimetype.startsWith("video/") ? "REELS" : "IMAGE";
        form.append("media_type", mediaType);
        form.append("source", file.buffer, { 
          filename: file.originalname,
          contentType: file.mimetype 
        });
    } else {
      return res.status(400).json({ error: "Media file required for Instagram" });
    }

    const containerRes = await fetch(containerUrl, { method: "POST", body: form });
    const containerData = await containerRes.json();

    if (!containerData.id) {
      console.error("IG container error:", containerData);
      return res.status(400).json({ error: "Failed to create post container", details: containerData });
    }

    // Step 2: Publish
    const publishUrl = `https://graph.facebook.com/v19.0/${igId}/media_publish`;
    const publishRes = await fetch(publishUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: containerData.id,
        access_token: token
      })
    });
    const publishData = await publishRes.json();

    res.json(publishData);
  } catch (err) {
    console.error("Instagram post error:", err);
    res.status(500).json({ error: "Instagram post failed" });
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
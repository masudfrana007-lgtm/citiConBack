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
  const { caption, igId, mediaUrl } = req.body; // Add mediaUrl param

  if (!igId) return res.status(400).json({ error: "No Instagram account selected" });
  if (!mediaUrl) return res.status(400).json({ error: "Media URL required" });

  try {
    const acc = await db.query(
      `SELECT token FROM social_sub_accounts WHERE sub_id = $1 AND type = 'instagram_account'`,
      [igId]
    );
    if (!acc.rows.length) return res.status(400).json({ error: "Instagram account not found" });
    const token = acc.rows[0].token;

    const containerUrl = `https://graph.facebook.com/v19.0/${igId}/media`;
    const params = new URLSearchParams({
      access_token: token,
      caption: caption || "",
    });

    const isVideo = mediaUrl.toLowerCase().includes(".mp4");
    if (isVideo) {
      params.append("video_url", mediaUrl);
      params.append("media_type", "REELS");
    } else {
      params.append("image_url", mediaUrl);
    }

// Poll until container creation succeeds and returns id
    const startTime = Date.now();
    let creationId = null;
    const pollInterval = 2000; // 2 seconds

    while (!creationId) {
      try {
        const containerRes = await fetch(containerUrl + "?" + params.toString(), { method: "POST" });
        const containerData = await containerRes.json();

        if (containerData.id) {
          creationId = containerData.id;
          const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`Instagram container created after ${timeTaken}s: ${creationId}`);
        } else if (containerData.error) {
          console.log(`Container not ready or error: ${containerData.error.message} — retrying...`);
        } else {
          console.log(`Container not ready yet (no id) — polling again in ${pollInterval / 1000}s`);
        }
      } catch (err) {
        console.error("Error creating container:", err);
      }

      if (!creationId) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    // Now publish
    const publishRes = await fetch(`https://graph.facebook.com/v19.0/${igId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: creationId,
        access_token: token
      })
    });
    const publishData = await publishRes.json();

    if (publishData.error) {
      console.error("Publish failed:", publishData.error);
      return res.status(400).json({ error: "Publish failed", details: publishData.error });
    }

    console.log("Instagram post published:", publishData.id);
    res.json(publishData);
  } catch (err) {
    console.error("Instagram post error:", err);
    res.status(500).json({ error: "Server error" });
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
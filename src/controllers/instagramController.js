import fetch from "node-fetch";
import db from "../config/db.js";

// Load IG accounts from Pages already stored
export const syncInstagramAccounts = async (req, res) => {
  const userId = req.session.user_id;

  const pages = await db.query(
    `SELECT sa.id AS account_id, ssa.sub_id AS page_id, ssa.token
     FROM social_accounts sa
     JOIN social_sub_accounts ssa ON sa.id = ssa.account_id
     WHERE sa.user_id = $1 AND ssa.type = 'facebook_page'`,
    [userId]
  );

  const inserted = [];

  for (const page of pages.rows) {
    const igRes = await fetch(
      `https://graph.facebook.com/v19.0/${page.page_id}?fields=instagram_business_account&access_token=${page.token}`
    );

    const igData = await igRes.json();

    if (igData.instagram_business_account?.id) {
      const igId = igData.instagram_business_account.id;

      await db.query(
        `INSERT INTO social_sub_accounts
         (account_id, sub_id, type, token)
         VALUES ($1, $2, 'instagram', $3)
         ON CONFLICT (sub_id) DO NOTHING`,
        [page.account_id, igId, page.token]
      );

      inserted.push(igId);
    }
  }

  res.json({ success: true, connected_instagram_accounts: inserted });
};

export const postToInstagram = async (req, res) => {
  const {
    igId,
    mediaUrl,   // image OR video URL
    caption,
    type        // "image" | "video" | "reel"
  } = req.body;

  const ig = await db.query(
    `SELECT token FROM social_sub_accounts
     WHERE sub_id = $1 AND type = 'instagram' LIMIT 1`,
    [igId]
  );

  if (!ig.rows.length)
    return res.status(400).json({ error: "Instagram account not found" });

  const token = ig.rows[0].token;

  // 1️⃣ Build container payload
  const payload = {
    caption,
    access_token: token,
  };

  if (type === "image") {
    payload.image_url = mediaUrl;
  }

  if (type === "video" || type === "reel") {
    payload.video_url = mediaUrl;
  }

  if (type === "reel") {
    payload.media_type = "REELS";
  }

  // 2️⃣ Create media container
  const createRes = await fetch(
    `https://graph.facebook.com/v19.0/${igId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  const createData = await createRes.json();

  if (!createData.id) {
    console.error("IG container error:", createData);
    return res.status(500).json(createData);
  }

  // 3️⃣ Publish
  const publishRes = await fetch(
    `https://graph.facebook.com/v19.0/${igId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: createData.id,
        access_token: token,
      }),
    }
  );

  const publishData = await publishRes.json();

  res.json({
    success: true,
    type,
    publishData,
  });
};

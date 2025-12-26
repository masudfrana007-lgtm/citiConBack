import fetch from "node-fetch";
import FormData from "form-data";
import db from "../config/db.js";

const appId = process.env.FB_APP_ID;
const appSecret = process.env.FB_APP_SECRET;
const redirectUri = process.env.FB_REDIRECT_URI;

/**
 * STEP A — OPTIONAL: Facebook Login (identity only)
 * (You may keep this for future SSO; Settings does NOT use this)
 */
export const facebookLogin = (req, res) => {
  const scopes = ["public_profile", "email"].join(",");

  const url =
    `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scopes}` +
    `&response_type=code`;

  res.redirect(url);
};

/**
 * STEP B — CONNECT FACEBOOK PAGES (THIS IS THE IMPORTANT ONE)
 */
export const facebookConnectPages = (req, res) => {
  if (!req.session.user_id) {
    return res.status(401).send("Login required");
  }

  const scopes = [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "instagram_basic",
    "instagram_content_publish"  // This enables posting    
  ].join(",");

  const url =
    `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scopes}` +
    `&response_type=code`;

  res.redirect(url);
};

/**
 * STEP C — CALLBACK (USED BY BOTH FLOWS)
 */
export const facebookCallback = async (req, res) => {
  const code = req.query.code;
  const userId = req.session.user_id;

  if (!userId) {
    return res.send("Not logged in. Please login first.");
  }

  // 1️⃣ Exchange short-lived token
  const tokenRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token` +
      `?client_id=${appId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&client_secret=${appSecret}` +
      `&code=${code}`
  );

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    console.error("FB short token error:", tokenData);
    return res.status(400).send("Facebook auth failed");
  }

  // 2️⃣ Exchange for long-lived token
  const longRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token` +
      `?grant_type=fb_exchange_token` +
      `&client_id=${appId}` +
      `&client_secret=${appSecret}` +
      `&fb_exchange_token=${tokenData.access_token}`
  );

  const longData = await longRes.json();
  if (!longData.access_token) {
    console.error("FB long token error:", longData);
    return res.status(400).send("Token exchange failed");
  }

  const userToken = longData.access_token;

  // 3️⃣ Get FB user
  const meRes = await fetch(
    `https://graph.facebook.com/me?fields=id,name&access_token=${userToken}`
  );
  const me = await meRes.json();

  // 4️⃣ Upsert social account
  const account = await db.query(
    `INSERT INTO social_accounts (user_id, platform, external_user_id, access_token)
     VALUES ($1, 'facebook', $2, $3)
     ON CONFLICT (external_user_id)
     DO UPDATE SET access_token = EXCLUDED.access_token
     RETURNING id`,
    [userId, me.id, userToken]
  );

  const accountId = account.rows[0].id;

  // 5️⃣ Fetch Pages
  const pagesRes = await fetch(
    `https://graph.facebook.com/me/accounts` +
      `?fields=id,name,picture{url},access_token` +
      `&access_token=${userToken}`
  );

  const pagesData = await pagesRes.json();

  // 6️⃣ Clear old pages
  await db.query(
    `DELETE FROM social_sub_accounts WHERE account_id=$1 AND type='facebook_page'`,
    [accountId]
  );

  // 7️⃣ Insert pages
  for (const page of pagesData.data || []) {
    await db.query(
      `INSERT INTO social_sub_accounts
       (account_id, sub_id, name, token, type, image_url)
       VALUES ($1,$2,$3,$4,'facebook_page',$5)`,
      [
        accountId,
        page.id,
        page.name,
        page.access_token,
        page?.picture?.data?.url || null
      ]
    );
  }

  // 9️⃣ Fetch & Save Linked Instagram Business/Creator Accounts
  for (const page of pagesData.data || []) {
    try {
      const igRes = await fetch(
        `https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account{id,username,profile_picture_url}&access_token=${userToken}`
      );
      const igData = await igRes.json();
      if (igData.instagram_business_account) {
        const ig = igData.instagram_business_account;
        await db.query(
          `INSERT INTO social_sub_accounts
           (account_id, sub_id, name, token, type, image_url)
           VALUES ($1, $2, $3, $4, 'instagram_account', $5)
           ON CONFLICT (sub_id) DO UPDATE SET
             name = EXCLUDED.name,
             token = EXCLUDED.token,
             image_url = EXCLUDED.image_url`,
          [
            accountId,
            ig.id,
            ig.username,
            page.access_token,  // Page token required for IG actions
            ig.profile_picture_url || null
          ]
        );
      }
    } catch (err) {
      console.error(`Error fetching IG for page ${page.id}:`, err);
    }
  }

  // 8️⃣ Close popup
  res.send(`
    <script>
      window.opener.postMessage("fb_connected", "*");
      window.close();
    </script>
  `);
};

/**
 * STATUS
 */
export const facebookStatus = async (req, res) => {
  const fb = await db.query(
    `SELECT id FROM social_accounts WHERE user_id=$1 AND platform='facebook'`,
    [req.session.user_id]
  );
  res.json({ connected: fb.rows.length > 0 });
};

/**
 * LIST PAGES
 */
export const getFacebookPages = async (req, res) => {
  const result = await db.query(
    `SELECT ssa.sub_id AS page_id,
            ssa.name AS page_name,
            ssa.image_url AS page_image
     FROM social_accounts sa
     JOIN social_sub_accounts ssa ON sa.id = ssa.account_id
     WHERE sa.user_id=$1 AND ssa.type='facebook_page'`,
    [req.session.user_id]
  );

  res.json(result.rows);
};

/**
 * POST TEXT
 */
export const postToPage = async (req, res) => {
  const { pageId, message } = req.body;

  const page = await db.query(
    `SELECT token FROM social_sub_accounts WHERE sub_id=$1`,
    [pageId]
  );

  if (!page.rows.length) {
    return res.status(400).json({ error: "Page not found" });
  }

  const fbRes = await fetch(
    `https://graph.facebook.com/${pageId}/feed`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        access_token: page.rows[0].token
      })
    }
  );

  res.json(await fbRes.json());
};

/**
 * POST MEDIA
 */
export const facebookPostMedia = async (req, res) => {
  const { caption, pageId } = req.body;
  const file = req.file;

  const page = await db.query(
    `SELECT token FROM social_sub_accounts WHERE sub_id=$1`,
    [pageId]
  );

  if (!page.rows.length) {
    return res.status(400).json({ error: "Page not found" });
  }

  const form = new FormData();
  form.append("access_token", page.rows[0].token);
  form.append("source", file.buffer, file.originalname);
  if (caption) {
    form.append(
      file.mimetype.startsWith("video/") ? "description" : "message",
      caption
    );
  }
  form.append("published", "true");

  const endpoint = file.mimetype.startsWith("video/")
    ? `https://graph.facebook.com/v19.0/${pageId}/videos`
    : `https://graph.facebook.com/v19.0/${pageId}/photos`;

  const fbRes = await fetch(endpoint, { method: "POST", body: form });
  const data = await fbRes.json();

  if (!data.id) {
    console.error("Facebook media upload failed:", data);
    return res.status(400).json({ error: "Facebook upload failed", details: data });
  }

// Get direct media URL
const startTime = Date.now();
let directMediaUrl = null;
let mediaDetails = null;
const pollInterval = 2000; // 2 seconds

while (!directMediaUrl) {
  try {
    const detailsRes = await fetch(
      `https://graph.facebook.com/v19.0/${data.id}?fields=source`,
      {
        headers: { Authorization: `Bearer ${page.rows[0].token}` }
      }
    );
    const details = await detailsRes.json();

    if (details.source) {
      directMediaUrl = details.source;
      const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`Got source URL after ${timeTaken}s: ${directMediaUrl}`);

      // Add timeTaken to the details object
      mediaDetails = {
        ...details,
        timeTakenSeconds: timeTaken
      };
    } else {
      console.log(`Source not ready yet... polling again in ${pollInterval / 1000}s`);
    }
  } catch (err) {
    console.error("Error polling for source:", err);
  }

  if (!directMediaUrl) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}
res.json({
  id: data.id,
  permalink: `https://www.facebook.com/${data.id}`,
  mediaUrl: directMediaUrl,  // Instagram uses this
  mediaDetails: mediaDetails
});
  // Save to DB (optional but recommended)
  /*
  try {
    await fetch("/post/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        platform: "facebook",
        sub_account_id: pageId,
        caption: caption || "",
        media_url: permalink,
        post_id: data.id,
        response_json: data
      })
    });
  } catch (err) {
    console.error("Failed to save post to DB:", err);
  }
*/

};

/**
 * LOGOUT
 */
export const facebookLogout = async (req, res) => {
  await db.query(
    `DELETE FROM social_accounts WHERE user_id=$1 AND platform='facebook'`,
    [req.session.user_id]
  );
  res.json({ success: true });
};

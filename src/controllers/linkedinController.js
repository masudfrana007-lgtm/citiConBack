import axios from "axios";
import crypto from "crypto";
import db from "../config/db.js";

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

/**
 * STEP A — CONNECT LINKEDIN (like facebookConnectPages)
 */
export const linkedinConnect = (req, res) => {
  if (!req.session.user_id) {
    return res.status(401).send("Login required");
  }

  const state = crypto.randomBytes(16).toString("hex");
  req.session.linkedin_state = state;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINKEDIN_CLIENT_ID,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI,
    scope: process.env.LINKEDIN_SCOPES,
    state
  });

  res.redirect(`${AUTH_URL}?${params.toString()}`);
};

/**
 * STEP B — CALLBACK (EXACTLY LIKE FACEBOOK CALLBACK)
 */
export const linkedinCallback = async (req, res) => {
  const { code, state } = req.query;
  const userId = req.session.user_id;

  if (!userId) {
    return res.send("Not logged in. Please login first.");
  }

  if (!code || state !== req.session.linkedin_state) {
    return res.status(400).send("Invalid LinkedIn OAuth state");
  }

  try {
    /* 1️⃣ Exchange code → access token */
    const tokenRes = await axios.post(
      TOKEN_URL,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.LINKEDIN_REDIRECT_URI,
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const accessToken = tokenRes.data.access_token;

    /* 2️⃣ Get LinkedIn member */
    const meRes = await axios.get(
      "https://api.linkedin.com/v2/userinfo",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const linkedinUserId = meRes.data.sub;

    /* 3️⃣ Upsert social account (SAME AS FACEBOOK) */
    await db.query(
      `
      INSERT INTO social_accounts (user_id, platform, external_user_id, access_token)
      VALUES ($1, 'linkedin', $2, $3)
      ON CONFLICT (external_user_id)
      DO UPDATE SET access_token = EXCLUDED.access_token
      `,
      [userId, linkedinUserId, accessToken]
    );

    /* 4️⃣ Close popup */
    res.send(`
      <script>
        window.opener.postMessage("linkedin_connected", "*");
        window.close();
      </script>
    `);

  } catch (err) {
    console.error("LinkedIn OAuth error:", err.response?.data || err.message);
    res.status(500).send("LinkedIn authentication failed");
  }
};

/**
 * STATUS (same pattern as facebookStatus)
 */
export const linkedinStatus = async (req, res) => {
  if (!req.session.user_id) {
    return res.json({ connected: false });
  }

  const result = await db.query(
    `SELECT id FROM social_accounts WHERE user_id=$1 AND platform='linkedin'`,
    [req.session.user_id]
  );

  res.json({ connected: result.rows.length > 0 });
};

/**
 * POST TEXT (like postToPage but personal feed)
 */
export const postToLinkedin = async (req, res) => {
  const { message } = req.body;
  const userId = req.session.user_id;

  if (!userId) {
    return res.status(401).json({ error: "Login required" });
  }

  const account = await db.query(
    `
    SELECT external_user_id, access_token
    FROM social_accounts
    WHERE user_id=$1 AND platform='linkedin'
    `,
    [userId]
  );

  if (!account.rows.length) {
    return res.status(400).json({ error: "LinkedIn not connected" });
  }

  const { external_user_id, access_token } = account.rows[0];
  const author = `urn:li:person:${external_user_id}`;

  try {
    const response = await axios.post(
      "https://api.linkedin.com/v2/ugcPosts",
      {
        author,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: message },
            shareMediaCategory: "NONE"
          }
        },
        visibility: {
          "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
        }
      },
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0"
        }
      }
    );

    res.json(response.data);
  } catch (err) {
    console.error("LinkedIn post error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to post to LinkedIn" });
  }
};

/**
 * LOGOUT (same as facebookLogout)
 */
export const linkedinLogout = async (req, res) => {
  await db.query(
    `DELETE FROM social_accounts WHERE user_id=$1 AND platform='linkedin'`,
    [req.session.user_id]
  );
  res.json({ success: true });
};

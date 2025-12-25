import crypto from "crypto";
import fetch from "node-fetch";
import db from "../config/db.js";

/* ===============================
   PKCE Helpers
================================ */
const base64url = (buffer) =>
  buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

const sha256 = (buffer) =>
  crypto.createHash("sha256").update(buffer).digest();


export const xInit = (req, res) => {
  if (!req.session.user_id) {
    return res.status(401).send("Login required");
  }

  const state = crypto.randomBytes(16).toString("hex");
  const verifier = base64url(crypto.randomBytes(32));

  req.session.x_oauth = {
    state,
    verifier,
    userId: req.session.user_id,
    createdAt: Date.now(),
  };

  res.json({ ok: true });
};

/* ===============================
   CONNECT X (OAuth 2.0 PKCE)
================================ */
export const xConnect = (req, res) => {
  const oauth = req.session.x_oauth;

  if (!oauth) {
    return res.status(400).send("OAuth session not initialized");
  }

  const challenge = base64url(sha256(oauth.verifier));

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.X_CLIENT_ID,
    redirect_uri: process.env.X_REDIRECT_URI,
    state: oauth.state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: process.env.X_SCOPES,
  });

  res.redirect(
    `https://twitter.com/i/oauth2/authorize?${params
      .toString()
      .replace(/\+/g, "%20")}`
  );
};



/* ===============================
   CALLBACK
================================ */
export const xCallback = async (req, res) => {
  const { code, state } = req.query;
  const oauth = req.session.x_oauth;

  // 1️⃣ Must exist + state must match
  if (!oauth || oauth.state !== state) {
    return res.status(400).send("Invalid or expired OAuth session");
  }

  // 2️⃣ ⏱️ EXPIRATION CHECK — ADD HERE
  if (Date.now() - oauth.createdAt > 10 * 60 * 1000) {
    delete req.session.x_oauth;
    return res.status(400).send("OAuth session expired");
  }

  // 3️⃣ Trust stored user context
  const userId = oauth.userId;
  if (!userId) {
    return res.status(400).send("OAuth user context missing");
  }

  // 4️⃣ Exchange code for token
  const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.X_CLIENT_ID,
      code,
      redirect_uri: process.env.X_REDIRECT_URI,
      code_verifier: oauth.verifier,
    }),
  });

  const token = await tokenRes.json();
  if (!token.access_token) {
    console.error("X token error:", token);
    return res.status(400).send("X auth failed");
  }

  // 5️⃣ Fetch X user
  const meRes = await fetch("https://api.twitter.com/2/users/me", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const me = await meRes.json();

  await db.query(
    `INSERT INTO social_accounts (user_id, platform, external_user_id, access_token)
     VALUES ($1,'twitter',$2,$3)
     ON CONFLICT (external_user_id)
     DO UPDATE SET access_token = EXCLUDED.access_token`,
    [userId, me.data.id, token.access_token]
  );

  // 6️⃣ Cleanup
  delete req.session.x_oauth;

  res.send(`
    <script>
      window.opener.postMessage("x_connected", "*");
      window.close();
    </script>
  `);
};


/* ===============================
   STATUS
================================ */
export const xStatus = async (req, res) => {
  if (!req.session.user_id) {
    return res.json({ connected: false });
  }

  const result = await db.query(
    `SELECT id FROM social_accounts
     WHERE user_id=$1 AND platform='twitter'`,
    [req.session.user_id]
  );

  res.json({ connected: result.rows.length > 0 });
};


/* ===============================
   POST TWEET (TEXT / MEDIA)
================================ */
export const postToX = async (req, res) => {
  const { content } = req.body;

  const acc = await db.query(
    `SELECT access_token FROM social_accounts
     WHERE user_id=$1 AND platform='twitter'`,
    [req.session.user_id]
  );

  if (!acc.rows.length) {
    return res.status(400).json({ error: "X not connected" });
  }

  const twRes = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${acc.rows[0].access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: content }),
  });

  res.json(await twRes.json());
};

/* ===============================
   LOGOUT
================================ */
export const xLogout = async (req, res) => {
  await db.query(
    `DELETE FROM social_accounts WHERE user_id=$1 AND platform='twitter'`,
    [req.session.user_id]
  );
  res.json({ success: true });
};

// src/controllers/youtubeController.js
import { google } from "googleapis";
import { Readable } from "stream";
import db from "../config/db.js";

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const ytRedirectUri = process.env.YT_REDIRECT_URI;

// Helper: new OAuth client for YouTube
const createYoutubeClient = () =>
  new google.auth.OAuth2(clientId, clientSecret, ytRedirectUri);

const YT_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

// STEP 1 – redirect user to Google consent (YouTube scopes)
export const youtubeLogin = (req, res) => {
  const oauth2Client = createYoutubeClient();

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: YT_SCOPES,
  });

  res.redirect(url);
};

// STEP 2 – handle callback, get tokens, fetch channel, save in DB
export const youtubeCallback = async (req, res) => {
  try {
    const code = req.query.code;
    const userId = req.session.user_id;

    if (!userId) {
      return res.send("Not logged in. Please login first.");
    }

    const oauth2Client = createYoutubeClient();

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const youtube = google.youtube({ version: "v3", auth: oauth2Client });

    // Get user's channel
    const channelRes = await youtube.channels.list({
      part: ["id", "snippet"],
      mine: true,
    });

    const channel = channelRes.data.items?.[0];
    if (!channel) {
      return res.status(400).send("No YouTube channel found for this account.");
    }

    const channelId = channel.id;
    const channelTitle = channel.snippet?.title || "My Channel";
    const channelThumb = channel.snippet?.thumbnails?.default?.url || null;

    // Upsert MAIN social account row (like Facebook)
    const account = await db.query(
      `INSERT INTO social_accounts
         (user_id, platform, external_user_id, access_token, refresh_token, expires_at)
       VALUES ($1, 'youtube', $2, $3, $4, to_timestamp($5/1000.0))
       ON CONFLICT (external_user_id)
       DO UPDATE SET 
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at   = EXCLUDED.expires_at
       RETURNING id`,
      [
        userId,
        channelId,
        tokens.access_token,
        tokens.refresh_token || null,
        tokens.expiry_date || null,
      ]
    );

    const accountId = account.rows[0].id;

    // Clean old channels for this account
    await db.query(
      `DELETE FROM social_sub_accounts 
       WHERE account_id = $1 AND type = 'youtube_channel'`,
      [accountId]
    );

    // Insert channel as a sub-account
    await db.query(
      `INSERT INTO social_sub_accounts
         (account_id, sub_id, name, token, type, image_url)
       VALUES ($1, $2, $3, NULL, 'youtube_channel', $4)`,
      [accountId, channelId, channelTitle, channelThumb]
    );

    // Let frontend know and close popup
    res.send(`
      <script>
        window.opener.postMessage("youtube_connected", "*");
        window.close();
      </script>
    `);
  } catch (err) {
    console.error("YouTube callback error:", err);
    res.status(500).send("YouTube auth error");
  }
};

// Status – is YouTube connected for this logged in user?
export const youtubeStatus = async (req, res) => {
  try {
    const userId = req.session.user_id;
    if (!userId) return res.json({ connected: false });

    const result = await db.query(
      `SELECT id FROM social_accounts 
       WHERE user_id = $1 AND platform = 'youtube'`,
      [userId]
    );

    res.json({ connected: result.rows.length > 0 });
  } catch (err) {
    console.error("YouTube status error:", err);
    res.json({ connected: false });
  }
};

// Get channels from DB (usually 1)
export const getYoutubeChannels = async (req, res) => {
  try {
    const userId = req.session.user_id;
    if (!userId) return res.json([]);

    const result = await db.query(
      `SELECT ssa.sub_id AS channel_id,
              ssa.name   AS channel_name,
              ssa.image_url AS channel_image
       FROM social_accounts sa
       JOIN social_sub_accounts ssa ON sa.id = ssa.account_id
       WHERE sa.user_id = $1 AND sa.platform = 'youtube'
         AND ssa.type = 'youtube_channel'`,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("YouTube channels error:", err);
    res.status(500).json({ error: "Failed to load channels" });
  }
};

// Disconnect – remove YouTube account + channels
export const youtubeLogout = async (req, res) => {
  try {
    const userId = req.session.user_id;
    if (!userId) return res.json({ success: true });

    await db.query(
      `DELETE FROM social_accounts
       WHERE user_id = $1 AND platform = 'youtube'`,
      [userId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("YouTube logout error:", err);
    res.status(500).json({ error: "Logout failed" });
  }
};


// Upload video to YouTube
export const youtubeUploadVideo = async (req, res) => {
  try {
    const userId = req.session.user_id;
    if (!userId) return res.status(401).json({ error: "Not logged in" });

    const { title, description, channelId } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: "No file uploaded" });

    // Get stored tokens for that user's channel
    const q = await db.query(
      `SELECT sa.access_token, sa.refresh_token,
              EXTRACT(EPOCH FROM sa.expires_at)*1000 AS expiry_ms
       FROM social_accounts sa
       JOIN social_sub_accounts ssa ON ssa.account_id = sa.id
       WHERE sa.user_id = $1
         AND sa.platform = 'youtube'
         AND ssa.sub_id = $2
       LIMIT 1`,
      [userId, channelId]
    );

    if (q.rows.length === 0) {
      return res.status(400).json({ error: "YouTube channel not found" });
    }

    const { access_token, refresh_token, expiry_ms } = q.rows[0];

    const oauth2Client = createYoutubeClient();
    oauth2Client.setCredentials({
      access_token,
      refresh_token,
      expiry_date: expiry_ms ? Number(expiry_ms) : undefined,
    });

    const youtube = google.youtube({ version: "v3", auth: oauth2Client });

    const media = {
      mimeType: file.mimetype,
      body: Readable.from(file.buffer),
    };

    const response = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: title || file.originalname,
          description: description || "",
        },
        status: {
          privacyStatus: "public",
        },
      },
      media,
    });

    res.json({
      success: true,
      videoId: response.data.id,
      raw: response.data,
    });
  } catch (err) {
    console.error("YouTube upload error:", err);
    res.status(500).json({ error: "YouTube upload failed", details: err.message });
  }
};

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

  let uploadedFilePath = null;

  // 🔴 SSE HEADERS
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (step, payload = {}) => {
    res.write(`data: ${JSON.stringify({ step, ...payload })}\n\n`);
  };

  try {
    // ===============================
    // STEP 1 — TOKEN
    // ===============================
    send("token", { status: "pending" });

    const acc = await db.query(
      `SELECT token FROM social_sub_accounts WHERE sub_id = $1 AND type = 'instagram_account'`,
      [igId]
    );

    if (!acc.rows.length) {
      send("token", { status: "error", error: "Instagram account not found" });
      return res.end();
    }

    const token = acc.rows[0].token;
    send("token", { status: "success" });

    // ===============================
    // STEP 2 — FILE SAVE
    // ===============================
    // send("file", { status: "pending" });

    // const uploadDir = path.join(process.cwd(), "public/uploads");
    // fs.mkdirSync(uploadDir, { recursive: true });

    // const filename = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    // uploadedFilePath = path.join(uploadDir, filename);
    // fs.writeFileSync(uploadedFilePath, file.buffer, { mode: 0o644 });

    // const publicMediaUrl = `https://ucext.com/uploads/${filename}`;
    // const isVideo = file.mimetype.startsWith("video/");

    // send("file", {
    //   status: "success",
    //   filename,
    //   url: publicMediaUrl
    // });

// ===============================
// STEP 2 — USE EXISTING SERVER FILE (TEMP TEST)
// ===============================
send("file", { status: "pending" });

// ⚠️ CHANGE THIS TO ONE OF YOUR EXISTING FILES
const filename = "1766831008451-image.jpg";

const uploadedFilePath = path.join(
  process.cwd(),
  "public/uploads",
  filename
);

if (!fs.existsSync(uploadedFilePath)) {
  send("file", {
    status: "error",
    error: "Test file not found on server"
  });
  return res.end();
}

const publicMediaUrl = `https://ucext.com/uploads/${filename}`;
const isVideo = false;

send("file", {
  status: "success",
  filename,
  url: publicMediaUrl,
  note: "Using existing server file"
});



    // ===============================
    // STEP 3 — CREATE CONTAINER
    // ===============================
    send("container", { status: "pending" });

    const params = new URLSearchParams({
      access_token: token,
      caption
    });

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
      send("container", {
        status: "error",
        error: createData.error?.message
      });
      return res.end();
    }

    const creationId = createData.id;
    send("container", { status: "success", creationId });

// ===============================
// STEP 4 — PROCESSING (FIXED)
// ===============================
send("processing", { status: "pending" });

let status = "IN_PROGRESS";

while (status !== "FINISHED") {
  await new Promise(r => setTimeout(r, 3000));

  const sRes = await fetch(
    `https://graph.facebook.com/v19.0/${creationId}?fields=status_code&access_token=${token}`
  );

  const sData = await sRes.json();
  status = sData.status_code;

  send("processing", { status });

  if (status === "ERROR") {
    send("processing", {
      status: "error",
      error: "Instagram processing failed"
    });
    return res.end();
  }
}


    // ===============================
    // STEP 5 — PUBLISH
    // ===============================
    send("publish", { status: "pending" });

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
      send("publish", {
        status: "error",
        error: publishData.error.message
      });
      return res.end();
    }

    send("publish", {
      status: "success",
      mediaId: publishData.id
    });

    // ===============================
    // STEP 6 — CLEANUP
    // ===============================
    if (fs.existsSync(uploadedFilePath)) {
      fs.unlinkSync(uploadedFilePath);
    }

    send("cleanup", { status: "success" });

    // ✅ DONE
    send("done", { success: true });
    res.end();

  } catch (err) {
    send("fatal", { error: err.message });
    res.end();
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
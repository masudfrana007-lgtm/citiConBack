// controllers/postController.js

import db from "../config/db.js";
import path from "path";
import fs from "fs";

// Your existing handlePost stays 100% the same
export const handlePost = async (req, res) => {
  try {
    const file = req.file;
    const { caption, platforms } = req.body;
    if (!file) {
      return res.status(400).json({ error: "File is required" });
    }
    const platformList = JSON.parse(platforms || "[]");
    console.log("Received post request:");
    console.log("File:", file.path);
    console.log("Caption:", caption);
    console.log("Platforms:", platformList);

    // Move file from tmp/ to permanent uploads folder
    const uploadDir = path.join(process.cwd(), "public/uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const permanentPath = path.join(uploadDir, file.filename);
    fs.renameSync(file.path, permanentPath);

    return res.json({
      message: "Post received successfully",
      file: file.filename,
      mediaUrl: `/uploads/${file.filename}`,
      platforms: platformList,
      caption,
    });
  } catch (err) {
    console.error("POST ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

// ────────────────────────────────
// NEW: Save main post record
// ────────────────────────────────
export const createPostRecord = async (req, res) => {
  const userId = req.session.user_id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const {
    title = "Untitled Post",
    content = "",
    mediaUrl,
    mediaType, // "image" or "video"
    originalFilename,
    division,
    district,
    upazila,
    union,
    platforms = [] // array of { platform, targetId, targetName }
  } = req.body;

  try {
    // 1. Insert main post
    const postRes = await db.query(
      `INSERT INTO posts 
       (user_id, title, content, media_url, media_type, original_filename,
        division, district, upazila, union_ward, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
       RETURNING id`,
      [
        userId,
        title,
        content,
        mediaUrl,
        mediaType,
        originalFilename,
        division || null,
        district || null,
        upazila || null,
        union || null,
      ]
    );

    const postId = postRes.rows[0].id;

    // 2. Insert platform records
    for (const p of platforms) {
      await db.query(
        `INSERT INTO post_platforms 
         (post_id, platform, sub_account_id, target_name, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [postId, p.platform, p.targetId || null, p.targetName || null]
      );
    }

    res.json({ success: true, postId });
  } catch (err) {
    console.error("createPostRecord error:", err);
    res.status(500).json({ error: "Failed to save post" });
  }
};

// ────────────────────────────────
// NEW: Update platform status
// ────────────────────────────────
export const updatePlatformStatus = async (req, res) => {
  const userId = req.session.user_id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const {
    postId,
    platform,
    targetName,
    status, // "success", "error"
    externalPostId,
    permalink,
    errorMessage,
  } = req.body;

  try {
    await db.query(
      `UPDATE post_platforms
       SET status = $1,
           external_post_id = $2,
           permalink = $3,
           error_message = $4,
           updated_at = NOW()
       WHERE post_id = $5
         AND platform = $6
         AND ($7::text IS NULL OR target_name = $7)`,
      [
        status,
        externalPostId || null,
        permalink || null,
        errorMessage || null,
        postId,
        platform,
        targetName || null,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("updatePlatformStatus error:", err);
    res.status(500).json({ error: "Failed to update status" });
  }
};

// ────────────────────────────────
// NEW: Show all posts with platform details
// ────────────────────────────────
export const showPosts = async (req, res) => {
  const userId = req.session.user_id;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await db.query(
      `SELECT 
         p.id,
         p.title,
         p.content,
         p.media_url,
         p.media_type,
         p.original_filename,
         p.division,
         p.district,
         p.upazila,
         p.union_ward,
         p.status AS post_status,
         p.created_at,
         COALESCE(
           json_agg(
             json_build_object(
               'id', pp.id,
               'platform', pp.platform,
               'target_name', pp.target_name,
               'status', pp.status,
               'external_post_id', pp.external_post_id,
               'permalink', pp.permalink,
               'error_message', pp.error_message
             )
           ) FILTER (WHERE pp.id IS NOT NULL),
           '[]'
         ) AS platforms
       FROM posts p
       LEFT JOIN post_platforms pp ON p.id = pp.post_id
       WHERE p.user_id = $1
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("showPosts error:", err);
    res.status(500).json({ error: "Failed to load posts" });
  }
};
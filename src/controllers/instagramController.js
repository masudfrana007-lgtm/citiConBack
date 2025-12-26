// controllers/instagramController.js
import db from "../config/db.js";

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
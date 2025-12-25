import bcrypt from "bcryptjs";
import db from "../config/db.js";

export const signup = async (req, res) => {
  const { name, email, password } = req.body;

  const hashed = await bcrypt.hash(password, 10);

  try {
    const result = await db.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [name, email, hashed]
    );

    req.session.user_id = result.rows[0].id;
    return res.json({ success: true });

    } catch (err) {
       console.error("Signup error:", err);  // This will show in PM2 logs
       return res.status(500).json({ 
       success: false, 
       error: "Database error", 
       details: err.message  // Safe to expose only during debug
    });
   }
};


export const login = async (req, res) => {
  const { email, password } = req.body;

  const found = await db.query(
    "SELECT id, password_hash FROM users WHERE email = $1",
    [email]
  );

  if (found.rows.length === 0) {
    return res.status(400).json({ error: "Invalid email or password" });
  }

  const user = found.rows[0];

  const match = await bcrypt.compare(password, user.password_hash);

  if (!match) {
    return res.status(400).json({ error: "Invalid email or password" });
  }

  req.session.user_id = user.id;

  res.json({ success: true, userId: user.id });
};

export const logout = (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
};

export const me = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (!req.session.user_id) {
    return res.json(null);
  }

  try {
    const result = await db.query(
      "SELECT id, name, email FROM users WHERE id = $1",
      [req.session.user_id]
    );

    if (result.rows.length === 0) {
      return res.json(null);
    }

    const user = result.rows[0];
    res.json({
      user_id: user.id,
      name: user.name || '',
      email: user.email
    });
  } catch (err) {
    console.error("Me endpoint error:", err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
};

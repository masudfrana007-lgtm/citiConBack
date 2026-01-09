import express from "express";
import fetch from "node-fetch";

const router = express.Router();

router.get("/proxy", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Missing url");

  try {
    const decodedUrl = decodeURIComponent(url);
    const host = new URL(decodedUrl).hostname;

    // 🔐 VERY IMPORTANT — whitelist
    const allowed = [
      "fbcdn.net",
      "facebook.com",
      "cdninstagram.com",
      "instagram.com",
      "licdn.com",
      "linkedin.com",
      "twimg.com",
      "pbs.twimg.com"
    ];

    if (!allowed.some(h => host.endsWith(h))) {
      return res.status(403).send("Forbidden");
    }

    const r = await fetch(decodedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "image/*"
      },
      timeout: 8000
    });

    if (!r.ok) return res.status(502).send("Upstream failed");

    res.setHeader(
      "Content-Type",
      r.headers.get("content-type") || "image/jpeg"
    );
    res.setHeader("Cache-Control", "public, max-age=86400");

    r.body.pipe(res);
  } catch (e) {
    console.error("proxy error", e.message);
    res.status(500).send("Proxy error");
  }
});

export default router;

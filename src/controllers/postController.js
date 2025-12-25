export const handlePost = async (req, res) => {
  try {
    const file = req.file;
    const { caption, platforms } = req.body;

    if (!file) {
      return res.status(400).json({ error: "File is required" });
    }

    // Parse platforms (frontend sends JSON string)
    const platformList = JSON.parse(platforms || "[]");

    console.log("Received post request:");
    console.log("File:", file.path);
    console.log("Caption:", caption);
    console.log("Platforms:", platformList);

    // 🔥 Later: puppeteer automation happens here

    return res.json({
      message: "Post received successfully",
      file: file.filename,
      platforms: platformList,
      caption,
    });
  } catch (err) {
    console.error("POST ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

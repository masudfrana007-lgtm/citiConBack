import { uploadFile } from "../services/googleService.js";

export const uploadToDrive = async (req, res) => {
  try {
    const { token, filename, mimeType, fileContent } = req.body;

    const url = await uploadFile(token, filename, mimeType, fileContent);

    res.json({ success: true, url });
  } catch (err) {
    console.error("Drive Upload Error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
};

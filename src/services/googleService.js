import { google } from "googleapis";
import { oauth2Client } from "../config/google.js";

export const uploadFile = async (token, filename, mimeType, fileContent) => {
  oauth2Client.setCredentials(token);

  const drive = google.drive({ version: "v3", auth: oauth2Client });

  const response = await drive.files.create({
    requestBody: {
      name: filename,
      mimeType,
    },
    media: {
      mimeType,
      body: Buffer.from(fileContent, "base64"),
    },
  });

  return `https://drive.google.com/file/d/${response.data.id}`;
};

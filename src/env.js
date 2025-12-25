// src/env.js
import dotenv from "dotenv";

dotenv.config();

console.log("ENV CHECK → GOOGLE_CLIENT_ID:", process.env.GOOGLE_CLIENT_ID);

if (!process.env.GOOGLE_CLIENT_ID) {
  console.error("❌ GOOGLE_CLIENT_ID not loaded");
  process.exit(1);
}

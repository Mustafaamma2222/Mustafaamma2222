// يولّد public/config.js من متغيرات البيئة أثناء البناء على Netlify
const fs = require("fs");
const path = require("path");

const url = process.env.SUPABASE_URL || "";
const key = process.env.SUPABASE_ANON_KEY || "";

if (!url || !key) {
  console.warn("⚠️  SUPABASE_URL أو SUPABASE_ANON_KEY غير موجود في متغيرات البيئة.");
}

const out = `window.APP_CONFIG = ${JSON.stringify({ SUPABASE_URL: url, SUPABASE_ANON_KEY: key }, null, 2)};\n`;
fs.writeFileSync(path.join(__dirname, "..", "public", "config.js"), out);
console.log("✅ تم إنشاء public/config.js");

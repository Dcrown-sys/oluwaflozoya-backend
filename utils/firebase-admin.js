// utils/firebase-admin.js
const admin = require("firebase-admin");

const projectId     = process.env.FIREBASE_PROJECT_ID;
const clientEmail   = process.env.FIREBASE_CLIENT_EMAIL;
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
let privateKey      = process.env.FIREBASE_PRIVATE_KEY;

// ── Safety checks ──
if (!projectId || !clientEmail || !privateKey) {
  console.error("❌ Firebase Admin: missing env vars:");
  console.error("   FIREBASE_PROJECT_ID:", projectId ? "✅" : "❌ MISSING");
  console.error("   FIREBASE_CLIENT_EMAIL:", clientEmail ? "✅" : "❌ MISSING");
  console.error("   FIREBASE_PRIVATE_KEY:", privateKey ? "✅" : "❌ MISSING");
  module.exports = null;
  return; // stop execution
}

// ── Fix escaped newlines (critical for Render / Railway env vars) ──
// Render stores \n as literal \\n — this converts them back to real newlines
privateKey = privateKey.replace(/\\n/g, "\n");

// ── Prevent duplicate initialization ──
try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      ...(storageBucket && { storageBucket }),
    });
    console.log("✅ Firebase Admin initialized");
    console.log("   Project ID:", projectId);
    console.log("   Client Email:", clientEmail);
    console.log("   Storage Bucket:", storageBucket || "not set");
  } else {
    console.log("ℹ️ Firebase Admin already initialized");
  }

  module.exports = admin;
} catch (err) {
  console.error("❌ Firebase Admin initialization failed:", err.message);
  module.exports = null;
}
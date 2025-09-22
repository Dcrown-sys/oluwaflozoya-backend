// src/firebaseAdmin.js
const admin = require("firebase-admin");

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
let privateKey = process.env.FIREBASE_PRIVATE_KEY;

// Safety checks
if (!projectId || !clientEmail || !privateKey) {
  console.warn("⚠️ Firebase env vars missing. Firebase Admin will not be initialized.");
  module.exports = null;
  return;
}

// Fix escaped newlines (important for Render env vars)
privateKey = privateKey.replace(/\\n/g, "\n");

try {
  // Prevent duplicate initialization
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      // optional: storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
    console.log("✅ Firebase Admin initialized");
  } else {
    console.log("ℹ️ Firebase Admin already initialized");
  }

  module.exports = admin;
} catch (err) {
  console.error("❌ Firebase Admin initialization failed:", err);
  module.exports = null;
}

const admin = require("firebase-admin");

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (err) {
    console.error("❌ Invalid FIREBASE_SERVICE_ACCOUNT JSON:", err);
  }
} else {
  
  try {
    serviceAccount = require("./serviceAccountKey.json");
  } catch (err) {
    console.warn("⚠️ No local serviceAccountKey.json found.");
  }
}

if (!admin.apps.length && serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET, // ✅ add this
  });
  console.log("ℹ️ Firebase Admin initialized with storage bucket:", process.env.FIREBASE_STORAGE_BUCKET);
} else {
  console.warn("⚠️ Firebase Admin not initialized. Missing credentials.");
}

module.exports = admin;

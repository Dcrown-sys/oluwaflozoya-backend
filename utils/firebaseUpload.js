const { v4: uuidv4 } = require('uuid');
const admin = require('./firebase-admin'); // your initialized admin instance

if (!admin) throw new Error('Firebase Admin not initialized');

const bucket = admin.storage().bucket(); // uses storageBucket from firebase-admin.js

console.log('Firebase bucket at module load:', bucket?.name);

// sanitize filenames to avoid invalid characters
const sanitizeFilename = (name) => name.replace(/[^a-zA-Z0-9.-]/g, '_');

/**
 * Uploads a buffer to Firebase Storage.
 * @param {Buffer} buffer - file buffer
 * @param {string} filename - original filename
 * @param {string} mimetype - file mime type
 * @param {string} folder - storage folder (default 'kyc')
 * @returns {string} public download URL
 */
const uploadBufferToFirebase = async (buffer, filename, mimetype, folder = 'kyc') => {
  try {
    console.log(`Uploading file to folder "${folder}" in bucket "${bucket.name}"`);

    const uniqueToken = uuidv4();
    const sanitizedFilename = sanitizeFilename(filename);
    const destination = `${folder}/${Date.now()}-${sanitizedFilename}`;

    const file = bucket.file(destination);

    await file.save(buffer, {
      metadata: {
        metadata: { firebaseStorageDownloadTokens: uniqueToken },
        contentType: mimetype,
        cacheControl: 'public, max-age=31536000',
      },
    });

    console.log(`✅ Uploaded to Firebase: ${destination}`);

    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
      destination
    )}?alt=media&token=${uniqueToken}`;
  } catch (err) {
    console.error('❌ Error uploading file to Firebase:', err);
    throw err;
  }
};

module.exports = uploadBufferToFirebase;

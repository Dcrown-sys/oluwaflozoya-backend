// utils/firebaseUpload.js
const { v4: uuidv4 } = require('uuid');
const { bucket } = require('./firebase-admin'); // ✅ use only this bucket
const path = require('path');
const fs = require('fs');

const uploadImageToFirebase = async (localFilePath, filename) => {
  const destination = `products/${filename}`;
  const metadata = {
    metadata: {
      firebaseStorageDownloadTokens: uuidv4(),
    },
    contentType: 'image/jpeg',
    cacheControl: 'public, max-age=31536000',
  };

  await bucket.upload(localFilePath, {
    destination,
    metadata,
  });

  console.log(`✅ Uploaded to Firebase at: ${destination}`);
  fs.unlinkSync(localFilePath); // delete temp file

  const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(destination)}?alt=media&token=${metadata.metadata.firebaseStorageDownloadTokens}`;
  return imageUrl;
};

module.exports = uploadImageToFirebase;

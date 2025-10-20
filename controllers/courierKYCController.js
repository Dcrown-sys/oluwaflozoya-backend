const { sql } = require('../db');
const admin = require('firebase-admin');

// Make sure Firebase is initialized elsewhere, e.g.:
// admin.initializeApp({
//   credential: admin.credential.cert(require('../firebase-service-account.json')),
//   storageBucket: 'your-firebase-bucket-url.appspot.com',
// });

exports.submitKYC = async (req, res) => {
  const userId = req.user.id;
  const { full_name, phone, address, vehicle_type, vehicle_plate } = req.body;

  const selfieFile = req.files?.selfie?.[0];
  const documentFile = req.files?.document?.[0];

  if (!full_name || !phone || !address || !vehicle_type || !vehicle_plate || !selfieFile || !documentFile) {
    return res.status(400).json({ success: false, message: 'All fields are required' });
  }

  try {
    const bucket = admin.storage().bucket();

    // Upload selfie
    const selfieName = `kyc/selfie-${Date.now()}-${selfieFile.originalname}`;
    const selfieRef = bucket.file(selfieName);
    await selfieRef.save(selfieFile.buffer, { metadata: { contentType: selfieFile.mimetype } });
    const [selfieUrl] = await selfieRef.getSignedUrl({ action: 'read', expires: '03-09-2491' });

    // Upload document
    const documentName = `kyc/document-${Date.now()}-${documentFile.originalname}`;
    const documentRef = bucket.file(documentName);
    await documentRef.save(documentFile.buffer, { metadata: { contentType: documentFile.mimetype } });
    const [documentUrl] = await documentRef.getSignedUrl({ action: 'read', expires: '03-09-2491' });

    const existingCourier = await sql`SELECT id FROM couriers WHERE user_id = ${userId}`;

    if (existingCourier.length > 0) {
      await sql`
        UPDATE couriers
        SET full_name = ${full_name},
            phone = ${phone},
            address = ${address},
            vehicle_type = ${vehicle_type},
            vehicle_plate = ${vehicle_plate},
            selfie_url = ${selfieUrl},
            document_url = ${documentUrl},
            verification_status = 'pending'
        WHERE user_id = ${userId}
      `;
    } else {
      await sql`
        INSERT INTO couriers
          (user_id, full_name, phone, address, vehicle_type, vehicle_plate, selfie_url, document_url, verification_status)
        VALUES
          (${userId}, ${full_name}, ${phone}, ${address}, ${vehicle_type}, ${vehicle_plate}, ${selfieUrl}, ${documentUrl}, 'pending')
      `;
    }

    res.json({ success: true, message: 'KYC submitted successfully' });
  } catch (err) {
    console.error('❌ KYC submission error:', err);
    res.status(500).json({ success: false, message: 'Server error submitting KYC' });
  }
};

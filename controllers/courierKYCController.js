const { sql } = require('../db');
const uploadBufferToFirebase = require('../utils/firebaseUpload');

exports.submitKYC = async (req, res) => {
  console.log('req.body:', req.body);
  console.log('req.files:', req.files);

  try {
    const userId = req.user.id;
    const { full_name, phone, address, vehicle_type, vehicle_plate } = req.body;

    const selfieFile = req.files?.selfie?.[0];
    const documentFile = req.files?.document?.[0];

    // Validate all required fields
    if (!full_name || !phone || !address || !vehicle_type || !vehicle_plate || !selfieFile || !documentFile) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    // Upload files to Firebase
    const selfieUrl = await uploadBufferToFirebase(
      selfieFile.buffer,
      `selfie-${Date.now()}-${selfieFile.originalname}`,
      selfieFile.mimetype
    );

    const documentUrl = await uploadBufferToFirebase(
      documentFile.buffer,
      `document-${Date.now()}-${documentFile.originalname}`,
      documentFile.mimetype
    );

    // UPSERT: Insert new courier or update existing one
    await sql`
      INSERT INTO couriers
        (user_id, full_name, phone, address, vehicle_type, vehicle_plate, selfie_url, document_url, verification_status, created_at, updated_at)
      VALUES
        (${userId}, ${full_name}, ${phone}, ${address}, ${vehicle_type}, ${vehicle_plate}, ${selfieUrl}, ${documentUrl}, 'pending', NOW(), NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        full_name = ${full_name},
        phone = ${phone},
        address = ${address},
        vehicle_type = ${vehicle_type},
        vehicle_plate = ${vehicle_plate},
        selfie_url = ${selfieUrl},
        document_url = ${documentUrl},
        verification_status = 'pending',
        updated_at = NOW()
    `;

    res.json({ success: true, message: "KYC submitted successfully" });
  } catch (err) {
    console.error("❌ KYC submission error:", err);
    res.status(500).json({ success: false, message: "Server error submitting KYC" });
  }
};

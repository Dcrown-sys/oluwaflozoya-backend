const { sql } = require('../db');
const path = require('path');
const fs = require('fs');

exports.submitKYC = async (req, res) => {
  const userId = req.user.id;
  const { full_name, phone, address, vehicle_type, vehicle_plate } = req.body;

  const selfieFile = req.files?.selfie?.[0];
  const documentFile = req.files?.document?.[0];

  if (!full_name || !phone || !address || !vehicle_type || !vehicle_plate || !selfieFile || !documentFile) {
    return res.status(400).json({ success: false, message: 'All fields are required' });
  }

  try {
    // Save files locally (optional) or push to cloud
    const selfieName = `${Date.now()}-${selfieFile.originalname}`;
    const documentName = `${Date.now()}-${documentFile.originalname}`;
    const uploadsDir = path.join(__dirname, '../uploads');

    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

    fs.writeFileSync(path.join(uploadsDir, selfieName), selfieFile.buffer);
    fs.writeFileSync(path.join(uploadsDir, documentName), documentFile.buffer);

    const selfie_url = `/uploads/${selfieName}`;
    const document_url = `/uploads/${documentName}`;

    const existingCourier = await sql`SELECT id FROM couriers WHERE user_id = ${userId}`;

    if (existingCourier.length > 0) {
      await sql`
        UPDATE couriers
        SET full_name = ${full_name},
            phone = ${phone},
            address = ${address},
            vehicle_type = ${vehicle_type},
            vehicle_plate = ${vehicle_plate},
            selfie_url = ${selfie_url},
            document_url = ${document_url},
            verification_status = 'pending'
        WHERE user_id = ${userId}
      `;
    } else {
      await sql`
        INSERT INTO couriers
          (user_id, full_name, phone, address, vehicle_type, vehicle_plate, selfie_url, document_url, verification_status)
        VALUES
          (${userId}, ${full_name}, ${phone}, ${address}, ${vehicle_type}, ${vehicle_plate}, ${selfie_url}, ${document_url}, 'pending')
      `;
    }

    res.json({ success: true, message: 'KYC submitted successfully' });
  } catch (err) {
    console.error('❌ KYC submission error:', err);
    res.status(500).json({ success: false, message: 'Server error submitting KYC' });
  }
};

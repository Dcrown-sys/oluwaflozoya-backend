// routes/constructionRoutes.js
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const os       = require('os');
const { verifyToken } = require('../middleware/auth');
const { analyzeConstruction, chatConstruction } = require('../controllers/constructionAI');

// ── Multer config — stores image in OS temp folder ───────────
// Uses temp dir so files don't pile up on your server.
// The controller deletes the file after reading it.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, os.tmpdir()); // e.g. /tmp on Linux/Mac
  },
  filename: (req, file, cb) => {
    const unique = `construction-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, unique + path.extname(file.originalname));
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, WEBP and GIF images are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
});

// ── Routes ───────────────────────────────────────────────────

/**
 * POST /api/construction/analyze
 * Full QS analysis — accepts form-data with optional image
 *
 * Body fields (form-data or JSON if no image):
 *   projectType  — building | road | bridge | drainage | fencing
 *   houseType    — duplex | bungalow | terrace | mansion | flat
 *   plotLength   — number (metres)
 *   plotWidth    — number (metres)
 *   floors       — number
 *   phase        — foundation | structure | roofing | finishing | complete
 *   specialReqs  — string (optional)
 *   region       — Lagos | Abuja | PortHarcourt | Kano | Ibadan (optional)
 *   measureLand  — boolean (true = AI extracts dimensions from image)
 *
 * File field: image (optional JPEG/PNG/WEBP, max 10MB)
 */
router.post(
  '/analyze',
  verifyToken,
  upload.single('image'),   // 'image' must match the field name from frontend
  handleMulterError,        // catches file type / size errors cleanly
  analyzeConstruction
);

/**
 * POST /api/construction/chat
 * Follow-up questions about a previous estimate (no image upload)
 *
 * Body (JSON):
 *   message  — string  e.g. "What if I use aluminum windows instead?"
 *   context  — object  (optional) — pass back the specs + structured report
 *                      from the previous /analyze response so AI has context
 */
router.post(
  '/chat',
  verifyToken,
  chatConstruction
);

// ── Multer error handler ─────────────────────────────────────
// Must be defined as a named function so it can be referenced above
function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'Image too large. Maximum size is 10MB.',
      });
    }
    return res.status(400).json({
      success: false,
      error: `Upload error: ${err.message}`,
    });
  }
  if (err) {
    return res.status(400).json({
      success: false,
      error: err.message || 'File upload failed.',
    });
  }
  next();
}

module.exports = router;
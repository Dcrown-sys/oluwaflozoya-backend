const multer = require('multer');

const storage = multer.memoryStorage(); // No disk, just memory
const upload = multer({ storage });

module.exports = upload;

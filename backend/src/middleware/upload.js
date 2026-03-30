const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const { v4: uuid } = require('uuid');

const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
const MAX_SIZE_MB = 20;

/* ── Local disk storage ── */
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuid()}${ext}`);
  },
});

const upload = multer({
  storage: diskStorage,
  limits:  { fileSize: MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
  },
});

/* ── S3 upload helper (used when STORAGE_DRIVER=s3) ── */
async function uploadToS3(file) {
  // Lazy-load AWS SDK only when needed
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const fs2 = require('fs');
  const s3 = new S3Client({ region: process.env.AWS_REGION });
  const key = `documents/${uuid()}${path.extname(file.originalname)}`;
  await s3.send(new PutObjectCommand({
    Bucket:      process.env.AWS_S3_BUCKET,
    Key:         key,
    Body:        fs2.createReadStream(file.path),
    ContentType: file.mimetype,
  }));
  // Clean up temp file
  fs2.unlinkSync(file.path);
  return `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

module.exports = { upload, uploadToS3 };

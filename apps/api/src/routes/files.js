import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { json, slugify } from '../utils.js';
import { JWT_SECRET } from '../config.js';

export async function handleFiles(req, res, body) {
  // Presigned S3 upload
  if (req.method === 'POST' && req.url === '/api/files/sign') {
    let S3Client, PutObjectCommand, getSignedUrl;
    try {
      const s3mod = await import('@aws-sdk/client-s3');
      S3Client = s3mod.S3Client; PutObjectCommand = s3mod.PutObjectCommand;
    } catch {}
    try {
      const presign = await import('@aws-sdk/s3-request-presigner');
      getSignedUrl = presign.getSignedUrl;
    } catch {}
    if (!S3Client || !getSignedUrl) return json(res, 501, { message: 'S3 not configured' }), true;

    let userId = null;
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) { try { const p = jwt.verify(auth.slice(7), JWT_SECRET); userId = p.sub; } catch {} }
    if (!userId) return json(res, 401, { message: 'Unauthorized' }), true;

    const { filename, contentType, size } = body || {};
    const name = String(filename || 'file').slice(0, 180);
    const ctype = String(contentType || 'application/octet-stream');
    const sizeBytes = Number(size || 0);
    const MAX = Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024);
    if (sizeBytes > MAX) return json(res, 400, { message: `File too large (max ${MAX} bytes)` }), true;

    const BUCKET = process.env.STORAGE_S3_BUCKET || 'echo-app';
    const ENDPOINT = process.env.STORAGE_S3_ENDPOINT || 'http://localhost:9000';
    const REGION = process.env.STORAGE_S3_REGION || 'us-east-1';
    const ACCESS_KEY = process.env.STORAGE_S3_ACCESS_KEY || process.env.MINIO_ROOT_USER || '';
    const SECRET_KEY = process.env.STORAGE_S3_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '';
    const FORCE_PATH = String(process.env.STORAGE_S3_FORCE_PATH_STYLE || 'true') === 'true';
    const PUBLIC_BASE = process.env.STORAGE_PUBLIC_BASE || `${ENDPOINT.replace(/\/$/, '')}/${BUCKET}`;

    const s3 = new S3Client({
      region: REGION,
      endpoint: ENDPOINT,
      forcePathStyle: FORCE_PATH,
      credentials: ACCESS_KEY && SECRET_KEY ? { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY } : undefined,
    });
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    const safe = slugify(name);
    const key = `uploads/${userId}/${Date.now()}-${randomUUID().slice(0,8)}-${safe}${ext ? '.'+ext : ''}`;
    const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: ctype, ACL: undefined });
    const url = await getSignedUrl(s3, cmd, { expiresIn: 60 });
    const publicUrl = `${PUBLIC_BASE.replace(/\/$/,'')}/${key}`;
    let uploadUrl = url;
    const USE_FILES_PROXY = String(process.env.STORAGE_USE_FILES_PROXY || 'true') === 'true';
    if (USE_FILES_PROXY) {
      try { const u = new URL(url); uploadUrl = `/files${u.pathname}${u.search}`; } catch {}
    }
    return json(res, 200, { url: uploadUrl, method: 'PUT', headers: { 'Content-Type': ctype }, key, publicUrl }), true;
  }
  return false;
}


const jwt = require('jsonwebtoken');
const https = require('http');

const JWT_SECRET = process.env.JWT_SECRET || 'novel-system-secret-key-2024-chuang-shi-ji-lian-meng';
const payload = {
  userId: 'fb49c47a-8b3f-4705-bc53-ac6b1ac5bcf9',
  email: 'jiyongdian@gmail.com',
  username: 'admin',
  role: 'admin',
};
const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
// Decode to show
const decoded = jwt.verify(token, JWT_SECRET);
console.log('✅ token signed OK, decoded:', decoded);

const postData = JSON.stringify({
  novelId: 'novel_1788199340026_d6gzoslyk',
  scope: 'all',
  saveToDB: false,
});

const req = https.request({
  hostname: '127.0.0.1', port: 5000, method: 'POST',
  path: '/api/novel/script/apply-quality-fixes',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData),
  },
  timeout: 180000,
}, (res) => {
  console.log('HTTP', res.statusCode);
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => console.log(data.slice(0, 2500)));
});
req.on('error', (e) => console.error('err', e.message));
req.write(postData);
req.end();

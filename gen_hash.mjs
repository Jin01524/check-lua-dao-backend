import bcrypt from 'bcryptjs';

const password = process.env.ADMIN_PASSWORD;
if (!password || password.length < 12) {
  throw new Error('Set ADMIN_PASSWORD (at least 12 characters) in the environment.');
}
const hash = await bcrypt.hash(password, 10);
console.log('BCRYPT_HASH=' + hash);

import bcrypt from 'bcryptjs';

const password = 'admin@checkluadao2024';
const hash = await bcrypt.hash(password, 10);
console.log('BCRYPT_HASH=' + hash);

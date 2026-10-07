const crypto = require('crypto');

function buatPrivateKeyPem() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  return privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString()
    .replace(/\n/g, '\\n');
}

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-project';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'demo@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || buatPrivateKeyPem();

const adminApp = require('firebase-admin/app');
const adminFirestore = require('firebase-admin/firestore');

const store = {
  'approved-user': { status: 'approved' },
  'revoked-user': { status: 'revoked' },
};

adminApp.getApps = () => [];
adminApp.initializeApp = () => ({ name: 'mock-app' });
adminFirestore.getFirestore = () => ({
  collection: () => ({
    doc: (id) => ({
      async get() {
        const data = store[String(id)];
        return { exists: !!data, data: () => data || {} };
      },
      async update(payload) {
        store[String(id)] = { ...(store[String(id)] || {}), ...payload };
        return true;
      },
      async set(payload) {
        store[String(id)] = { ...(store[String(id)] || {}), ...payload };
        return true;
      },
      async delete() {
        delete store[String(id)];
        return true;
      },
    }),
  }),
});

const { tentukanStatusAkses } = require('../lib/models/accessRequests');

(async () => {
  const approvedStatus = await tentukanStatusAkses('approved-user');
  const revokedStatus = await tentukanStatusAkses('revoked-user');

  if (approvedStatus !== 'approved') {
    throw new Error(`Status approved salah: ${approvedStatus}`);
  }

  if (revokedStatus !== 'boleh_request_baru') {
    throw new Error(`Status revoked salah: ${revokedStatus}`);
  }

  console.log(JSON.stringify({ approved: approvedStatus, revoked: revokedStatus }));
  console.log('Revoke regression check passed.');
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});

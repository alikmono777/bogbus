import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// A deterministic RSA keypair used only for tests. We set the public key in the
// environment BEFORE importing config/signature so the module picks it up.
const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAkt7K8lHRWta/IWXI9WGZ
msc8lYcW1RoBODLgXg/p5OO2eIlKGhSk+ittSVVV6Rxy3D78P6yTyvubJ6BDMABA
9LWynF2Ks/rLCw8pAl0SESxJSkvKgdrNAY2MS9pj/WoPZgLHc6oaxydd9tmQnmlU
LAGi+WwUL2CmXlPuCs2O3r3wHzcTv3Zg9s7OtX5opPOVMqXn4WwG7GY74QtFL3Ok
9kRtibfxVAN4g4njb7T9Lrg3e0MnniB8JKdSooJIjfk7b//TK7RW2lIac6u+U1ec
QxUZ00nseXGGhE68fchw9ungMBvHWg0y9YclLAusmndRYlAkGEOA/jj2vlMTx5nI
2wIDAQAB
-----END PUBLIC KEY-----`;

const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCS3sryUdFa1r8h
Zcj1YZmaxzyVhxbVGgE4MuBeD+nk47Z4iUoaFKT6K21JVVXpHHLcPvw/rJPK+5sn
oEMwAED0tbKcXYqz+ssLDykCXRIRLElKS8qB2s0BjYxL2mP9ag9mAsdzqhrHJ132
2ZCeaVQsAaL5bBQvYKZeU+4KzY7evfAfNxO/dmD2zs61fmik85UypefhbAbsZjvh
C0Uvc6T2RG2Jt/FUA3iDieNvtP0uuDd7QyeeIHwkp1KigkiN+Ttv/9MrtFbaUhpz
q75TV5xDFRnTSex5cYaETrx9yHD26eAwG8daDTL1hyUsC6yad1FiUCQYQ4D+OPa+
UxPHmcjbAgMBAAECggEAQ9rgC7VmUqAtnNoATvJBO+O552GK2HjTwGmtBHg4uTHF
n4nabRNFp3lB3CQrdXBZ1szY0PhELf8xz0x5TieH2ydJNnn3N7DydxERgtCKJNn/
oG5EyNrUZVfGzlK/aJjENX6qNJOOHJ3hCUe6S53hMBWvfKoE52CxbJo9O8t9qwWF
ZPghlOwTD4L2rWjHYWZcfOwcgPbFXfYROYyo97qVjjsYrYyyGVbFuMcsYo8DBT97
BDHOvpS0U0Ve0dS6ZwUsIkF+UPwmp0BoQ/Gnibjsgf9VZcjnO1DgRZcUYr+G/DWy
aAS6V2y3/uaepx/dI7Cd5RBJ0GT9BCXxyproF4GugQKBgQDPTGi4JLdMAxdgHnHv
TlBYYMzohSAvO+4daODRmZnXXwV2c/b5Hz+zCE3ZRRlrgkPecCpAT9LK/r8IZki6
6yW3Lq9nEIIgqgnPCTPY6XquchLwTwcrN2hdY6bi4IEOzIkYpZFdsh+6LyBA5/H5
6KxWOdI9vTNu3pfjMSruce39WwKBgQC1YAoxPJ8dPcOL0uAloks06Xt5kPNhhKth
ETU7NZrJZyqMKNiMgg0ybhnPE+pvZlWPvqVVtLi/fe7vSf0oiP79eQwi2XOYlj9P
qVbYp/1RSdEbqZHHKWw+AuVXo7a17PkjlUB3xAxE66HA+1z70etMjBWGm3cJ82b5
pkmD9Bu6gQKBgGk7e6mHEfmnVBV6PxJhag4DTeH3uqffv3f0hrRASkV3ujkwkz5R
669B1usl1cqqvTNNM1Wkb/iWq3ljGyawOlwseeRTEAvu5b3RCR3jIGEwDYcqRxRc
M0G9Vbm0iC9wC2SUoB+1Tb/hLnlkhYT85Yd8IMswocx1eRtfGVEkStEjAoGBAK7d
rlX0HW/iyXI4WFTQWPPlm18EKjI958FJBupT7yz4YyQIiWdGR5T0Y7urdt36asmQ
w/SSrYAp2UApNINtOXKFzvaWcgWN7fJO0GVH6UoDAjFKVjsPK8XJovXQ6GoT08vD
rQkLIc0c5LGbZvV+WP5PHL3Pi4AzhHdzI/OtWUKBAoGBAMAHYvdEgqs6J9D3Zn6e
eDsvVIo68Qaf8CXQXOzf09boPW6COdmwZC8osqT14EjKCOptsg70AVMSpgngJyrT
9iGJXHuK/3iUl9ntCc3zSS39AtQTG2Rrqou4YMlFIJPhvlrExNZiimgUqfV9PVnu
jJ6Q0e92HvuaV7R03Z7F+kV/
-----END PRIVATE KEY-----`;

process.env.BOG_CLIENT_ID = 'test';
process.env.BOG_SECRET = 'test';
process.env.BOG_SKIP_SIGNATURE_VERIFY = 'false';
process.env.BOG_PUBLIC_KEY = TEST_PUBLIC_KEY;

const { verifyCallbackSignature } = await import('../src/bog/signature.js');

function sign(body) {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(body);
  signer.end();
  return signer.sign(TEST_PRIVATE_KEY, 'base64');
}

test('accepts a valid RSA-SHA256 signature over the raw body', () => {
  const raw = JSON.stringify({ event: 'order_payment', body: { order_id: 'abc', order_status: { key: 'completed' } } });
  const sig = sign(raw);
  assert.equal(verifyCallbackSignature(Buffer.from(raw), sig), true);
});

test('rejects a tampered body', () => {
  const raw = JSON.stringify({ body: { order_id: 'abc' } });
  const sig = sign(raw);
  const tampered = raw.replace('abc', 'xyz');
  assert.equal(verifyCallbackSignature(Buffer.from(tampered), sig), false);
});

test('rejects a missing signature', () => {
  const raw = JSON.stringify({ body: {} });
  assert.equal(verifyCallbackSignature(Buffer.from(raw), ''), false);
});

test('rejects a garbage signature', () => {
  const raw = JSON.stringify({ body: {} });
  assert.equal(verifyCallbackSignature(Buffer.from(raw), 'not-base64-sig'), false);
});

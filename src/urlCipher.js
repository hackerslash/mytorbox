const crypto = require('crypto')

const PREFIX = 'enc:v1:'
const SALT = 'mytorbox:custom-stream:v1'
const INFO = 'custom-stream-url'

function keyFrom(material) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(material)), Buffer.from(SALT), Buffer.from(INFO), 32))
}

function encryptUrl(url, material) {
  if (typeof url !== 'string' || !url) return url
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(material), iv)
  const ciphertext = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()])
  return PREFIX + [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString('base64url')).join('.')
}

function decryptUrl(value, material) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value
  try {
    const parts = value.slice(PREFIX.length).split('.')
    if (parts.length !== 3) return null
    const [iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, 'base64url'))
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(material), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

module.exports = { encryptUrl, decryptUrl, isEncrypted }

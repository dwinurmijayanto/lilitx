import crypto from "crypto";
import fs from "fs";
import path from "path";

// Base32 encode/decode functions
const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = '';
  for (let i = 0; i < buffer.length; i++) {
    bits += buffer[i].toString(2).padStart(8, '0');
  }
  
  let result = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.substr(i, 5).padEnd(5, '0');
    result += base32Alphabet[parseInt(chunk, 2)];
  }
  
  while (result.length % 8 !== 0) {
    result += '=';
  }
  
  return result;
}

function base32Decode(base32) {
  const cleanInput = base32.replace(/=+$/, '');
  let bits = '';
  
  for (let i = 0; i < cleanInput.length; i++) {
    const val = base32Alphabet.indexOf(cleanInput[i]);
    if (val === -1) throw new Error('Invalid Base32 character');
    bits += val.toString(2).padStart(5, '0');
  }
  
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substr(i, 8), 2));
  }
  
  return Buffer.from(bytes);
}

// Generate TOTP code
function generateTOTP(secret, window = 30, digits = 6) {
  const key = base32Decode(secret.toUpperCase().replace(/\s+/g, ''));
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / window);
  
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64BE(BigInt(counter));
  
  const hmac = crypto.createHmac('sha1', key);
  hmac.update(buffer);
  const digest = hmac.digest();
  
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = 
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  
  const divisor = Math.pow(10, digits);
  return (binary % divisor).toString().padStart(digits, '0');
}

// Generate HOTP code (counter-based)
function generateHOTP(secret, counter, digits = 6) {
  const key = base32Decode(secret.toUpperCase().replace(/\s+/g, ''));
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64BE(BigInt(counter));
  
  const hmac = crypto.createHmac('sha1', key);
  hmac.update(buffer);
  const digest = hmac.digest();
  
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = 
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  
  const divisor = Math.pow(10, digits);
  return (binary % divisor).toString().padStart(digits, '0');
}

// Generate Steam Guard code
function generateSteamGuard(secret) {
  const steamAlphabet = '23456789BCDFGHJKMNPQRTVWXY';
  const key = base32Decode(secret.toUpperCase().replace(/\s+/g, ''));
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / 30);
  
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64BE(BigInt(counter));
  
  const hmac = crypto.createHmac('sha1', key);
  hmac.update(buffer);
  const digest = hmac.digest();
  
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = 
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  
  let code = '';
  let remainder = binary;
  for (let i = 0; i < 5; i++) {
    code += steamAlphabet[remainder % steamAlphabet.length];
    remainder = Math.floor(remainder / steamAlphabet.length);
  }
  
  return code;
}

// Get time remaining
function getTimeRemaining(window = 30) {
  const epoch = Math.floor(Date.now() / 1000);
  return window - (epoch % window);
}

// Verify TOTP with time window tolerance
function verifyTOTP(secret, token, window = 30, tolerance = 1) {
  const epoch = Math.floor(Date.now() / 1000);
  const currentCounter = Math.floor(epoch / window);
  
  for (let i = -tolerance; i <= tolerance; i++) {
    const testCounter = currentCounter + i;
    const buffer = Buffer.alloc(8);
    buffer.writeBigInt64BE(BigInt(testCounter));
    
    const key = base32Decode(secret.toUpperCase().replace(/\s+/g, ''));
    const hmac = crypto.createHmac('sha1', key);
    hmac.update(buffer);
    const digest = hmac.digest();
    
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = 
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);
    
    const otp = (binary % 1000000).toString().padStart(6, '0');
    if (otp === token) return true;
  }
  
  return false;
}

// Generate random secret
function generateSecret(length = 16) {
  const buffer = crypto.randomBytes(length);
  return base32Encode(buffer).replace(/=+$/, '');
}

// Generate backup codes
function generateBackupCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(code.match(/.{1,4}/g).join('-'));
  }
  return codes;
}

// Generate QR code URI
function generateQRCodeURI(secret, label, issuer = 'MyApp') {
  const encodedLabel = encodeURIComponent(label);
  const encodedIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${encodedLabel}?secret=${secret}&issuer=${encodedIssuer}`;
}

// Storage management
const dataDir = './data';
const storageFile = path.join(dataDir, '2fa_storage.json');

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadStorage() {
  ensureDataDir();
  if (fs.existsSync(storageFile)) {
    return JSON.parse(fs.readFileSync(storageFile, 'utf8'));
  }
  return {};
}

function saveStorage(data) {
  ensureDataDir();
  fs.writeFileSync(storageFile, JSON.stringify(data, null, 2));
}

function encrypt(text, password) {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(password, 'salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text, password) {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(password, 'salt', 32);
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedText = parts[1];
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Main handler
let handler = async (m, { conn, command, args, usedPrefix = '.' }) => {
  try {
    let text = Array.isArray(args) ? args.join(' ') : '';
    
    if (!text && m.body) {
      const commandPrefix = usedPrefix + command;
      if (m.body.startsWith(commandPrefix)) {
        text = m.body.slice(commandPrefix.length).trim();
      }
    }
    
    const storage = loadStorage();
    const userId = m.sender;
    
    if (!storage[userId]) {
      storage[userId] = { secrets: {}, counters: {} };
    }
    
    // Command: 2fa / totp - Generate TOTP
    if (['2fa', 'totp'].includes(command)) {
      if (!text) {
        return m.reply(`📱 *TOTP Generator*

Usage: ${usedPrefix}2fa [secret|label]

Example:
${usedPrefix}2fa JBSWY3DPEHPK3PXP
${usedPrefix}2fa gmail

💡 Use ${usedPrefix}2fa-list to see saved accounts`);
      }
      
      let secret = text;
      let label = null;
      
      // Check if it's a saved label
      if (storage[userId].secrets[text.toLowerCase()]) {
        label = text.toLowerCase();
        secret = storage[userId].secrets[label];
      }
      
      try {
        const otp = generateTOTP(secret);
        const remaining = getTimeRemaining();
        const labelText = label ? ` (${label})` : '';
        await m.reply(`🔐 *TOTP Code${labelText}*

\`${otp}\`

⏱️ Valid for ${remaining} seconds`);
      } catch (error) {
        await m.reply(`❌ Invalid secret key!`);
      }
    }
    
    // Command: 2fa-generate - Generate random secret
    else if (['2fa-generate', 'generatesecret'].includes(command)) {
      const length = parseInt(text) || 16;
      if (length < 10 || length > 32) {
        return m.reply(`❌ Length must be between 10 and 32`);
      }
      
      const secret = generateSecret(length);
      await m.reply(`🔑 *New Secret Key Generated*

\`${secret}\`

📱 Save this key in your authenticator app
💾 Use ${usedPrefix}2fa-save to store it

🔗 QR Code: ${usedPrefix}2fa-qr ${secret} [label]`);
    }
    
    // Command: 2fa-qr - Generate QR code URI
    else if (['2fa-qr', 'totpqr'].includes(command)) {
      const parts = text.split(' ');
      if (parts.length < 2) {
        return m.reply(`📱 *QR Code Generator*

Usage: ${usedPrefix}2fa-qr [secret] [label] [issuer]

Example:
${usedPrefix}2fa-qr JBSWY3DPEHPK3PXP Gmail
${usedPrefix}2fa-qr JBSWY3DPEHPK3PXP Gmail MyCompany`);
      }
      
      const secret = parts[0];
      const label = parts[1] || 'Account';
      const issuer = parts[2] || 'MyApp';
      
      const uri = generateQRCodeURI(secret, label, issuer);
      await m.reply(`🔗 *QR Code URI*

\`${uri}\`

📱 Use a QR code generator with this URI
or scan directly in your authenticator app`);
    }
    
    // Command: 2fa-backup - Generate backup codes
    else if (['2fa-backup', 'backupcode'].includes(command)) {
      const count = parseInt(text) || 10;
      if (count < 5 || count > 20) {
        return m.reply(`❌ Count must be between 5 and 20`);
      }
      
      const codes = generateBackupCodes(count);
      let message = `🔐 *Backup Recovery Codes*\n\n`;
      codes.forEach((code, i) => {
        message += `${i + 1}. \`${code}\`\n`;
      });
      message += `\n⚠️ Save these codes in a secure place!\n`;
      message += `Each code can only be used once.`;
      
      await m.reply(message);
    }
    
    // Command: 2fa-verify - Verify TOTP code
    else if (['2fa-verify', 'verifytotp'].includes(command)) {
      const parts = text.split(' ');
      if (parts.length < 2) {
        return m.reply(`✅ *TOTP Verifier*

Usage: ${usedPrefix}2fa-verify [secret] [code]

Example:
${usedPrefix}2fa-verify JBSWY3DPEHPK3PXP 123456`);
      }
      
      const secret = parts[0];
      const token = parts[1];
      
      try {
        const isValid = verifyTOTP(secret, token);
        if (isValid) {
          await m.reply(`✅ *Code Valid!*

The TOTP code is correct.`);
        } else {
          await m.reply(`❌ *Code Invalid!*

The TOTP code is incorrect or expired.`);
        }
      } catch (error) {
        await m.reply(`❌ Invalid secret key!`);
      }
    }
    
    // Command: 2fa-save - Save secret with label
    else if (['2fa-save', 'savesecret'].includes(command)) {
      const parts = text.split(' ');
      if (parts.length < 2) {
        return m.reply(`💾 *Save Secret*

Usage: ${usedPrefix}2fa-save [label] [secret]

Example:
${usedPrefix}2fa-save gmail JBSWY3DPEHPK3PXP`);
      }
      
      const label = parts[0].toLowerCase();
      const secret = parts[1];
      
      try {
        // Test if secret is valid
        generateTOTP(secret);
        
        storage[userId].secrets[label] = secret;
        saveStorage(storage);
        
        await m.reply(`✅ *Secret Saved!*

Label: ${label}
Secret: \`${secret}\`

Use ${usedPrefix}2fa ${label} to generate codes`);
      } catch (error) {
        await m.reply(`❌ Invalid secret key!`);
      }
    }
    
    // Command: 2fa-list - List saved secrets
    else if (['2fa-list', 'listsecrets'].includes(command)) {
      const secrets = storage[userId].secrets;
      const labels = Object.keys(secrets);
      
      if (labels.length === 0) {
        return m.reply(`📋 *No Saved Accounts*

Use ${usedPrefix}2fa-save to add accounts`);
      }
      
      let message = `📋 *Saved 2FA Accounts* (${labels.length})\n\n`;
      labels.forEach((label, i) => {
        message += `${i + 1}. ${label}\n`;
      });
      message += `\nUse ${usedPrefix}2fa [label] to generate code`;
      
      await m.reply(message);
    }
    
    // Command: 2fa-delete - Delete saved secret
    else if (['2fa-delete', 'deletesecret'].includes(command)) {
      if (!text) {
        return m.reply(`🗑️ *Delete Secret*

Usage: ${usedPrefix}2fa-delete [label]

Example:
${usedPrefix}2fa-delete gmail`);
      }
      
      const label = text.toLowerCase();
      
      if (!storage[userId].secrets[label]) {
        return m.reply(`❌ Label "${label}" not found`);
      }
      
      delete storage[userId].secrets[label];
      saveStorage(storage);
      
      await m.reply(`✅ Secret "${label}" deleted successfully`);
    }
    
    // Command: 2fa-batch - Generate multiple TOTP
    else if (['2fa-batch', 'totpall'].includes(command)) {
      const secrets = storage[userId].secrets;
      const labels = Object.keys(secrets);
      
      if (labels.length === 0) {
        return m.reply(`📋 *No Saved Accounts*

Use ${usedPrefix}2fa-save to add accounts`);
      }
      
      let message = `🔐 *All TOTP Codes*\n\n`;
      const remaining = getTimeRemaining();
      
      labels.forEach((label) => {
        try {
          const otp = generateTOTP(secrets[label]);
          message += `${label}: \`${otp}\`\n`;
        } catch (error) {
          message += `${label}: ❌ Error\n`;
        }
      });
      
      message += `\n⏱️ Valid for ${remaining} seconds`;
      
      await m.reply(message);
    }
    
    // Command: hotp - Generate HOTP
    else if (command === 'hotp') {
      const parts = text.split(' ');
      if (parts.length < 2) {
        return m.reply(`🔢 *HOTP Generator*

Usage: ${usedPrefix}hotp [secret] [counter]

Example:
${usedPrefix}hotp JBSWY3DPEHPK3PXP 5`);
      }
      
      const secret = parts[0];
      const counter = parseInt(parts[1]);
      
      if (isNaN(counter)) {
        return m.reply(`❌ Counter must be a number`);
      }
      
      try {
        const otp = generateHOTP(secret, counter);
        await m.reply(`🔐 *HOTP Code*

\`${otp}\`

Counter: ${counter}`);
      } catch (error) {
        await m.reply(`❌ Invalid secret key!`);
      }
    }
    
    // Command: steamguard - Generate Steam Guard code
    else if (['steamguard', '2fa-steam'].includes(command)) {
      if (!text) {
        return m.reply(`🎮 *Steam Guard Generator*

Usage: ${usedPrefix}steamguard [secret]

Example:
${usedPrefix}steamguard JBSWY3DPEHPK3PXP`);
      }
      
      try {
        const code = generateSteamGuard(text);
        const remaining = getTimeRemaining();
        await m.reply(`🎮 *Steam Guard Code*

\`${code}\`

⏱️ Valid for ${remaining} seconds`);
      } catch (error) {
        await m.reply(`❌ Invalid secret key!`);
      }
    }
    
    // Command: 2fa-export - Export encrypted backup
    else if (['2fa-export', 'exportconfig'].includes(command)) {
      if (!text) {
        return m.reply(`📤 *Export Configuration*

Usage: ${usedPrefix}2fa-export [password]

Example:
${usedPrefix}2fa-export mySecurePassword123`);
      }
      
      const password = text;
      const data = JSON.stringify(storage[userId]);
      const encrypted = encrypt(data, password);
      
      await m.reply(`📤 *Encrypted Backup*

\`\`\`
${encrypted}
\`\`\`

⚠️ Save this backup securely!
Use ${usedPrefix}2fa-import to restore`);
    }
    
    // Command: 2fa-import - Import encrypted backup
    else if (['2fa-import', 'importconfig'].includes(command)) {
      const parts = text.split(' ');
      if (parts.length < 2) {
        return m.reply(`📥 *Import Configuration*

Usage: ${usedPrefix}2fa-import [encrypted_data] [password]

Example:
${usedPrefix}2fa-import [encrypted_string] mySecurePassword123`);
      }
      
      const encryptedData = parts[0];
      const password = parts.slice(1).join(' ');
      
      try {
        const decrypted = decrypt(encryptedData, password);
        const importedData = JSON.parse(decrypted);
        
        storage[userId] = importedData;
        saveStorage(storage);
        
        const count = Object.keys(importedData.secrets || {}).length;
        await m.reply(`✅ *Import Successful!*

Imported ${count} account(s)
Use ${usedPrefix}2fa-list to view`);
      } catch (error) {
        await m.reply(`❌ Import failed! Wrong password or corrupted data.`);
      }
    }
    
  } catch (e) {
    console.error('2FA Error:', e);
    m.reply(`❌ Error: ${e.message}`);
  }
};

// Handler config
handler.help = [
  "2fa [secret|label] - Generate TOTP code",
  "2fa-generate [length] - Generate random secret",
  "2fa-qr [secret] [label] - Generate QR code URI",
  "2fa-backup [count] - Generate backup codes",
  "2fa-verify [secret] [code] - Verify TOTP code",
  "2fa-save [label] [secret] - Save secret",
  "2fa-list - List saved secrets",
  "2fa-delete [label] - Delete saved secret",
  "2fa-batch - Generate all TOTP codes",
  "hotp [secret] [counter] - Generate HOTP code",
  "steamguard [secret] - Generate Steam Guard code",
  "2fa-export [password] - Export encrypted backup",
  "2fa-import [data] [password] - Import backup"
];

handler.tags = ["tools"];

handler.command = [
  "2fa", "totp",
  "2fa-generate", "generatesecret",
  "2fa-qr", "totpqr",
  "2fa-backup", "backupcode",
  "2fa-verify", "verifytotp",
  "2fa-save", "savesecret",
  "2fa-list", "listsecrets",
  "2fa-delete", "deletesecret",
  "2fa-batch", "totpall",
  "hotp",
  "steamguard", "2fa-steam",
  "2fa-export", "exportconfig",
  "2fa-import", "importconfig"
];

export default handler;

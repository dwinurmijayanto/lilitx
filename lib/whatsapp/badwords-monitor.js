import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

/**
 * BADWORDS MONITORING SYSTEM - MINIMAL LOGS VERSION
 * Hanya log yang penting saja
 */

// ========== FILE PATHS ==========
const DATA_DIR = './data';
const BADWORDS_FILE = path.join(DATA_DIR, 'badwords.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'badwords_settings.json');
const LOGS_DIR = path.join(DATA_DIR, 'badwords_logs');

// ========== ENSURE DIRECTORIES EXIST ==========
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// ========== DEFAULT BADWORDS ==========
const DEFAULT_BADWORDS = [
  'anjing', 'asu', 'babi', 'bajingan', 'bangsat', 'brengsek', 'budek',
  'bego', 'bodoh', 'goblok', 'tolol', 'idiot', 'kampret', 'kontol',
  'memek', 'ngentot', 'pepek', 'puki', 'tai', 'taik', 'jancok',
  'kimak', 'monyet', 'bangke', 'perek', 'pelacur', 'sundal', 'lonte',
  'jablay', 'coli', 'colmek', 'ngocok', 'jembut', 'tempik', 'entot',
  'ewe', 'cukimai', 'cukimay', 'ajg', 'bgst', 'njir', 'njing',
  'fuck', 'shit', 'bitch', 'ass', 'asshole', 'bastard', 'damn',
  'dick', 'pussy', 'cock', 'cunt', 'whore', 'slut', 'nigger',
  'nigga', 'faggot', 'retard', 'motherfucker', 'fck', 'fuk',
  'cangcut', 'pekok', 'mbokne', 'matamu', 'cok', 'setan', 'iblis',
  'a n j i n g', 'a s u', 'k o n t o l', 'n g e n t o t', 'b a j i n g a n',
  'anying', 'anjg', 'anjir', 'asyu', 'kntl', 'mmk', 'pqpq',
];

// ========== LOAD/SAVE BADWORDS ==========
function loadBadwords() {
  try {
    if (!fs.existsSync(BADWORDS_FILE)) {
      const defaultData = {
        words: DEFAULT_BADWORDS,
        lastUpdated: new Date().toISOString(),
        totalWords: DEFAULT_BADWORDS.length
      };
      fs.writeFileSync(BADWORDS_FILE, JSON.stringify(defaultData, null, 2));
      return DEFAULT_BADWORDS;
    }
    
    const fileContent = fs.readFileSync(BADWORDS_FILE, 'utf8');
    const data = JSON.parse(fileContent);
    return data.words || DEFAULT_BADWORDS;
    
  } catch (error) {
    console.error(chalk.red(`[Badwords] Error loading:`, error.message));
    return DEFAULT_BADWORDS;
  }
}

// ========== LOAD/SAVE SETTINGS ==========
function loadSettings(groupId) {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      const defaultSettings = {
        version: '1.0',
        groups: {}
      };
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2));
      return { enabled: true };
    }
    
    const fileContent = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const data = JSON.parse(fileContent);
    
    if (!data.groups) {
      data.groups = {};
    }
    
    if (!data.groups[groupId]) {
      return { enabled: true };
    }
    
    return data.groups[groupId];
    
  } catch (error) {
    return { enabled: true };
  }
}

function saveSettings(groupId, enabled) {
  try {
    let data = {
      version: '1.0',
      groups: {}
    };
    
    if (fs.existsSync(SETTINGS_FILE)) {
      const fileContent = fs.readFileSync(SETTINGS_FILE, 'utf8');
      data = JSON.parse(fileContent);
    }
    
    if (!data.groups) {
      data.groups = {};
    }
    
    data.groups[groupId] = {
      enabled,
      lastUpdated: new Date().toISOString()
    };
    
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
    return true;
    
  } catch (error) {
    console.error(chalk.red(`[Badwords] Error saving settings:`, error.message));
    return false;
  }
}

// ========== LOGGING FUNCTIONS ==========
function logViolation(groupId, sender, detectedWords, originalMessage) {
  try {
    const logFile = path.join(LOGS_DIR, `${groupId.replace(/[^a-zA-Z0-9]/g, '_')}.json`);
    
    let logs = [];
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf8');
      logs = JSON.parse(content);
    }
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      sender,
      detectedWords,
      messagePreview: originalMessage.substring(0, 100),
      action: 'deleted'
    };
    
    logs.unshift(logEntry);
    
    // Keep only last 1000 logs
    if (logs.length > 1000) {
      logs = logs.slice(0, 1000);
    }
    
    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
    
  } catch (error) {
    console.error(chalk.red(`[Badwords] Error logging:`, error.message));
  }
}

// ========== CENSOR WORD ==========
function censorWord(word) {
  if (!word || word.length === 0) return word;
  
  const length = word.length;
  
  if (length === 1) {
    return '*';
  } else if (length === 2) {
    return word[0] + '*';
  } else if (length === 3) {
    return word[0] + '*' + word[2];
  } else if (length === 4) {
    return word[0] + '**' + word[3];
  } else {
    const start = word.substring(0, 1);
    const end = word.substring(length - 1);
    const middle = '*'.repeat(length - 2);
    return start + middle + end;
  }
}

// ========== DETECT BADWORDS ==========
function detectBadwords(text) {
  if (!text || typeof text !== 'string') {
    return {
      found: false,
      words: [],
      cleanText: text
    };
  }
  
  const BADWORDS_LIST = loadBadwords();
  
  const normalizedText = text.toLowerCase()
    .replace(/[_\-@#$%^&*()+=\[\]{};:'",.<>?\\|`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  const foundWords = [];
  
  for (const badword of BADWORDS_LIST) {
    const normalizedBadword = badword.toLowerCase().replace(/\s+/g, '');
    
    const regex = new RegExp(`\\b${normalizedBadword}\\b`, 'gi');
    const matches = normalizedText.match(regex);
    
    if (matches) {
      matches.forEach(match => {
        if (!foundWords.includes(badword)) {
          foundWords.push(badword);
        }
      });
    }
    
    if (normalizedText.includes(normalizedBadword)) {
      if (!foundWords.includes(badword)) {
        foundWords.push(badword);
      }
    }
  }
  
  return {
    found: foundWords.length > 0,
    words: foundWords,
    cleanText: text
  };
}

// ========== CHECK IF USER IS ADMIN ==========
async function isUserAdmin(conn, chatId, userId) {
  try {
    const groupMetadata = await conn.groupMetadata(chatId);
    const participants = groupMetadata.participants;
    const userParticipant = participants.find(p => p.id === userId);
    
    if (userParticipant) {
      const isAdmin = userParticipant.admin === 'admin' || userParticipant.admin === 'superadmin';
      return isAdmin;
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

// ========== PROCESS MESSAGE (MINIMAL LOGS) ==========
async function processMessage(conn, message) {
  try {
    const { key, message: msg, messageTimestamp } = message;
    
    // Skip jika dari bot sendiri
    if (key.fromMe) return;
    
    // Skip jika bukan dari grup
    if (!key.remoteJid?.endsWith('@g.us')) return;
    
    const groupId = key.remoteJid;
    
    // ========== CHECK SETTINGS ==========
    const settings = loadSettings(groupId);
    
    // 🔇 MINIMAL LOG: Skip jika disabled
    if (!settings.enabled) {
      return;
    }
    
    // Extract text dari berbagai tipe message
    let text = null;
    
    if (msg?.conversation) {
      text = msg.conversation;
    } else if (msg?.extendedTextMessage?.text) {
      text = msg.extendedTextMessage.text;
    } else if (msg?.imageMessage?.caption) {
      text = msg.imageMessage.caption;
    } else if (msg?.videoMessage?.caption) {
      text = msg.videoMessage.caption;
    }
    
    // Skip jika tidak ada text
    if (!text || text.trim() === '') return;
    
    // Skip command badwords itu sendiri
    const commands = ['.badwords', '.antibadwords', '.addbadword', '.delbadword', '.listbadword', 
                     '.addbad', '.delbad', '.removebadword', '.listbad', '.badwordlist'];
    if (commands.some(cmd => text.toLowerCase().startsWith(cmd))) return;
    
    const sender = key.participant || key.remoteJid;
    
    // Detect badwords
    const detection = detectBadwords(text);
    
    if (detection.found) {
      // 🔇 MINIMAL LOG: Hanya 1 baris untuk violation
      const senderNum = sender.split('@')[0];
      const wordsList = detection.words.map(w => censorWord(w)).join(', ');
      
      console.log(
        chalk.red('[Badwords] ') +
        chalk.yellow(`⚠️ Detected in ${groupId}: `) +
        chalk.magenta(`@${senderNum}`) +
        chalk.gray(' - ') +
        chalk.white(wordsList)
      );
      
      // Log violation
      logViolation(groupId, sender, detection.words, text);
      
      // Censor kata-kata yang ditemukan
      const censoredWords = detection.words.map(word => censorWord(word));
      
      // Hapus pesan
      try {
        await conn.sendMessage(groupId, { delete: key });
      } catch (deleteError) {
        console.error(chalk.red(`[Badwords] Delete failed:`, deleteError.message));
      }
      
      // Format warning message
      let warningText = `⚠️ *PERINGATAN BADWORDS* ⚠️\n\n`;
      warningText += `@${sender.split('@')[0]}, pesan Anda mengandung kata-kata tidak pantas dan telah dihapus.\n\n`;
      warningText += `📝 *Kata yang terdeteksi:*\n`;
      censoredWords.forEach((word, index) => {
        warningText += `${index + 1}. ${word}\n`;
      });
      warningText += `\n⚠️ Mohon gunakan bahasa yang sopan dan santun dalam grup ini.\n`;
      warningText += `❌ Pelanggaran berulang dapat mengakibatkan dikeluarkan dari grup.`;
      
      // Kirim warning dengan mention
      try {
        await conn.sendMessage(groupId, {
          text: warningText,
          mentions: [sender]
        });
      } catch (sendError) {
        console.error(chalk.red(`[Badwords] Warning send failed:`, sendError.message));
      }
    }
    // 🔇 MINIMAL LOG: Skip "clean message" log
    
  } catch (error) {
    console.error(chalk.red(`[Badwords] Error:`, error.message));
  }
}

// ========== SETUP FUNCTION ==========
export function setupBadwordsMonitor(conn) {
  console.log(chalk.green('[Badwords] 🛡️ Monitor active'));
  
  // Load badwords saat startup
  const wordCount = loadBadwords().length;
  console.log(chalk.gray(`[Badwords] Loaded ${wordCount} words`));
  
  // Listen untuk semua pesan masuk
  conn.ev.on('messages.upsert', async ({ messages }) => {
    for (const message of messages) {
      await processMessage(conn, message);
    }
  });
  
  console.log(chalk.gray('[Badwords] DB: ' + BADWORDS_FILE));
}

// ========== EXPORT HELPER FUNCTIONS ==========
export function getBadwordsCount() {
  return loadBadwords().length;
}

export function getGroupSettings(groupId) {
  return loadSettings(groupId);
}

export function setGroupSettings(groupId, enabled) {
  return saveSettings(groupId, enabled);
}

export function getViolationLogs(groupId, limit = 50) {
  try {
    const logFile = path.join(LOGS_DIR, `${groupId.replace(/[^a-zA-Z0-9]/g, '_')}.json`);
    
    if (!fs.existsSync(logFile)) {
      return [];
    }
    
    const content = fs.readFileSync(logFile, 'utf8');
    const logs = JSON.parse(content);
    
    return logs.slice(0, limit);
    
  } catch (error) {
    console.error(chalk.red(`[Badwords] Error getting logs:`, error.message));
    return [];
  }
}

export default { 
  setupBadwordsMonitor,
  getBadwordsCount,
  getGroupSettings,
  setGroupSettings,
  getViolationLogs
};

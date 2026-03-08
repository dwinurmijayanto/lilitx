const config = {
  // --- PLATFORM SETTING ---
  // Atur ke 'true' untuk mengaktifkan, 'false' untuk menonaktifkan
  enableTelegram: false, // true untuk mengaktifkan bot Telegram
  enableDiscord: false, // true untuk mengaktifkan bot Discord
  enableWhatsApp: true, // true untuk mengaktifkan bot WhatsApp
  enablePuppeteer: false, // ← SET FALSE JIKA TIDAK PERLU PUPPETEER
  
  // --- BOT CONFIG ---
  telegramToken: "", // Token bot Telegram
  discordToken: "", // Token bot Discord
  discordClientId: "", // Client ID bot Discord
  whatsappNumber: "6287874983286", // example: 628123456789
  
  // --- OWNER CONFIG ---
  ownerTelegram: "OWNER_TELEGRAM",
  ownerDiscord: "OWNER_DISCORD",
  ownerWhatsapp: "6282331664567",
  
  // --- BOT SETTING ---
  prefix: ["/", "."],
  ownerName: "Fathur",
  botName: "Lilith Bot's",
  

  // --- PREFIX SETTING ---
  // Set 'true' jika bot HANYA merespon pesan dengan prefix
  // Set 'false' jika bot merespon semua pesan (tanpa perlu prefix)
  requirePrefix: true, // true = wajib pakai prefix, false = respon semua pesan
  useCluster: true,  // Set false untuk disable
};

// Export untuk ES Modules
export default config;
// Juga set ke global jika diperlukan
global.config = config;
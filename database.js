const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'bot_database.db');
const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    first_name TEXT,
    username TEXT,
    phone_number TEXT,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    file_id TEXT,
    text TEXT,
    button_text TEXT,
    link TEXT
  );

  CREATE TABLE IF NOT EXISTS lesson_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    lesson_id INTEGER NOT NULL,
    viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(lesson_id) REFERENCES lessons(id)
  );
`);

// Helper functions for settings
const getSetting = (key, defaultValue = null) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
};

const setSetting = (key, value) => {
  db.prepare(`
    INSERT INTO settings (key, value) 
    VALUES (?, ?) 
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
};

// Migration: Move existing single lesson to the new lessons table
const lessonsCount = db.prepare('SELECT COUNT(*) as count FROM lessons').get().count;
if (lessonsCount === 0) {
    const existingLink = getSetting('lesson_link');
    const existingFileId = getSetting('lesson_image_file_id');
    
    if (existingLink || process.env.LESSON_LINK) {
        db.prepare(`
            INSERT INTO lessons (title, file_id, text, button_text, link) 
            VALUES (?, ?, ?, ?, ?)
        `).run(
            'Asosiy Dars',
            existingFileId || null,
            "Tabriklaymiz! Sizning raqamingiz qabul qilindi.\n\nQuyidagi tugma orqali bepul darsni ko'rishingiz mumkin:",
            "▶️ Darsni ko'rish",
            existingLink || process.env.LESSON_LINK
        );
    }
}

module.exports = {
  db,
  getSetting,
  setSetting
};

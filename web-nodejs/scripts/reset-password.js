#!/usr/bin/env node
/**
 * BetterDesk Console - Password Reset Script
 * Usage: node reset-password.js <new-password> [username]
 * 
 * Resets the password for a user. If username is not provided, defaults to 'admin'.
 * If user doesn't exist, creates a new admin user.
 */

const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.error('Usage: node reset-password.js <new-password> [username]');
        console.error('       node reset-password.js --delete-all');
        process.exit(1);
    }
    
    // Determine data directory
    const dataDir = process.env.DATA_DIR || findDataDir();
    const authDbPath = path.join(dataDir, 'auth.db');
    
    console.log(`Auth database: ${authDbPath}`);
    
    // Open database
    let db;
    try {
        db = new Database(authDbPath, { fileMustExist: false });
        db.pragma('journal_mode = WAL');
    } catch (err) {
        console.error(`Failed to open database: ${err.message}`);
        process.exit(1);
    }
    
    // Ensure users table exists
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'admin',
            created_at TEXT DEFAULT (datetime('now')),
            last_login TEXT
        )
    `);
    
    // Handle --delete-all flag (for fresh install)
    if (args[0] === '--delete-all') {
        const result = db.prepare('DELETE FROM users').run();
        console.log(`Deleted ${result.changes} user(s)`);
        db.close();
        process.exit(0);
    }
    
    const newPassword = args[0];
    const username = args[1] || 'admin';
    
    // Validate password
    if (newPassword.length < 6) {
        console.error('Password must be at least 6 characters');
        process.exit(1);
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    
    // Check if user exists
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    
    if (existingUser) {
        // Update existing user
        db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(passwordHash, username);
        console.log(`Password updated for user: ${username}`);
    } else {
        // Create new user
        db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, passwordHash, 'admin');
        console.log(`Created admin user: ${username}`);
    }
    
    db.close();
    console.log('Done');
    process.exit(0);
}

function findDataDir() {
    const possiblePaths = [
        process.env.RUSTDESK_DATA,
        '/opt/rustdesk',
        '/var/lib/rustdesk',
        'C:\\RustDesk',
        path.join(process.cwd(), 'data')
    ];
    
    const fs = require('fs');
    for (const p of possiblePaths) {
        if (p && fs.existsSync(p)) {
            return p;
        }
    }
    
    // Default to current directory
    return process.cwd();
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});

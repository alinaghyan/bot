const db = require('./database');

async function migrate() {
    try {
        const conn = await db.getConnection();
        console.log('Connected to database...');

        // 1. Create ai_providers table
        await conn.query(`
            CREATE TABLE IF NOT EXISTS ai_providers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                provider_type VARCHAR(50) NOT NULL DEFAULT 'openai', -- openai, avalai, deepseek, custom
                api_key VARCHAR(255) NOT NULL,
                model VARCHAR(100) NOT NULL DEFAULT 'gpt-3.5-turbo',
                base_url VARCHAR(255), -- For custom endpoints or proxies
                is_active BOOLEAN DEFAULT TRUE,
                last_test_status TINYINT(1) NULL DEFAULT NULL,
                last_test_at TIMESTAMP NULL DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
        `);
        console.log('ai_providers table created/verified.');

        // 2. Add ai_provider_id to campaigns if not exists
        const [columns] = await conn.query("SHOW COLUMNS FROM campaigns LIKE 'ai_provider_id'");
        if (columns.length === 0) {
            await conn.query(`
                ALTER TABLE campaigns 
                ADD COLUMN ai_provider_id INT NULL,
                ADD CONSTRAINT fk_campaign_ai_provider 
                FOREIGN KEY (ai_provider_id) REFERENCES ai_providers(id) ON DELETE SET NULL;
            `);
            console.log('ai_provider_id column added to campaigns.');
        } else {
            console.log('ai_provider_id column already exists.');
        }

        // 3. Migrate existing key from settings if ai_providers is empty
        const [providers] = await conn.query('SELECT * FROM ai_providers');
        if (providers.length === 0) {
            const [settings] = await conn.query("SELECT setting_value FROM settings WHERE setting_key = 'openai_api_key'");
            if (settings.length > 0 && settings[0].setting_value) {
                await conn.query(`
                    INSERT INTO ai_providers (name, provider_type, api_key, model) 
                    VALUES ('Default OpenAI', 'openai', ?, 'gpt-3.5-turbo')
                `, [settings[0].setting_value]);
                console.log('Migrated existing OpenAI key to ai_providers.');
            }
        }

        console.log('Migration completed successfully.');
        conn.release();
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();

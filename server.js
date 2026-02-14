const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./database');
const bcrypt = require('bcryptjs');
const puppeteer = require('puppeteer');
const { launchBrowser } = require('./puppeteer-browser');
const logger = require('./logger');
const axios = require('axios');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'secret_key',
    resave: false,
    saveUninitialized: true
}));

app.set('view engine', 'ejs');

app.get('/__version', (req, res) => {
    res.json({
        name: 'bot',
        port: PORT,
        pid: process.pid,
        node: process.version
    });
});

app.get('/__routes', (req, res) => {
    try {
        const router = app.router || app._router;
        const stack = router?.stack || [];
        const routes = [];

        const add = (layer) => {
            if (!layer) return;
            if (layer.route && layer.route.path) {
                const methods = Object.keys(layer.route.methods || {})
                    .filter((m) => layer.route.methods[m])
                    .map((m) => m.toUpperCase())
                    .sort();
                routes.push({ path: layer.route.path, methods });
                return;
            }
            if (layer.name === 'router' && layer.handle?.stack) {
                for (const l of layer.handle.stack) add(l);
            }
        };

        for (const layer of stack) add(layer);

        routes.sort((a, b) => String(a.path).localeCompare(String(b.path), 'fa'));
        res.json({ pid: process.pid, count: routes.length, routes });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', reason);
});

process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', err);
});

// Auth Middleware
const requireLogin = (req, res, next) => {
    if (!req.session.userId) {
        const wantsJson =
            String(req.originalUrl || '').startsWith('/api/') ||
            (req.headers.accept && String(req.headers.accept).includes('application/json')) ||
            req.xhr;
        if (wantsJson) return res.status(401).json({ success: false, message: 'Unauthorized' });
        return res.redirect('/login');
    }
    next();
};

function normalizeBaseHost(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    let v = raw.replace(/^https?:\/\//i, '');
    v = v.replace(/\/+$/g, '');
    return v;
}

function normalizeApiBaseUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    let v = raw.replace(/\/+$/g, '');
    if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
    return v;
}

async function ensureNetworksTable() {
    const [tables] = await db.query("SHOW TABLES LIKE 'networks'");
    if (tables.length === 0) {
        await db.query(`
            CREATE TABLE networks (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                base_url VARCHAR(255) NOT NULL,
                api_base_url VARCHAR(255) NULL,
                is_active TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }
    const [[cnt]] = await db.query('SELECT COUNT(*) as c FROM networks');
    if ((cnt?.c || 0) === 0) {
        await db.query('INSERT INTO networks (name, base_url, api_base_url, is_active) VALUES (?,?,?,?)', [
            'ایتا',
            'web.eitaa.com',
            null,
            1
        ]);
    }
}

// Routes

// Login
app.get('/login', (req, res) => {
    if (req.session.userId) return res.redirect('/');
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length > 0) {
            const user = rows[0];
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                req.session.userId = user.id;
                req.session.username = user.username;
                return res.redirect('/');
            }
        }
        res.render('login', { error: 'نام کاربری یا رمز عبور اشتباه است' });
    } catch (err) {
        console.error(err);
        res.render('login', { error: 'خطای سرور' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/networks', requireLogin, async (req, res) => {
    try {
        await ensureNetworksTable();
        const [networks] = await db.query('SELECT * FROM networks ORDER BY id DESC');
        res.render('networks', { user: req.session.username, networks });
    } catch (err) {
        logger.error('Networks page error', err, { user: req.session?.username || null });
        res.status(500).send('Server Error');
    }
});

app.post('/networks/save', requireLogin, async (req, res) => {
    const { id } = req.body;
    const name = String(req.body.name || '').trim();
    const base_url = normalizeBaseHost(req.body.base_url);
    const api_base_url = normalizeApiBaseUrl(req.body.api_base_url);
    const is_active = req.body.is_active ? 1 : 0;

    if (!name) return res.status(400).send('نام شبکه الزامی است.');
    if (!base_url) return res.status(400).send('آدرس شبکه الزامی است.');

    try {
        await ensureNetworksTable();
        if (id) {
            await db.query(
                'UPDATE networks SET name=?, base_url=?, api_base_url=?, is_active=? WHERE id=?',
                [name, base_url, api_base_url, is_active, id]
            );
        } else {
            await db.query('INSERT INTO networks (name, base_url, api_base_url, is_active) VALUES (?,?,?,?)', [
                name,
                base_url,
                api_base_url,
                is_active
            ]);
        }
        res.redirect('/networks');
    } catch (err) {
        logger.error('Networks save error', err, { user: req.session?.username || null });
        res.status(500).send('Server Error');
    }
});

app.post('/api/networks/delete', requireLogin, async (req, res) => {
    const id = Number(req.body?.id);
    if (!Number.isFinite(id) || id <= 0) return res.json({ success: false, message: 'id نامعتبر است.' });
    try {
        await ensureNetworksTable();
        await db.query('DELETE FROM networks WHERE id=?', [id]);
        res.json({ success: true });
    } catch (err) {
        logger.error('Networks delete error', err, { id, user: req.session?.username || null });
        res.json({ success: false, message: err.message });
    }
});

app.post('/api/networks/toggle', requireLogin, async (req, res) => {
    const id = Number(req.body?.id);
    const is_active = req.body?.is_active ? 1 : 0;
    if (!Number.isFinite(id) || id <= 0) return res.json({ success: false, message: 'id نامعتبر است.' });
    try {
        await ensureNetworksTable();
        await db.query('UPDATE networks SET is_active=? WHERE id=?', [is_active, id]);
        res.json({ success: true });
    } catch (err) {
        logger.error('Networks toggle error', err, { id, user: req.session?.username || null });
        res.json({ success: false, message: err.message });
    }
});

app.post('/api/networks/test', requireLogin, async (req, res) => {
    const base_url = normalizeBaseHost(req.body?.base_url);
    if (!base_url) return res.json({ success: false, message: 'آدرس شبکه نامعتبر است.' });
    const url = `https://${base_url}`;
    try {
        await ensureNetworksTable();
        const r = await axios.get(url, { timeout: 15000, maxRedirects: 5, validateStatus: () => true });
        res.json({ success: true, url, status: r.status });
    } catch (err) {
        logger.error('Networks test error', err, { url, user: req.session?.username || null });
        res.json({ success: false, message: err.message, url });
    }
});

// Dashboard
app.get('/', requireLogin, async (req, res) => {
    try {
        const [campaigns] = await db.query('SELECT * FROM campaigns ORDER BY created_at DESC');
        res.render('dashboard', { user: req.session.username, campaigns });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Create Campaign
app.get('/campaign/create', requireLogin, async (req, res) => {
    try {
        const [providers] = await db.query('SELECT * FROM ai_providers WHERE is_active = 1');
        await ensureNetworksTable();
        const [networks] = await db.query('SELECT * FROM networks WHERE is_active = 1 ORDER BY id DESC');
        res.render('create_campaign', { user: req.session.username, providers, networks });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.post('/campaign/create', requireLogin, async (req, res) => {
    const { title, start_date, end_date, frequency, network, keywords, ai_provider_id, per_channel_limit, max_channels } = req.body;
    const conn = await db.getConnection();
    try {
        // start_date and end_date are expected to be timestamps (ms) or ISO strings from frontend
        // If they are timestamps as strings, convert to int
        const start = isNaN(start_date) ? new Date(start_date) : new Date(parseInt(start_date));
        const end = end_date ? (isNaN(end_date) ? new Date(end_date) : new Date(parseInt(end_date))) : null;

        await conn.beginTransaction();
        const [result] = await conn.query(
            'INSERT INTO campaigns (title, start_date, end_date, frequency, per_channel_limit, max_channels, network, ai_provider_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                title,
                start,
                end,
                frequency,
                Math.max(1, Math.min(50, Number(per_channel_limit) || 3)),
                Math.max(1, Math.min(200, Number(max_channels) || 20)),
                network,
                ai_provider_id,
                'inactive'
            ]
        );
        const campaignId = result.insertId;
        
        const keywordList = JSON.parse(keywords);
        if (keywordList && keywordList.length > 0) {
            const values = keywordList.map(k => [campaignId, k]);
            await conn.query('INSERT INTO keywords (campaign_id, keyword) VALUES ?', [values]);
        }
        
        await conn.commit();
        res.json({ success: true, campaignId });
    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.json({ success: false, message: err.message });
    } finally {
        conn.release();
    }
});

let connectionBrowser = null;
const profileDir = path.join(__dirname, 'chrome_profile');

// Test Connection API
app.post('/api/test-connection', requireLogin, async (req, res) => {
    const { network } = req.body;
    if (!network) return res.json({ success: false, message: 'Network required' });

    try {
        if (!connectionBrowser) {
            connectionBrowser = await launchBrowser({
                userDataDir: profileDir,
                browser: 'chrome'
            });

            connectionBrowser.on('disconnected', () => {
                connectionBrowser = null;
            });
        }

        const page = await connectionBrowser.newPage();
        try {
            await page.setCacheEnabled(false);
            const client = await page.target().createCDPSession();
            await client.send('Network.enable');
            await client.send('Network.setCacheDisabled', { cacheDisabled: true });
            await client.send('Network.clearBrowserCache');
        } catch {}
        await page.goto(`https://${network}`, { waitUntil: 'domcontentloaded' });
        try {
            await page.bringToFront();
        } catch {}

        const loggedIn = await page.evaluate(() => {
            const hasPhoneInput = !!document.querySelector("input[type='tel'], input[name='phone'], input[type='number']");
            const hasChatList = !!document.querySelector('.chat-list, .sidebar-header, .chat-list-container, [class*=\"chat-list\"], [class*=\"ChatList\"]');
            const hasSearch = !!document.querySelector('i.icon-search, input.form-control, input[type=\"search\"], [placeholder*=\"جست\"], [placeholder*=\"search\"]');
            if (hasPhoneInput) return false;
            if (hasChatList || hasSearch) return true;
            return false;
        });

        res.json({
            success: true,
            loggedIn,
            message: loggedIn
                ? 'اتصال برقرار است و لاگین انجام شده.'
                : 'یک تب جدید باز شد. لطفاً در تب باز شده لاگین کنید و دوباره تست را بزنید.'
        });

        setTimeout(() => {
            try { page.close(); } catch {}
        }, loggedIn ? 30_000 : 10 * 60_000);
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: err.message });
    }
});

// Edit Campaign
app.get('/campaign/:id/edit', requireLogin, async (req, res) => {
    const { id } = req.params;
    try {
        const [campaigns] = await db.query('SELECT * FROM campaigns WHERE id = ?', [id]);
        if (campaigns.length === 0) return res.status(404).send('Campaign not found');

        const [keywords] = await db.query('SELECT keyword FROM keywords WHERE campaign_id = ?', [id]);
        const keywordList = keywords.map(k => k.keyword).filter(Boolean);

        const [providers] = await db.query('SELECT * FROM ai_providers WHERE is_active = 1');
        await ensureNetworksTable();
        const [networks] = await db.query('SELECT * FROM networks WHERE is_active = 1 ORDER BY id DESC');
        res.render('create_campaign', { user: req.session.username, providers, networks, campaign: campaigns[0], keywords: keywordList });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.post('/campaign/:id/edit', requireLogin, async (req, res) => {
    const { id } = req.params;
    const { title, start_date, end_date, frequency, network, keywords, ai_provider_id, per_channel_limit, max_channels } = req.body;
    const conn = await db.getConnection();
    try {
        const start = isNaN(start_date) ? new Date(start_date) : new Date(parseInt(start_date));
        const end = end_date ? (isNaN(end_date) ? new Date(end_date) : new Date(parseInt(end_date))) : null;

        await conn.beginTransaction();
        await conn.query(
            'UPDATE campaigns SET title = ?, start_date = ?, end_date = ?, frequency = ?, per_channel_limit = ?, max_channels = ?, network = ?, ai_provider_id = ? WHERE id = ?',
            [
                title,
                start,
                end,
                frequency,
                Math.max(1, Math.min(50, Number(per_channel_limit) || 3)),
                Math.max(1, Math.min(200, Number(max_channels) || 20)),
                network,
                ai_provider_id,
                id
            ]
        );

        await conn.query('DELETE FROM keywords WHERE campaign_id = ?', [id]);
        const keywordList = JSON.parse(keywords || '[]');
        if (keywordList && keywordList.length > 0) {
            const values = keywordList.map(k => [id, k]);
            await conn.query('INSERT INTO keywords (campaign_id, keyword) VALUES ?', [values]);
        }

        await conn.commit();
        res.json({ success: true });
    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.json({ success: false, message: err.message });
    } finally {
        conn.release();
    }
});

const botEngine = require('./bot-engine');

async function ensureSchema() {
    try {
        const [cols] = await db.query("SHOW COLUMNS FROM results LIKE 'keyword'");
        if (cols.length === 0) {
            await db.query("ALTER TABLE results ADD COLUMN keyword VARCHAR(255) NULL AFTER campaign_id");
        }

        const [c1] = await db.query("SHOW COLUMNS FROM campaigns LIKE 'per_channel_limit'");
        if (c1.length === 0) {
            await db.query("ALTER TABLE campaigns ADD COLUMN per_channel_limit INT NULL DEFAULT 3 AFTER frequency");
        }
        const [c2] = await db.query("SHOW COLUMNS FROM campaigns LIKE 'max_channels'");
        if (c2.length === 0) {
            await db.query("ALTER TABLE campaigns ADD COLUMN max_channels INT NULL DEFAULT 20 AFTER per_channel_limit");
        }

        await ensureNetworksTable();
    } catch (e) {
        logger.error('Schema ensure failed', e);
    }
}

async function resumeActiveCampaigns() {
    try {
        const [rows] = await db.query("SELECT id FROM campaigns WHERE status = 'active'");
        for (const r of rows) {
            try {
                botEngine.startCampaign(r.id);
            } catch (e) {
                console.error('Failed to resume campaign', r.id, e?.message || e);
            }
        }
        if (rows.length > 0) {
            console.log(`Resumed ${rows.length} active campaign(s).`);
        }
    } catch (e) {
        console.error('Failed to resume active campaigns:', e?.message || e);
    }
}

// Start Bot API
app.post('/api/start-bot', requireLogin, async (req, res) => {
    const { id } = req.body;
    if (!id) return res.json({ success: false, message: 'Campaign ID required' });

    try {
        await db.query("UPDATE campaigns SET status = 'active' WHERE id = ?", [id]);
        botEngine.startCampaign(id);
        res.json({ success: true, message: 'ربات با موفقیت شروع به کار کرد.' });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// Stop Bot API
app.post('/api/stop-bot', requireLogin, async (req, res) => {
    const { id } = req.body;
    try {
        await db.query("UPDATE campaigns SET status = 'stopped' WHERE id = ?", [id]);
        res.json({ success: true, message: 'کمپین متوقف شد (در اجرای بعدی اجرا نخواهد شد).' });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// Delete Campaign API
app.post('/api/delete-campaign', requireLogin, async (req, res) => {
    const { id } = req.body;
    try {
        await db.query("DELETE FROM campaigns WHERE id = ?", [id]);
        res.json({ success: true, message: 'کمپین با موفقیت حذف شد.' });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

app.get('/report/:id', requireLogin, async (req, res) => {
    const { id } = req.params;
    try {
        const [campaigns] = await db.query('SELECT * FROM campaigns WHERE id = ?', [id]);
        if (campaigns.length === 0) return res.status(404).send('Campaign not found');
        
        const [results] = await db.query('SELECT * FROM results WHERE campaign_id = ? ORDER BY checked_at DESC', [id]);

        const [keywordChannelRows] = await db.query(
            `
            SELECT 
                keyword,
                channel_id,
                MAX(channel_name) AS channel_name,
                COUNT(*) AS cnt
            FROM results
            WHERE campaign_id = ?
            GROUP BY keyword, channel_id
            ORDER BY keyword ASC, cnt DESC
            `,
            [id]
        );

        const [channelTotalsRows] = await db.query(
            `
            SELECT
                channel_id,
                MAX(channel_name) AS channel_name,
                COUNT(*) AS cnt
            FROM results
            WHERE campaign_id = ?
            GROUP BY channel_id
            ORDER BY cnt DESC
            `,
            [id]
        );

        const keywordTotalsMap = new Map();
        for (const r of keywordChannelRows) {
            const kw = r.keyword || '(بدون کلمه کلیدی)';
            const prev = keywordTotalsMap.get(kw) || { keyword: kw, total: 0, channels: 0 };
            prev.total += Number(r.cnt || 0);
            prev.channels += 1;
            keywordTotalsMap.set(kw, prev);
        }
        const keywordTotals = Array.from(keywordTotalsMap.values()).sort((a, b) => b.total - a.total);
        
        // Calculate stats
        const stats = { approve: 0, reject: 0, 'not related': 0 };
        results.forEach(r => {
            if (stats[r.analysis_result] !== undefined) stats[r.analysis_result]++;
        });

        res.render('report', { user: req.session.username, campaign: campaigns[0], results, stats, keywordTotals, keywordChannelRows, channelTotalsRows });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.post('/api/results/delete', requireLogin, async (req, res) => {
    const { campaign_id, ids } = req.body || {};
    const campaignId = Number(campaign_id);
    const idList = Array.isArray(ids) ? ids.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0) : [];

    if (!Number.isFinite(campaignId) || campaignId <= 0) {
        return res.json({ success: false, message: 'campaign_id نامعتبر است.' });
    }
    if (idList.length === 0) {
        return res.json({ success: false, message: 'هیچ موردی برای حذف انتخاب نشده است.' });
    }
    if (idList.length > 500) {
        return res.json({ success: false, message: 'تعداد آیتم‌های انتخاب شده زیاد است.' });
    }

    try {
        const [result] = await db.query('DELETE FROM results WHERE campaign_id = ? AND id IN (?)', [campaignId, idList]);
        logger.info('results deleted', { campaignId, requested: idList.length, deleted: result.affectedRows || 0, user: req.session?.username || null });
        res.json({ success: true, deleted: result.affectedRows || 0 });
    } catch (err) {
        logger.error('results delete error', err, { campaignId, requested: idList.length, user: req.session?.username || null });
        res.json({ success: false, message: err.message });
    }
});

app.get('/logs', requireLogin, async (req, res) => {
    const limit = Number(req.query.limit) || 300;
    res.render('logs', { user: req.session.username, entries: logger.getEntries(limit), logFile: logger.logFile });
});

app.post('/api/logs/clear', requireLogin, async (req, res) => {
    try {
        logger.clear();
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// Settings Route
app.use('/', require('./routes/settings'));

app.use((err, req, res, next) => {
    logger.error('express', err, { url: req.originalUrl, method: req.method, user: req.session?.username || null });
    res.status(500).send('Server Error');
});

const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    ensureSchema();
    resumeActiveCampaigns();
});

server.on('error', (err) => {
    console.error('Failed to start server:', err?.message || err);
    process.exit(1);
});

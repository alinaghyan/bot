const express = require('express');
const router = express.Router();
const db = require('../database');
const axios = require('axios');
const logger = require('../logger');

// Get Settings Page
router.get('/settings', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const [providers] = await db.query("SELECT * FROM ai_providers ORDER BY created_at DESC");
        res.render('settings', { user: req.session.username, providers });
    } catch (err) {
        logger.error('Settings page error', err, { user: req.session?.username || null });
        res.status(500).send('Server Error');
    }
});

// Add/Edit Provider
router.post('/settings/provider', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    let { id, name, provider_type, api_key, model, base_url } = req.body;

    if ((!base_url || !String(base_url).trim()) && api_key && String(api_key).trim().toLowerCase().startsWith('aa-')) {
        base_url = 'https://api.avalai.ir/v1';
    }
    if ((!model || !String(model).trim() || String(model).trim() === 'gpt-3.5-turbo') && api_key && String(api_key).trim().toLowerCase().startsWith('aa-')) {
        model = 'gpt-4o';
    }
    
    try {
        if (id) {
            if (api_key && api_key.trim()) {
                await db.query(
                    "UPDATE ai_providers SET name=?, provider_type=?, api_key=?, model=?, base_url=? WHERE id=?",
                    [name, provider_type, api_key, model, base_url || null, id]
                );
            } else {
                await db.query(
                    "UPDATE ai_providers SET name=?, provider_type=?, model=?, base_url=? WHERE id=?",
                    [name, provider_type, model, base_url || null, id]
                );
            }
        } else {
            // Insert
            await db.query(
                "INSERT INTO ai_providers (name, provider_type, api_key, model, base_url) VALUES (?, ?, ?, ?, ?)",
                [name, provider_type, api_key, model, base_url || null]
            );
        }
        res.redirect('/settings');
    } catch (err) {
        logger.error('Provider save error', err, { user: req.session?.username || null });
        res.status(500).send('Server Error');
    }
});

// Delete Provider
router.post('/settings/provider/delete', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const { id } = req.body;
    try {
        await db.query("DELETE FROM ai_providers WHERE id = ?", [id]);
        res.redirect('/settings');
    } catch (err) {
        logger.error('Provider delete error', err, { user: req.session?.username || null });
        res.status(500).send('Server Error');
    }
});

// Test AI Connection
router.post('/api/test-ai', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { provider_id, provider_type, api_key, model, base_url } = req.body;

    try {
        const buildChatCompletionsUrl = (baseUrl, apiKey) => {
            if (!baseUrl) {
                if (apiKey && String(apiKey).trim().toLowerCase().startsWith('aa-')) {
                    baseUrl = 'https://api.avalai.ir/v1';
                } else {
                    return 'https://api.openai.com/v1/chat/completions';
                }
            }
            let u = String(baseUrl).trim();
            if (!u) return 'https://api.openai.com/v1/chat/completions';
            if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
            u = u.replace(/\/+$/, '');
            if (/\/chat\/completions$/i.test(u)) return u;
            if (!/\/v1$/i.test(u)) u = `${u}/v1`;
            return `${u}/chat/completions`;
        };

        let effectiveProviderType = provider_type;
        let effectiveApiKey = api_key;
        let effectiveModel = model;
        let effectiveBaseUrl = base_url;

        if (provider_id) {
            const [rows] = await db.query('SELECT * FROM ai_providers WHERE id = ?', [provider_id]);
            if (rows.length === 0) {
                return res.json({ success: false, message: 'سرویس مورد نظر یافت نشد.' });
            }
            effectiveProviderType = rows[0].provider_type;
            effectiveApiKey = rows[0].api_key;
            effectiveModel = rows[0].model;
            effectiveBaseUrl = rows[0].base_url;
        }

        if (!effectiveApiKey) {
            return res.json({ success: false, message: 'API Key تنظیم نشده است.' });
        }

        let response;
        let requestUrl;
        let requestModel;
        if (effectiveProviderType === 'openai') {
            requestUrl = buildChatCompletionsUrl(effectiveBaseUrl, effectiveApiKey);
            requestModel = effectiveModel || "gpt-3.5-turbo";
            response = await axios.post(requestUrl, {
                model: requestModel,
                messages: [{ role: "user", content: "Say Hello!" }],
                max_tokens: 5
            }, {
                headers: {
                    'Authorization': `Bearer ${effectiveApiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });
        } else {
            // Generic/Other handler (assuming OpenAI compatible for now as most are)
             requestUrl = buildChatCompletionsUrl(effectiveBaseUrl, effectiveApiKey);
             requestModel = effectiveModel;
             response = await axios.post(requestUrl, {
                model: requestModel,
                messages: [{ role: "user", content: "Say Hello!" }]
            }, {
                headers: {
                    'Authorization': `Bearer ${effectiveApiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });
        }

        if (response.status === 200) {
            const sample = response?.data?.choices?.[0]?.message?.content || '';
            res.json({
                success: true,
                message: 'اتصال با موفقیت برقرار شد!',
                endpoint: requestUrl,
                model: requestModel,
                sample
            });
        } else {
            res.json({ success: false, message: `خطا در اتصال: ${response.status}`, endpoint: requestUrl, model: requestModel });
        }
    } catch (error) {
        logger.error('AI Test Error', error, { provider_id: provider_id || null, provider_type: provider_type || null });
        res.json({ success: false, message: `خطا: ${error.message}` });
    }
});

module.exports = router;

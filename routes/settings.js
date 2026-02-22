const express = require('express');
const router = express.Router();
const db = require('../database');
const axios = require('axios');
const logger = require('../logger');
const { normalizeProviderInput, buildChatCompletionsUrl } = require('../ai-provider-utils');

// Get Settings Page
router.get('/settings', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const [providers] = await db.query('SELECT * FROM ai_providers ORDER BY created_at DESC');
        res.render('settings', { user: req.session.username, providers });
    } catch (err) {
        logger.error('Settings page error', err, { user: req.session?.username || null });
        res.status(500).send('Server Error');
    }
});

// Add/Edit Provider
router.post('/settings/provider', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const id = Number(req.body?.id);

    const normalized = normalizeProviderInput(req.body, { allowEmptyKey: Number.isFinite(id) && id > 0 });
    if (!normalized.ok) {
        return res.status(400).send(normalized.message);
    }

    const { name, provider_type, api_key, model, base_url } = normalized.value;

    try {
        if (Number.isFinite(id) && id > 0) {
            if (api_key) {
                await db.query(
                    'UPDATE ai_providers SET name=?, provider_type=?, api_key=?, model=?, base_url=? WHERE id=?',
                    [name, provider_type, api_key, model, base_url, id]
                );
            } else {
                await db.query(
                    'UPDATE ai_providers SET name=?, provider_type=?, model=?, base_url=? WHERE id=?',
                    [name, provider_type, model, base_url, id]
                );
            }
        } else {
            await db.query(
                'INSERT INTO ai_providers (name, provider_type, api_key, model, base_url) VALUES (?, ?, ?, ?, ?)',
                [name, provider_type, api_key, model, base_url]
            );
        }
        if (typeof global.invalidateAIHeaderCache === 'function') global.invalidateAIHeaderCache();
        res.redirect('/settings');
    } catch (err) {
        logger.error('Provider save error', err, { user: req.session?.username || null });
        res.status(500).send('Server Error');
    }
});

// Delete Provider
router.post('/settings/provider/delete', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const id = Number(req.body?.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Invalid provider id');

    try {
        await db.query('DELETE FROM ai_providers WHERE id = ?', [id]);
        if (typeof global.invalidateAIHeaderCache === 'function') global.invalidateAIHeaderCache();
        res.redirect('/settings');
    } catch (err) {
        logger.error('Provider delete error', err, { user: req.session?.username || null, id });
        res.status(500).send('Server Error');
    }
});

// Test AI Connection
router.post('/api/test-ai', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const providerId = Number(req.body?.provider_id);

    try {
        let provider = null;

        if (Number.isFinite(providerId) && providerId > 0) {
            const [rows] = await db.query('SELECT * FROM ai_providers WHERE id = ?', [providerId]);
            if (rows.length === 0) {
                return res.json({ success: false, message: 'سرویس مورد نظر یافت نشد.' });
            }
            provider = rows[0];
        } else {
            const normalized = normalizeProviderInput(req.body, { allowEmptyKey: false });
            if (!normalized.ok) {
                return res.json({ success: false, message: normalized.message });
            }
            provider = normalized.value;
        }

        if (!provider?.api_key) {
            return res.json({ success: false, message: 'API Key تنظیم نشده است.' });
        }

        const requestUrl = buildChatCompletionsUrl(provider.base_url, provider);
        const requestModel = String(provider.model || '').trim() || 'gpt-4o';

        const response = await axios.post(
            requestUrl,
            {
                model: requestModel,
                messages: [{ role: 'user', content: 'Say Hello!' }],
                max_tokens: 12,
                temperature: 0
            },
            {
                headers: {
                    Authorization: `Bearer ${provider.api_key}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );

        if (response.status === 200) {
            if (Number.isFinite(providerId) && providerId > 0) {
                try {
                    await db.query('UPDATE ai_providers SET last_test_status = 1, last_test_at = NOW() WHERE id = ?', [providerId]);
                } catch {}
            }
            if (typeof global.invalidateAIHeaderCache === 'function') global.invalidateAIHeaderCache();
            const sample = response?.data?.choices?.[0]?.message?.content || '';
            return res.json({
                success: true,
                message: 'اتصال با موفقیت برقرار شد!',
                endpoint: requestUrl,
                model: requestModel,
                sample
            });
        }

        return res.json({
            success: false,
            message: `خطا در اتصال: ${response.status}`,
            endpoint: requestUrl,
            model: requestModel
        });
    } catch (error) {
        if (Number.isFinite(providerId) && providerId > 0) {
            try {
                await db.query('UPDATE ai_providers SET last_test_status = 0, last_test_at = NOW() WHERE id = ?', [providerId]);
            } catch {}
        }
        if (typeof global.invalidateAIHeaderCache === 'function') global.invalidateAIHeaderCache();
        logger.error('AI Test Error', error, { provider_id: providerId || null });
        return res.json({ success: false, message: `خطا: ${error.message}` });
    }
});

module.exports = router;

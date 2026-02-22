const db = require('./database');
const axios = require('axios');
const stringSimilarity = require('string-similarity');
const path = require('path');
const { launchBrowser } = require('./puppeteer-browser');
const logger = require('./logger');
const { buildChatCompletionsUrl } = require('./ai-provider-utils');

const runningCampaigns = new Set();
const profileDir = path.join(__dirname, 'chrome_profile');
const DEBUG_AI = ['1', 'true', 'yes', 'on'].includes(String(process.env.DEBUG_AI || '').trim().toLowerCase());
const DEBUG_SCRAPE = ['1', 'true', 'yes', 'on'].includes(String(process.env.DEBUG_SCRAPE || '').trim().toLowerCase());

function safeStringify(value) {
    try {
        return JSON.stringify(
            value,
            (k, v) => {
                const key = String(k || '').toLowerCase();
                if (key.includes('authorization')) return '[REDACTED]';
                if (key.includes('api_key') || key.includes('apikey') || key === 'key') return '[REDACTED]';
                return v;
            },
            2
        );
    } catch {
        try {
            return String(value);
        } catch {
            return '[unserializable]';
        }
    }
}

function truncateText(s, maxLen) {
    const str = String(s ?? '');
    if (str.length <= maxLen) return str;
    return `${str.slice(0, Math.max(0, maxLen))}…(truncated, len=${str.length})`;
}

function normalizeMatchText(s) {
    return String(s ?? '')
        .replace(/\u200c/g, '')
        .replace(/[ي]/g, 'ی')
        .replace(/[ك]/g, 'ک')
        .replace(/\s+/g, ' ')
        .trim();
}

async function getAIProvider(campaignId) {
    // 1. Try to get provider assigned to campaign
    const [rows] = await db.query(`
        SELECT p.* FROM campaigns c 
        JOIN ai_providers p ON c.ai_provider_id = p.id 
        WHERE c.id = ?
    `, [campaignId]);
    
    if (rows.length > 0) return rows[0];

    // 2. Fallback to first active provider
    const [defaults] = await db.query("SELECT * FROM ai_providers WHERE is_active = 1 LIMIT 1");
    return defaults.length > 0 ? defaults[0] : null;
}

async function analyzeWithAI(text, keyword, url, provider) {
    if (!provider) return { analyse_result: 'pending', analyse_score: 0 };

    const systemMsg =
        'You are a strict JSON-only classifier. Return only valid JSON with keys analyse_result and analyse_score.';

    const prompt = `متن زیر را نسبت به «کلمه کلیدی» تحلیل کن و فقط یکی از سه خروجی زیر را برگردان:
1) approve = متن مرتبط است و نسبت به موضوع/کلمه کلیدی مثبت، تاییدکننده یا در جهت حمایت است (اگر خنثی ولی کاملاً مرتبط بود، approve بده)
2) reject = متن مرتبط است اما مخالف/نقادانه/منفی نسبت به موضوع/کلمه کلیدی است
3) not related = متن نامرتبط است یا فقط اشاره گذرا و بی‌اهمیت دارد

کلمه کلیدی: «${keyword}»
لینک: «${url}»
متن: «${text}»

امتیاز:
- عدد 10 خنثی است
- شدیدترین تایید = 20
- شدیدترین مخالفت = 0
- اگر not related است، امتیاز را 10 بده مگر اینکه متن کاملاً بی‌ربط باشد (در این صورت 9 تا 11 قابل قبول است)

فقط JSON خالص برگردان با این کلیدها:
{"analyse_result":"approve|reject|not related","analyse_score":0-20}`;

    const clampScore = (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(20, Math.round(n)));
    };

    const normalizeResult = (v) => {
        const s = String(v || '').trim().toLowerCase();
        if (s === 'approve') return 'approve';
        if (s === 'reject') return 'reject';
        if (s === 'not related' || s === 'not_related' || s === 'not-related') return 'not related';
        return 'error';
    };

    const safeParse = (content) => {
        if (!content) return { analyse_result: 'error', analyse_score: 0 };
        const cleaned = String(content).replace(/```json|```/g, '').trim();
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        const jsonText = firstBrace >= 0 && lastBrace >= 0 ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;
        try {
            const obj = JSON.parse(jsonText);
            const result = obj.analyse_result ?? obj.analyze_result ?? obj.analysis_result ?? obj.result;
            const score = obj.analyse_score ?? obj.analyze_score ?? obj.analysis_score ?? obj.score;
            return { analyse_result: normalizeResult(result), analyse_score: clampScore(score) };
        } catch {
            return { analyse_result: 'error', analyse_score: 0 };
        }
    };

    try {
        const apiUrl = buildChatCompletionsUrl(provider.base_url, provider);

        const payload = {
            model: provider.model || "gpt-3.5-turbo",
            messages: [
                { role: "system", content: systemMsg },
                { role: "user", content: prompt }
            ],
            temperature: 0.2
        };

        const headers = {
            'Authorization': `Bearer ${provider.api_key}`,
            'Content-Type': 'application/json'
        };

        if (DEBUG_AI) {
            console.log('[AI][request]', safeStringify({
                apiUrl,
                provider: { id: provider.id, name: provider.name, provider_type: provider.provider_type, model: provider.model, base_url: provider.base_url },
                headers,
                payload: {
                    ...payload,
                    messages: payload.messages.map((m) => ({ ...m, content: truncateText(m.content, 4000) }))
                }
            }));
        }

        const response = await axios.post(apiUrl, payload, { headers, timeout: 20000 });

        if (DEBUG_AI) {
            const responseContent = response?.data?.choices?.[0]?.message?.content ?? '';
            console.log('[AI][response]', safeStringify({
                status: response?.status,
                dataPreview: truncateText(responseContent, 4000),
                raw: response?.data
            }));
        }

        const content = response?.data?.choices?.[0]?.message?.content;
        return safeParse(content);
    } catch (error) {
        if (DEBUG_AI) {
            console.log('[AI][error]', safeStringify({
                message: error?.message,
                code: error?.code,
                status: error?.response?.status,
                data: error?.response?.data
            }));
        }
        logger.error('AI Analysis Error', error, { campaignId: provider?.id || null, base_url: provider?.base_url || null, model: provider?.model || null });
        return { analyse_result: 'error', analyse_score: 0 };
    }
}

async function startCampaign(campaignId) {
    if (runningCampaigns.has(campaignId)) {
        console.log(`Campaign ${campaignId} is already running.`);
        return;
    }
    runningCampaigns.add(campaignId);

    const crypto = require('crypto');

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const disableCache = async (page) => {
        try {
            await page.setCacheEnabled(false);
            const client = await page.target().createCDPSession();
            await client.send('Network.enable');
            await client.send('Network.setCacheDisabled', { cacheDisabled: true });
        } catch {}
    };

    const clearBrowserCache = async (page) => {
        try {
            const client = await page.target().createCDPSession();
            await client.send('Network.enable');
            await client.send('Network.clearBrowserCache');
        } catch {}
    };

    const parseNumber = (txt) => {
        if (!txt) return 0;
        const normalizeDigits = (s) =>
            String(s || '')
                .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
                .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

        const normalized = normalizeDigits(String(txt).replace(/\s+/g, ' '))
            .replace(/٬/g, ',')
            .replace(/،/g, ',')
            .replace(/٫/g, '.');

        const m = normalized.match(/([\d,.]+)\s*([KkMm])?/);
        if (!m) return 0;
        const raw = m[1].replace(/,/g, '');
        const suffix = (m[2] || '').toLowerCase();
        const n = parseFloat(raw);
        if (Number.isNaN(n)) return 0;
        if (suffix === 'k') return Math.round(n * 1000);
        if (suffix === 'm') return Math.round(n * 1000000);
        const lower = normalized.toLowerCase();
        if (lower.includes('هزار')) return Math.round(n * 1000);
        if (lower.includes('میلیون')) return Math.round(n * 1000000);
        return Math.round(n);
    };

    const loadCampaignState = async () => {
        const [campaigns] = await db.query('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
        if (campaigns.length === 0) return null;
        return campaigns[0];
    };

    const isCampaignAllowedToRun = (campaign) => {
        if (!campaign) return false;
        const status = String(campaign.status || '').toLowerCase();
        if (status !== 'active') return false;
        const now = new Date();
        if (campaign.start_date && now < new Date(campaign.start_date)) return false;
        if (campaign.end_date && now > new Date(campaign.end_date)) return false;
        return true;
    };

    const getKeywords = async () => {
        const [keywords] = await db.query('SELECT keyword FROM keywords WHERE campaign_id = ?', [campaignId]);
        return keywords.map((k) => k.keyword).filter(Boolean);
    };

    const retryFailedAnalyses = async (provider, keywordFallback) => {
        if (!provider) return;
        try {
            const [rows] = await db.query(
                "SELECT id, post_text, post_url, keyword FROM results WHERE campaign_id = ? AND analysis_result = 'error' ORDER BY checked_at DESC LIMIT 5",
                [campaignId]
            );
            for (const r of rows) {
                const kw = r.keyword || keywordFallback || '';
                const analysis = await analyzeWithAI(r.post_text || '', kw, r.post_url || '', provider);
                if (analysis && analysis.analyse_result && analysis.analyse_result !== 'error') {
                    await db.query(
                        'UPDATE results SET analysis_result = ?, analysis_score = ?, checked_at = ? WHERE id = ?',
                        [analysis.analyse_result, analysis.analyse_score, new Date(), r.id]
                    );
                }
            }
        } catch (e) {
            logger.error('Retry failed analyses error', e, { campaignId });
        }
    };

    const ensureSearchFocused = async (page) => {
        const searchIconSelectors = [
            'i.icon-search',
            'button[title*="جست"]',
            'button[aria-label*="جست"]',
            '[role="button"][title*="Search"]'
        ];
        for (const sel of searchIconSelectors) {
            const el = await page.$(sel);
            if (el) {
                try {
                    await el.click();
                    await sleep(300);
                    return;
                } catch {}
            }
        }
    };

    const selectGlobalSearchTab = async (page) => {
        try {
            await page.waitForFunction(() => {
                const nodes = Array.from(document.querySelectorAll('[role="tab"], button, a, div, span, li'));
                const labels = ['سراسری', 'گفتگوها'];
                return nodes.some((n) => labels.includes(((n.textContent || '').trim())));
            }, { timeout: 8000 }).catch(() => {});

            const clickedLabel = await page.evaluate(() => {
                const isVisible = (el) => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    if (style.visibility === 'hidden' || style.display === 'none') return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                };

                const getClickable = (el) => {
                    if (!el) return null;
                    const clickable = el.closest?.('[role="tab"], button, a') || el;
                    return clickable;
                };

                const labels = ['سراسری', 'گفتگوها'];
                const all = Array.from(document.querySelectorAll('[role="tab"], button, a, div, span, li'));

                const findForLabel = (label) => {
                    const candidates = all
                        .filter((n) => ((n.textContent || '').trim() === label))
                        .map(getClickable)
                        .filter((n) => n && isVisible(n));
                    const preferred =
                        candidates.find((n) => n.getAttribute?.('role') === 'tab') ||
                        candidates.find((n) => n.tagName === 'BUTTON') ||
                        candidates.find((n) => n.tagName === 'A') ||
                        candidates[0];
                    return preferred || null;
                };

                for (const label of labels) {
                    const preferred = findForLabel(label);
                    if (!preferred) continue;
                    try {
                        preferred.scrollIntoView({ block: 'center', inline: 'center' });
                    } catch {}
                    try {
                        preferred.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                        return label;
                    } catch {
                        try {
                            preferred.click();
                            return label;
                        } catch {}
                    }
                }

                return '';
            });

            if (!clickedLabel) {
                const tabs = await page.evaluate(() => {
                    const nodes = Array.from(document.querySelectorAll('[role="tab"]'));
                    return nodes.map((n) => (n.textContent || '').trim()).filter(Boolean).slice(0, 30);
                }).catch(() => []);
                if (tabs && tabs.length) console.log('Visible tabs:', tabs.join(' | '));
            } else {
                console.log(`Selected search tab: ${clickedLabel}`);
                await sleep(600);
            }
        } catch {}
    };

    const clearAndType = async (page, selector, value) => {
        await page.waitForSelector(selector, { timeout: 20000 });
        await page.click(selector);
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.type(selector, value, { delay: 60 });
    };

    const extractCurrentPostData = async (page) => {
        return page.evaluate(() => {
            const normalizeDigits = (s) =>
                String(s || '')
                    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
                    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

            const getText = (sel) => document.querySelector(sel)?.innerText?.trim() || '';
            const firstMatch = (text, re) => {
                const m = text.match(re);
                return m ? m[1] : '';
            };

            const headerText = [
                getText('.chat-title'),
                getText('.person-name'),
                getText('.peer-title'),
                getText('.topbar .title'),
                getText('.sidebar-header')
            ].filter(Boolean).join(' ');

            const subtitle = [
                getText('.chat-status'),
                getText('.person-status'),
                getText('.topbar .subtitle'),
                getText('.topbar'),
                getText('.peer-status'),
                getText('.chat-subtitle'),
                getText('.chat-info')
            ].filter(Boolean).join(' ');

            const channelName = firstMatch(headerText, /(.+)/) || 'Unknown';

            let channelId = '';
            const usernameFromHeader = firstMatch(headerText + ' ' + subtitle, /@([a-zA-Z0-9_\.]+)/);
            if (usernameFromHeader) channelId = `@${usernameFromHeader}`;
            if (!channelId) {
                const anyLink = Array.from(document.querySelectorAll('a[href]'))
                    .map((a) => a.getAttribute('href') || '')
                    .find((h) => /@[\w.]+/.test(h));
                if (anyLink) {
                    const m = anyLink.match(/@([\w.]+)/);
                    if (m) channelId = `@${m[1]}`;
                }
            }

            const combinedTopbar = normalizeDigits(`${headerText} ${subtitle}`);
            const memberStr =
                firstMatch(combinedTopbar, /([\d,.]+\s*[KkMm]?)\s*(?:نفر|عضو)/) ||
                firstMatch(combinedTopbar, /members?\s*[:\-]?\s*([\d,.]+)/i) ||
                firstMatch(combinedTopbar, /([\d,.]+\s*[KkMm]?)/);

            const messageBubble =
                document.querySelector('.message.selected') ||
                document.querySelector('.message.highlighted') ||
                document.querySelector('.message:focus') ||
                document.querySelector('.message:last-child');

            const postText =
                messageBubble?.querySelector('.text-content')?.innerText?.trim() ||
                messageBubble?.querySelector('.message-text')?.innerText?.trim() ||
                messageBubble?.innerText?.trim() ||
                '';

            const isVideo = !!messageBubble?.querySelector('video, .video-player, .attachment video, [class*="video"]');

            const viewsCandidates = [
                '.message-views',
                '.views',
                '.message-meta',
                '.post-views',
                '[class*="views"]',
                '[class*="view"]',
                '[class*="seen"]',
                '[class*="eye"]',
                '[class*="meta"]',
                '[class*="footer"]',
                '[class*="info"]'
            ];

            let viewsText = '';
            for (const sel of viewsCandidates) {
                const t = messageBubble?.querySelector(sel)?.innerText?.trim();
                if (t && t.length <= 50) {
                    viewsText = t;
                    break;
                }
            }
            if (!viewsText) {
                const bubbleText = messageBubble?.innerText?.trim() || '';
                const normalizedBubble = normalizeDigits(bubbleText)
                    .replace(/٬/g, ',')
                    .replace(/،/g, ',')
                    .replace(/٫/g, '.');

                const m1 = normalizedBubble.match(/بازدید\s*[:\-]?\s*([\d,.]+)\s*([kKmM]|هزار|میلیون)?/);
                if (m1) {
                    viewsText = `${m1[1]}${m1[2] ? String(m1[2]) : ''}`;
                } else {
                    const tokens = normalizedBubble.split(/\s+/g);
                    const numericTokens = tokens
                        .filter((t) => /^[\d,.]+(?:[kKmM]|هزار|میلیون)?$/.test(t))
                        .slice(-5);
                    if (numericTokens.length) viewsText = numericTokens[numericTokens.length - 1];
                }
            }

            const dateEl = messageBubble?.querySelector('time, .message-date, .message-time, .time, [class*="date"], [class*="time"]');
            const postDate =
                dateEl?.getAttribute('datetime') ||
                dateEl?.getAttribute('title') ||
                dateEl?.innerText?.trim() ||
                '';

            const postId =
                messageBubble?.getAttribute('data-mid') ||
                messageBubble?.getAttribute('data-message-id') ||
                messageBubble?.dataset?.mid ||
                messageBubble?.dataset?.messageId ||
                '';

            return {
                channelName,
                channelId,
                memberStr,
                postText,
                isVideo,
                viewsText,
                postDate,
                postUrl: window.location.href,
                postId,
                topbarText: `${headerText} ${subtitle}`.trim()
            };
        });
    };

    let browser;
    try {
        console.log(`Starting campaign ${campaignId}...`);
        const provider = await getAIProvider(campaignId);
        if (!provider) logger.warn('No AI Provider found for this campaign', { campaignId });

        browser = await launchBrowser({
            userDataDir: profileDir
        });

        const page = await browser.newPage();
        await disableCache(page);
        const searchInputSelector = 'input[placeholder*="جست"], input[placeholder*="Search"], input.form-control, .input-search input, input[type="text"]';
        const resultSelector = '.search-group, .search-super-group, .message-content-wrapper, .search-result';

        while (true) {
            const campaign = await loadCampaignState();
            if (!isCampaignAllowedToRun(campaign)) break;

            const keywordList = await getKeywords();
            if (keywordList.length === 0) break;

            await retryFailedAnalyses(provider, keywordList[0]);
            await clearBrowserCache(page);
            await page.goto(`https://${campaign.network}`, { waitUntil: 'networkidle2' });
            try {
                await page.waitForSelector('.chat-list, .sidebar-header, i.icon-search, input.form-control', { timeout: 30000 });
            } catch {}

            const needsLogin = await page.$("input[type='tel'], input[name='phone'], input[autocomplete='tel']");
            if (needsLogin) {
                console.log('Eitaa login required. Please login in the opened browser tab, then monitoring will continue automatically.');
                await sleep(60_000);
                continue;
            }

            for (const keyword of keywordList) {
                const currentCampaign = await loadCampaignState();
                if (!isCampaignAllowedToRun(currentCampaign)) break;

                console.log(`Searching for: ${keyword}`);
                try {
                    await ensureSearchFocused(page);
                    await selectGlobalSearchTab(page);
                    await clearAndType(page, searchInputSelector, keyword);
                    await page.keyboard.press('Enter');
                    await sleep(3000);
                    await selectGlobalSearchTab(page);

                    try {
                        await page.evaluate(() => {
                            const scrollable = document.querySelector('.search-results, .sidebar-content, .scrollable');
                            if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
                        });
                    } catch {}
                    await sleep(1500);

                    const collectedData = [];
                    const perChannelLimit = Math.max(1, Math.min(50, Number(currentCampaign?.per_channel_limit) || 3));
                    const maxChannels = Math.max(1, Math.min(200, Number(currentCampaign?.max_channels) || 20));
                    const maxResults = Math.max(1, Math.min(200, perChannelLimit * maxChannels));
                    const channelCounts = new Map();
                    const channelsSeen = new Set();

                    for (let offset = 0; offset < maxResults; offset++) {
                        try {
                            const currentResults = await page.$$(resultSelector);
                            const idx = currentResults.length - 1 - offset;
                            if (idx < 0) break;
                            const resultElement = currentResults[idx];

                            await resultElement.evaluate((el) => el.scrollIntoView({ block: 'center' }));

                            const previewText = await resultElement.evaluate((el) => (el.innerText || '').trim());
                            const kw = String(keyword || '').trim();
                            if (kw && previewText && !normalizeMatchText(previewText).includes(normalizeMatchText(kw))) {
                                continue;
                            }

                            await resultElement.click();
                            await sleep(1500);

                            const raw = await extractCurrentPostData(page);
                            const channelName = raw.channelName || 'Unknown';
                            const channelId =
                                raw.channelId ||
                                (channelName ? `name:${channelName}` : 'unknown');

                            const seen = channelsSeen.has(channelId);
                            if (!seen && channelsSeen.size >= maxChannels) {
                                continue;
                            }
                            const currentCount = channelCounts.get(channelId) || 0;
                            if (currentCount >= perChannelLimit) {
                                continue;
                            }
                            channelsSeen.add(channelId);
                            channelCounts.set(channelId, currentCount + 1);

                            const memberCount = parseNumber(raw.memberStr);
                            const viewCount = parseNumber(raw.viewsText);

                            let postText = raw.postText || '';
                            if (!postText || postText.length < 20) {
                                postText = previewText || postText;
                            }

                            if (DEBUG_SCRAPE) {
                                console.log('[SCRAPE]', safeStringify({
                                    keyword,
                                    channelName,
                                    channelId,
                                    memberStr: raw.memberStr || '',
                                    memberCount,
                                    viewsText: raw.viewsText || '',
                                    viewCount,
                                    postDate: raw.postDate || '',
                                    url: raw.postUrl || page.url(),
                                    preview: truncateText(previewText || '', 400),
                                    postText: truncateText(postText || '', 400),
                                    topbar: truncateText(raw.topbarText || '', 300)
                                }));
                            }
                            const postId =
                                raw.postId ||
                                crypto.createHash('md5').update(`${channelId}|${raw.postUrl}|${postText}`).digest('hex');


                            const [existing] = await db.query(
                                'SELECT id, member_count, view_count, post_date FROM results WHERE post_id = ? AND channel_id = ? LIMIT 1',
                                [postId, channelId]
                            );

                            if (existing.length === 0) {
                                collectedData.push({
                                    channelName,
                                    channelId,
                                    memberCount,
                                    viewCount,
                                    postDate: raw.postDate || '',
                                    postText,
                                    isVideo: !!raw.isVideo,
                                    postUrl: raw.postUrl || page.url(),
                                    postId,
                                    rawPreview: previewText || '',
                                    rawTopbar: raw.topbarText || '',
                                    rawMemberStr: raw.memberStr || '',
                                    rawViewsText: raw.viewsText || '',
                                    rawPostDate: raw.postDate || ''
                                });
                            } else {
                                const row = existing[0];
                                const shouldUpdate =
                                    (Number(row.member_count || 0) === 0 && memberCount > 0) ||
                                    (Number(row.view_count || 0) === 0 && viewCount > 0) ||
                                    (!row.post_date && raw.postDate);

                                if (shouldUpdate) {
                                    await db.query(
                                        'UPDATE results SET member_count = GREATEST(member_count, ?), view_count = GREATEST(view_count, ?), post_date = CASE WHEN post_date IS NULL OR post_date = \'\' THEN ? ELSE post_date END, checked_at = ? WHERE id = ?',
                                        [memberCount || 0, viewCount || 0, raw.postDate || '', new Date(), row.id]
                                    );
                                }
                            }
                        } catch (err) {
                            const msg = String(err?.message || '');
                            if (/detached|Execution context|Cannot find context|not visible|Node is either not visible|Target closed/i.test(msg)) {
                                logger.warn('Error processing search result', { campaignId, keyword, message: msg });
                            } else {
                                logger.error('Error processing search result', err, { campaignId, keyword });
                            }
                        }
                    }

                    for (let i = 0; i < collectedData.length; i++) {
                        let similarCount = 0;
                        for (let j = 0; j < collectedData.length; j++) {
                            if (i === j) continue;
                            if (!collectedData[i].postText || !collectedData[j].postText) continue;
                            if (collectedData[i].channelId && collectedData[j].channelId && collectedData[i].channelId === collectedData[j].channelId) continue;
                            const similarity = stringSimilarity.compareTwoStrings(collectedData[i].postText, collectedData[j].postText);
                            if (similarity > 0.82) similarCount++;
                        }
                        collectedData[i].isReportage = similarCount >= 1;
                    }

                    for (const item of collectedData) {
                        const analysisText = item.postText || item.rawPreview || '';
                        const analysis = await analyzeWithAI(analysisText, keyword, item.postUrl, provider);
                        const postData = {
                            campaign_id: campaignId,
                            keyword,
                            channel_name: item.channelName,
                            channel_id: item.channelId,
                            post_url: item.postUrl,
                            member_count: item.memberCount || 0,
                            view_count: item.viewCount || 0,
                            post_date: item.postDate || '',
                            is_video: item.isVideo ? 1 : 0,
                            analysis_result: analysis.analyse_result,
                            analysis_score: analysis.analyse_score,
                            is_reportage: item.isReportage ? 1 : 0,
                            post_text: analysisText,
                            post_id: item.postId,
                            checked_at: new Date()
                        };

                        try {
                            await db.query('INSERT IGNORE INTO results SET ?', postData);
                        } catch (e) {
                            if (e && e.code === 'ER_DUP_ENTRY') {
                                continue;
                            }
                            throw e;
                        }
                        console.log(`Saved: ${item.postUrl} | AI: ${analysis.analyse_result}`);
                    }
                } catch (err) {
                    logger.error('Error searching keyword', err, { campaignId, keyword });
                }
            }

            const refreshed = await loadCampaignState();
            if (!isCampaignAllowedToRun(refreshed)) break;
            const minutes = parseInt(refreshed.frequency, 10);
            const waitMs = Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 60_000;
            console.log(`Waiting ${Math.round(waitMs / 1000)}s for next run...`);
            await sleep(waitMs);
        }

        console.log('Campaign stopped/finished.');
    } catch (err) {
        logger.error('Bot Error', err, { campaignId });
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch {}
        }
        runningCampaigns.delete(campaignId);
    }
}

module.exports = { startCampaign };

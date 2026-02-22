function normalizeBaseUrl(baseUrl) {
    const raw = String(baseUrl || '').trim();
    if (!raw) return null;
    let v = raw.replace(/\/+$/g, '');
    if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
    return v;
}

function defaultModelFor(providerType, apiKey) {
    const key = String(apiKey || '').trim().toLowerCase();
    if (providerType === 'avalai' || key.startsWith('aa-')) return 'gpt-4o';
    if (providerType === 'deepseek') return 'deepseek-chat';
    return 'gpt-4o';
}

function normalizeProviderInput(input, opts = {}) {
    const allowEmptyKey = !!opts.allowEmptyKey;

    const name = String(input?.name || '').trim();
    const providerTypeRaw = String(input?.provider_type || 'openai').trim().toLowerCase();
    const provider_type = ['openai', 'deepseek', 'custom', 'avalai'].includes(providerTypeRaw)
        ? providerTypeRaw
        : 'custom';
    const api_key = String(input?.api_key || '').trim();

    if (!name) return { ok: false, message: 'نام سرویس الزامی است.' };
    if (!allowEmptyKey && !api_key) return { ok: false, message: 'API Key الزامی است.' };

    let base_url = normalizeBaseUrl(input?.base_url);

    if (!base_url && (provider_type === 'avalai' || api_key.toLowerCase().startsWith('aa-'))) {
        base_url = 'https://api.avalai.ir/v1';
    }

    const modelInput = String(input?.model || '').trim();
    const model = modelInput || defaultModelFor(provider_type, api_key);

    return {
        ok: true,
        value: {
            name,
            provider_type,
            api_key,
            model,
            base_url
        }
    };
}

function buildChatCompletionsUrl(baseUrl, context = {}) {
    const providerType = String(context?.provider_type || '').trim().toLowerCase();
    const apiKey = String(context?.api_key || '').trim().toLowerCase();

    let effectiveBase = normalizeBaseUrl(baseUrl);

    if (!effectiveBase) {
        if (providerType === 'avalai' || apiKey.startsWith('aa-')) {
            effectiveBase = 'https://api.avalai.ir/v1';
        } else {
            return 'https://api.openai.com/v1/chat/completions';
        }
    }

    if (/\/chat\/completions$/i.test(effectiveBase)) return effectiveBase;
    if (!/\/v1$/i.test(effectiveBase)) effectiveBase = `${effectiveBase}/v1`;
    return `${effectiveBase}/chat/completions`;
}

module.exports = {
    normalizeBaseUrl,
    normalizeProviderInput,
    buildChatCompletionsUrl
};


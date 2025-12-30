/**
 * APIManager.js
 * An isolated module for managing API presets and making chat content requests.
 *
 * REVISION 13: Added `proxyPassword` to the preset configuration and request payload.
 * This allows authentication against password-protected reverse proxies by sending the
 * correct `proxy_password` parameter to SillyTavern's backend.
 *
 * REVISION 12: Corrected the 'custom' apiMode pathway to ensure the 'model' field is always included
 * in the base request body, which is required by most OpenAI-compatible backends.
 *
 * REVISION 11: Added explicit 'api_key' payload field for Google/Makersuite source compatibility.
 */

export const API_SOURCES = {
    OPENAI: 'openai',
    CLAUDE: 'claude',
    OPENROUTER: 'openrouter',
    AI21: 'ai21',
    MAKERSUITE: 'makersuite',
    VERTEXAI: 'vertexai',
    MISTRALAI: 'mistralai',
    CUSTOM: 'custom',
    COHERE: 'cohere',
    PERPLEXITY: 'perplexity',
    GROQ: 'groq',
    ZEROONEAI: '01ai',
    NANOGPT: 'nanogpt',
    DEEPSEEK: 'deepseek',
    AIMLAPI: 'aimlapi',
    XAI: 'xai',
    POLLINATIONS: 'pollinations',
};

export class APIManager {
    /**
     * @param {object} options
     * @param {Array} options.initialPresets - The starting array of presets.
     * @param {Function} options.onUpdate - A callback function that receives the updated presets array whenever a change is made.
     */
    constructor({ initialPresets = [], onUpdate = () => {} }) {
        this.presets = initialPresets;
        this.onUpdate = onUpdate;
    }

    /**
     * Notifies the parent module that the presets have been updated.
     */
    _notifyUpdate() {
        if (typeof this.onUpdate === 'function') {
            this.onUpdate(this.presets);
        }
    }

    /**
     * Saves a new API configuration or updates an existing one.
     * @param {string} name - The unique name for the preset.
     * @param {object} config - The configuration object.
     * @returns {boolean} True if successful.
     */
    savePreset(name, config) {
        if (!name || typeof name !== 'string') throw new Error('Invalid preset name');
        if (!config || typeof config !== 'object') throw new Error('Invalid config object');

        const trimmedName = name.trim();

        const presetData = {
            name: trimmedName,
            apiMode: config.apiMode === 'tavern' ? 'tavern' : 'custom',
            apiConfig: {
                source: config.apiConfig?.source || API_SOURCES.CUSTOM,
                url: config.apiConfig?.url || '',
                apiKey: config.apiConfig?.apiKey || '',
                proxyPassword: config.apiConfig?.proxyPassword || '', // ADDED
                model: config.apiConfig?.model || '',
                max_tokens: parseInt(config.apiConfig?.max_tokens || 4096, 10),
                temperature: parseFloat(config.apiConfig?.temperature || 0.9),
                top_p: parseFloat(config.apiConfig?.top_p || 0.9),
                frequency_penalty: parseFloat(config.apiConfig?.frequency_penalty || 0.0),
                presence_penalty: parseFloat(config.apiConfig?.presence_penalty || 0.0),
            }
        };

        const existingIndex = this.presets.findIndex(p => p.name === trimmedName);
        if (existingIndex >= 0) {
            this.presets[existingIndex] = presetData;
        } else {
            this.presets.push(presetData);
        }

        this._notifyUpdate();
        return true;
    }

    /**
     * Deletes a preset by name.
     * @param {string} name
     * @returns {boolean} True if found and deleted.
     */
    deletePreset(name) {
        const initialLength = this.presets.length;
        this.presets = this.presets.filter(p => p.name !== name);
        if (this.presets.length !== initialLength) {
            this._notifyUpdate();
            return true;
        }
        return false;
    }

    /**
     * Retrieves a specific preset by name.
     * @param {string} name
     */
    getPreset(name) {
        return this.presets.find(p => p.name === name);
    }

    /**
     * Lists all saved presets.
     */
    getAllPresets() {
        return this.presets;
    }

    /**
     * Helper: Normalizes role names for API consumption (user/assistant/system).
     */
    _normalizeRole(role) {
        const r = String(role || '').toLowerCase();
        if (r === 'ai' || r === 'assistant') return 'assistant';
        if (r === 'system') return 'system';
        return 'user';
    }

    /**
     * Executes an API Call using the method specified in the preset.
     * @param {Array} messages - Array of {role, content} objects.
     * @param {string} presetName - The name of the preset to use for configuration.
     * @param {AbortSignal} abortSignal - Optional AbortSignal for cancellation.
     * @returns {Promise<string>} The content of the AI response.
     */
    async generate(messages, presetName, abortSignal = null) {
        const preset = this.getPreset(presetName);
        if (!preset) {
            throw new Error(`APIManager: Preset "${presetName}" not found.`);
        }

        const orderedMessages = messages.map(m => ({
            role: this._normalizeRole(m.role),
            content: m.content
        }));

        // --- PATH 1: Use Tavern's Main Configured API ---
        if (preset.apiMode === 'tavern') {
            console.log("[API Manager] Mode: 'tavern'. Generating with Tavern's Main API via TavernHelper.");
            if (typeof TavernHelper === 'undefined' || typeof TavernHelper.generateRaw !== 'function') {
                throw new Error('APIManager: TavernHelper.generateRaw not available.');
            }
            try {
                const response = await TavernHelper.generateRaw({
                    ordered_prompts: orderedMessages,
                    should_stream: false,
                }, abortSignal);

                if (typeof response === 'string') return response.trim();
                throw new Error(`Main API did not return a valid text response.`);
            } catch (error) {
                console.error('[APIManager] Main API call (TavernHelper) failed:', error);
                throw error;
            }
        }

        // --- PATH 2: Use a Custom API Address via SillyTavern's Proxy ---
        if (preset.apiMode === 'custom') {
            const apiConfig = preset.apiConfig || {};

            if (!apiConfig.model) {
                throw new Error(`APIManager: Model name is required for custom preset "${presetName}".`);
            }

            const cleanUrl = apiConfig.url ? apiConfig.url.replace(/\/$/, '') : '';
            const source = apiConfig.source || API_SOURCES.CUSTOM;

            console.log(`[API Manager] Mode: 'custom' (Source: ${source}). Model: ${apiConfig.model}`);

            let requestBody = {
                messages: orderedMessages,
                model: apiConfig.model,
                max_tokens: apiConfig.max_tokens,
                temperature: apiConfig.temperature,
                top_p: apiConfig.top_p,
                frequency_penalty: apiConfig.frequency_penalty,
                presence_penalty: apiConfig.presence_penalty,
                stream: false,
                chat_completion_source: source,
                custom_url: cleanUrl,
                reverse_proxy: cleanUrl,
                api_key: apiConfig.apiKey,
                key: apiConfig.apiKey,
                custom_include_headers: apiConfig.apiKey ? `Authorization: Bearer ${apiConfig.apiKey}` : '',
                proxy_password: apiConfig.proxyPassword || "", // CORRECTED
            };

            // Add source-specific model fields if necessary.
            switch (source) {
                case API_SOURCES.MAKERSUITE:
                case 'google':
                    requestBody.google_model = apiConfig.model;
                    break;
                case API_SOURCES.CLAUDE:
                    requestBody.claude_model = apiConfig.model;
                    break;
                case API_SOURCES.MISTRALAI:
                    requestBody.mistral_model = apiConfig.model;
                    break;
            }

            try {
                const response = await fetch('/api/backends/chat-completions/generate', {
                    method: 'POST',
                    headers: {
                        ...SillyTavern.getContext().getRequestHeaders(),
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody),
                    signal: abortSignal,
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`API request failed: ${response.status} - ${errorText}`);
                }

                const data = await response.json();

                if (data?.choices?.[0]?.message?.content) {
                    return data.choices[0].message.content.trim();
                }

                throw new Error(`Custom API call returned an invalid or empty response: ${JSON.stringify(data)}`);

            } catch (error) {
                console.error('[APIManager] Custom API fetch call failed:', error);
                throw error;
            }
        }

        throw new Error(`APIManager: Unknown apiMode "${preset.apiMode}" in preset "${presetName}".`);
    }
}
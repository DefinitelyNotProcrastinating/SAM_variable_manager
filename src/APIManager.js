/**
 * APIManager.js
 * An isolated module for managing API presets and making chat completion requests.
 * It operates on in-memory data and uses a callback to signal persistence.
 *
 * Dependencies: Requires 'SillyTavern' context and 'TavernHelper' global for execution.
 *
 * REVISION 4: This version corrects the structure of the call to TavernHelper.generateRaw
 * to align with the official documentation. API parameters are now correctly nested within
 * the 'custom_api' object, key names have been updated (e.g., 'apiurl', 'key'), and
 * the 'messages' array is passed as 'ordered_prompts'.
 */
export class APIManager {
    /**
     * @param {object} options
     * @param {Array} options.initialPresets - The starting array of presets.
     * @param {Function} options.onUpdate - A callback function that receives the updated presets array whenever a change is made.
     */
    constructor({ initialPresets = [], onUpdate = () => {} }) {
        this.presets = initialPresets;
        this.onUpdate = onUpdate;
        this.context = SillyTavern.getContext();
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
            apiMode: config.apiMode || 'custom',
            tavernProfile: config.tavernProfile || '',
            apiConfig: {
                url: config.apiConfig?.url || '',
                apiKey: config.apiConfig?.apiKey || '',
                password: config.apiConfig?.password || '',
                model: config.apiConfig?.model || '',
                source: config.apiConfig?.source || 'openai',
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
     * Executes an API Call using the TavernHelper.generateRaw method.
     * @param {Array} messages - Array of {role, content} objects.
     * @param {object} configOverride - Optional configuration object. If provided, uses this instead of a preset.
     * @param {string} presetName - Optional. If configOverride is null, loads settings from this preset.
     * @param {AbortSignal} abortSignal - Optional AbortSignal for cancellation.
     * @returns {Promise<string>} The content of the AI response.
     */
    async generate(messages, configOverride = null, presetName = null, abortSignal = null) {
        let config = configOverride;
        if (!config && presetName) {
            config = this.getPreset(presetName);
        }

        if (!config) {
            throw new Error('APIManager: No configuration provided and no preset found.');
        }

        const apiConfig = config.apiConfig || {};
        const orderedPrompts = messages.map(m => ({
            role: this._normalizeRole(m.role),
            content: m.content
        }));

        if (typeof TavernHelper === 'undefined' || typeof TavernHelper.generateRaw !== 'function') {
            throw new Error('APIManager: TavernHelper.generateRaw not available.');
        }

        try {
            // Build the custom_api object according to the documentation.
            // Note: 'password' is not a documented parameter in CustomApiConfig and is omitted.
            const customApiConfig = {
                apiurl: apiConfig.url,
                key: apiConfig.apiKey,
                model: apiConfig.model,
                source: apiConfig.source,
                max_tokens: apiConfig.max_tokens,
                temperature: apiConfig.temperature,
                top_p: apiConfig.top_p,
                frequency_penalty: apiConfig.frequency_penalty,
                presence_penalty: apiConfig.presence_penalty,
            };

            console.log("[API Manager] Generating with custom_api config: " + JSON.stringify(customApiConfig));

            // Call generateRaw with the corrected structure.
            const response = await TavernHelper.generateRaw({
                ordered_prompts: orderedPrompts,
                should_stream: false,
                custom_api: customApiConfig
            }, abortSignal);

            if (typeof response === 'string') {
                return response.trim();
            }
            
            const errorDetails = typeof response === 'object' ? JSON.stringify(response) : String(response);
            throw new Error(`API did not return a valid text response. Received: ${errorDetails}`);

        } catch (error) {
            console.error('[APIManager] generateRaw call failed:', error);
            throw new Error(`API Request Failed: ${error.message}`);
        }
    }
}
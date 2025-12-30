// ============================================================================
// == Situational Awareness Manager (backend.js)
// ============================================================================
(function () {
    // --- CONFIGURATION ---
    const SCRIPT_NAME = "SAM-Util";
    const SCRIPT_VERSION = "5.7.0"; // Settings overhaul: presets moved to settings file
    const { Summary } = require('./Summary.js');
    const { SAMDatabase } = require('./SAMDatabase.js');
    const { APIManager } = require('./APIManager.js');
    const { registerMacro } = SillyTavern.getContext();

    // --- FSM STATES ---
    const SAM_STATES = {
        IDLE: "IDLE",
        CHECKING: "CHECKING",
        GENERATING: "GENERATING",
        ABORTED: "ABORTED"
    };

    let sam_fsm_state = SAM_STATES.IDLE;

    // --- DRY RUN TRACKING ---
    let current_run_is_dry = false;

    // Core Settings
    const DEFAULT_SETTINGS = {
        enabled: true,
        enable_auto_checkpoint: true,
        auto_checkpoint_frequency: 20,
        summary_api_preset: null,
        api_presets: [], // API presets are now part of the main settings
        summary_levels: {
            L1: {
                enabled: false,
                frequency: 20
            },
            L2: {
                enabled: true,
                frequency: 20
            },
            L3: {
                enabled: true,
                frequency: 5
            }
        },
        skipWIAN_When_summarizing: false,
        regexes: [],
        summary_prompt: `请仔细审查下方提供的聊天记录和现有设定。你的任务包含两部分，并需严格按照指定格式输出：

1.  **L2摘要**: 将“新内容”合并成一段连贯的摘要。在摘要中，每个对应原始消息的事件都必须在其句首注明编号。例如：【1】甘道夫和佛罗多见了面... 【2】佛罗多一行人前往了瑞文戴尔...

2.  **插入指令**: 对比“新内容”和“现有设定”。只为那些在“现有设定”中**不存在**的关键信息（如新角色、新地点、关键物品或设定）生成插入指令。指令格式为：
    @.insert(key="unique_key", content="详细描述", keywords=["关键词1", "关键词2"])

**最终输出格式要求：**
必须先输出完整的L2摘要，然后另起一行输出所有的 @.insert() 指令。不要添加任何其他文字、标题或解释。

---
现有设定:
{{db_content}}
---
新内容:
{{chat_content}}
---
`,
        summary_prompt_L3: `You are a summarization expert. Review the following list of sequential event summaries (L2 summaries). Your task is to condense them into a single, high-level narrative paragraph (an L3 summary). This new summary should capture the main plot points and character progression, omitting minor details already covered by the L2 summaries.

**Instructions:**
- Synthesize the key events from the provided summaries into one cohesive paragraph.
- Focus on the most significant developments, character arcs, and changes in the situation.
- Do not add any extra commentary, headers, or formatting. Output only the final paragraph.

---
**Summaries to Condense:**
{{summary_content}}
---
`
    };

    let sam_db = null;
    let apiManager = null;

    // --- MARKERS & REGEX ---
    const OLD_START_MARKER = '<!--<|state|>';
    const OLD_END_MARKER = '</|state|>-->';
    const NEW_START_MARKER = '$$$$$$data_block$$$$$$';
    const NEW_END_MARKER = '$$$$$$data_block_end$$$$$$';
    const STATE_BLOCK_START_MARKER = NEW_START_MARKER;
    const STATE_BLOCK_END_MARKER = NEW_END_MARKER;

    const STATE_BLOCK_REMOVE_REGEX = new RegExp(`(?:${OLD_START_MARKER.replace(/\|/g, '\\|')}|${NEW_START_MARKER.replace(/\$/g, '\\$')})\\s*[\\s\\S]*?\\s*(?:${OLD_END_MARKER.replace(/\|/g, '\\|')}|${NEW_END_MARKER.replace(/\$/g, '\\$')})`, 'sg');

    const SAM_ACTIVATION_KEY = "__SAM_IDENTIFIER__";
    const MODULE_NAME = 'sam_extension';

    const SAM_EVENTS = {
        INV: 'SAM_INV',
        EXT_ASK_STATUS: 'SAM_EXT_ASK_STATUS',
        CORE_STATUS_RESPONSE: 'SAM_CORE_STATUS_RESPONSE',
        SUMMARY_ERR: "SAM_SUMMARY_ERR",
        GENERATION_BEGIN : "SAM_GENERATION_BEGIN",
        GENERATION_END : "SAM_GENERATION_END"
    };

    var { eventSource, eventTypes, extensionSettings, saveSettingsDebounced, generateQuietPrompt, substituteParamsExtended } = SillyTavern.getContext();
    var _ = require('lodash');
    var go_flag = false;

    const INITIAL_STATE = {
        static: {},
        time: "",
        volatile: [],
        func: [],
        events: [],
        event_counter: 0,
        responseSummary: { L1: [], L2: [], L3: [] },
        summary_progress: 0,
        jsondb: null,
        last_saved_index: -1
    };

    const logger = {
        info: (...args) => console.log(`[${SCRIPT_NAME}]`, ...args),
        warn: (...args) => console.warn(`[${SCRIPT_NAME}]`, ...args),
        error: (...args) => console.error(`[${SCRIPT_NAME}]`, ...args)
    };

    // ============================================================================
    // == FSM CORE LOGIC
    // ============================================================================

    const SAM_FSM = {
        triggerCheck: async function () {
            return this.Check();
        },

        Check: async function () {
            if (sam_fsm_state === SAM_STATES.GENERATING) return;

            sam_fsm_state = SAM_STATES.CHECKING;
            await checkWorldInfoActivation();
            const settings = loadSamSettings();

            if (!go_flag || !settings.enabled) {
                sam_fsm_state = SAM_STATES.IDLE;
                return;
            }

            const data = await getVariables();
            const chat = SillyTavern.getContext().chat;

            const last_progress = data.summary_progress;
            const period = settings.summary_levels.L2.frequency;
            const current_msg_count = chat.length;
            const messages_since_last_summary = current_msg_count - last_progress;

            if (messages_since_last_summary >= period) {
                logger.info(`FSM Check: Threshold reached (Gap: ${messages_since_last_summary}/${period}). Initiating Summary.`);
                await this.startGeneration(last_progress, current_msg_count, false);
            } else {
                sam_fsm_state = SAM_STATES.IDLE;
            }
        },

        startGeneration: async function (startIndex, endIndex, force = false) {
            sam_fsm_state = SAM_STATES.GENERATING;
            try {
                const success = await processSummarizationRun(startIndex, endIndex, force);
                if (success) {
                    logger.info("FSM: Generation Success.");
                }
            } catch (err) {
                logger.error("FSM: Error during generation cycle.", err);
                await eventSource.emit(SAM_EVENTS.SUMMARY_ERR);
            } finally {
                sam_fsm_state = SAM_STATES.IDLE;
            }
        },

        handleInterruption: function () {
            if (sam_fsm_state === SAM_STATES.GENERATING) {
                logger.info("FSM: Interruption detected. Marking state as Aborted.");
                sam_fsm_state = SAM_STATES.ABORTED;
            }
        }
    };

    // ============================================================================
    // == SETTINGS & UTILS
    // ============================================================================
    function loadSamSettings() {
        if (!extensionSettings[MODULE_NAME]) extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
        _.defaultsDeep(extensionSettings[MODULE_NAME], DEFAULT_SETTINGS);
        return extensionSettings[MODULE_NAME];
    }
    async function saveSamSettings(key, value) {
        var s = loadSamSettings();
        _.set(s, key, value);
        saveSettingsDebounced();
    }

    async function checkWorldInfoActivation() {
        try {
            const wi = await getCurrentWorldbookName();
            if (!wi) return;
            const wi_entry_arr = Object.values(wi.entries);
            go_flag = wi_entry_arr.some(item => item.comment === SAM_ACTIVATION_KEY);
        } catch (e) { go_flag = false; }
    }

    async function getVariables() {
        let data = SillyTavern.getContext().variables.local.get("SAM_data");
        if (!data || typeof data !== 'object') {
            data = goodCopy(INITIAL_STATE);
        } else {
            _.defaultsDeep(data, INITIAL_STATE);
        }
        return data;
    }

    function sync_getVariables() {
        let data = SillyTavern.getContext().variables.local.get("SAM_data");
        if (!data || typeof data !== 'object') {
            data = goodCopy(INITIAL_STATE);
        } else {
            _.defaultsDeep(data, INITIAL_STATE);
        }
        return data;
    }

    async function setAllVariables(newData) {
        if (newData && typeof newData === 'object') {
            SillyTavern.getContext().variables.local.set("SAM_data", newData);
        }
    }

    async function sam_renewVariables(SAM_data) {
        let curr_variables = goodCopy(SAM_data);
        await setAllVariables(curr_variables);
        await initializeDatabase(SAM_data.jsondb);
        await eventSource.emit(SAM_EVENTS.INV);
    }

    function goodCopy(state) { if (!state) return _.cloneDeep(INITIAL_STATE); return JSON.parse(JSON.stringify(state)); }

    async function getCurrentWorldbookName() {
        const characterId = SillyTavern.getContext().characterId;
        if (characterId === null || characterId < 0) return null;
        const char = SillyTavern.getContext().characters[characterId];
        const worldInfoName = char?.data?.extensions?.world;
        return worldInfoName ? await SillyTavern.getContext().loadWorldInfo(worldInfoName) : null;
    }

    async function findLastAiMessageAndIndex() {
        const chat = SillyTavern.getContext().chat;
        for (let i = chat.length - 1; i >= 0; i--) { if (chat[i] && !chat[i].is_user) return i; }
        return -1;
    }
    async function chunkedStringify(obj) { return new Promise(resolve => setTimeout(() => resolve(JSON.stringify(obj, null, 2)), 10)); }

    // ============================================================================
    // == API
    // ============================================================================
    async function sam_is_in_use() {
        const settings = loadSamSettings();
        return !!settings.enabled;
    }

    function sam_get_status() {
        return sam_fsm_state;
    }

    async function sam_get_data() { return await getVariables(); }

    async function sam_set_data(newData) {
        if (typeof newData !== 'object' || newData === null) {
            toastr.error("SAM API: sam_set_data requires a valid object.");
            return;
        }
        try {
            const lastAiIndex = await findLastAiMessageAndIndex();
            if (lastAiIndex === -1) {
                toastr.error("SAM API: Cannot set data. No AI message found.");
                return;
            }

            await sam_renewVariables(newData);

            const chat = SillyTavern.getContext().chat;
            const lastAiMessage = chat[lastAiIndex];

            const cleanNarrative = lastAiMessage.mes.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            const newStateBlock = await chunkedStringify(newData);
            const finalContent = `${cleanNarrative}\n\n${STATE_BLOCK_START_MARKER}\n${newStateBlock}\n${STATE_BLOCK_END_MARKER}`;

            await TavernHelper.setChatMessages([{ 'message_id': lastAiIndex, 'message': finalContent }]);

            toastr.success("SAM API: Data block updated successfully!");
        } catch (error) {
            logger.error("[External API] sam_set_data failed.", error);
            toastr.error("SAM API: Failed to set data. Check console.");
        }
    };

    async function sam_summary() {
        logger.info("[SAM utils] Manual FORCE summary trigger");
        const chat = SillyTavern.getContext().chat;
        const settings = loadSamSettings();
        const period = settings.summary_levels.L2.frequency;
        const current_msg_count = chat.length;
        const startIndex = Math.max(0, current_msg_count - period);
        SAM_FSM.startGeneration(startIndex, current_msg_count, true);
    }

    // ============================================================================
    // == WORKER
    // ============================================================================
    async function initializeDatabase(dbStateJson = null) {
        sam_db = new SAMDatabase({ enabled: true });
        await sam_db.init();
        if (dbStateJson && typeof dbStateJson === 'string') { try { sam_db.import(dbStateJson); } catch (error) { } }
    }

    function parseAiResponseForL2(rawResponse) {
        const inserts = [];
        const insertCommandRegex = /@\.insert\s*\(([\s\S]*?)\)/gi;

        const summaryContent = rawResponse.replace(insertCommandRegex, (match, argsStr) => {
            try {
                let args;
                try {
                    args = JSON.parse(`{${argsStr}}`);
                } catch (jsonErr) {
                    const fixedStr = argsStr
                        .replace(/key=/g, '"key":')
                        .replace(/content=/g, '"content":')
                        .replace(/keywords=/g, '"keywords":');

                    try {
                        args = JSON.parse(`{${fixedStr}}`);
                    } catch (e2) { }
                }

                if (args && args.key && args.content && Array.isArray(args.keywords)) {
                    inserts.push({ key: args.key, content: args.content.trim(), keywords: args.keywords });
                }
            } catch (error) { }
            return '';
        }).trim();

        return { summaryContent, newInserts: inserts };
    }

    function serialize_db() {
        if (sam_db && sam_db.isInitialized) {
            const allMemos = sam_db.getAllMemosAsObject(); // Assuming this is synchronous
            if (allMemos && Object.keys(allMemos).length > 0) {
                return Object.entries(allMemos).map(([k, v]) => `Key: ${k}\nContent: ${v}`).join('\n\n');
            }
        }
        return "尚未储存任何设定。";
    }

    function serialize_memory() {
        const data = sync_getVariables();
        let serialized_memory_parts = [];
        const levels = Object.keys(data.responseSummary || {}).sort().reverse();
        for (const level of levels) {
            for (const summary of (data.responseSummary[level] || [])) {
                serialized_memory_parts.push(`[${level} Summary | Range: ${summary.index_begin}-${summary.index_end}]: ${summary.content}`);
            }
        }
        return serialized_memory_parts.join('\n');
    }


    async function processSummarizationRun(startIndex, endIndex, force = false) {
        const settings = loadSamSettings();
        const chat = SillyTavern.getContext().chat;
        let data = await getVariables();
        data = goodCopy(data);

        // Schema Enforcement
        if (!data.responseSummary || typeof data.responseSummary !== 'object') data.responseSummary = { L1: [], L2: [], L3: [] };
        if (!Array.isArray(data.responseSummary.L1)) data.responseSummary.L1 = [];
        if (!Array.isArray(data.responseSummary.L2)) data.responseSummary.L2 = [];
        if (!Array.isArray(data.responseSummary.L3)) data.responseSummary.L3 = [];

        if (force) {
            const originalLength = data.responseSummary.L2.length;
            data.responseSummary.L2 = data.responseSummary.L2.filter(summary => {
                const summaryStartsAfter = summary.index_begin >= endIndex;
                const summaryEndsBefore = summary.index_end <= startIndex;
                return summaryStartsAfter || summaryEndsBefore;
            });
            if (originalLength > data.responseSummary.L2.length) {
                const removedCount = originalLength - data.responseSummary.L2.length;
                logger.info(`Force summary: Removed ${removedCount} overlapping L2 summary(ies).`);
            }
        }

        const messagesToSummarize = chat.slice(startIndex, endIndex);
        if (messagesToSummarize.length === 0) return false;

        const contentString = messagesToSummarize.map(msg => {
            let processedMessage = msg.mes.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            if (settings.regexes && Array.isArray(settings.regexes)) {
                for (const regexObject of settings.regexes) {
                    if (regexObject.enabled && regexObject.regex_body) {
                        try { processedMessage = processedMessage.replace(new RegExp(regexObject.regex_body, 'g'), ''); } catch (e) { }
                    }
                }
            }
            return `${msg.name}: ${processedMessage}`;
        }).join('\n');

        const db_content = serialize_db();
        const promptL2 = substituteParamsExtended(settings.summary_prompt, { db_content: db_content, chat_content: contentString });

        const presetName = settings.summary_api_preset;
        let resultL2;


        eventSource.emit(SAM_EVENTS.GENERATION_BEGIN);
        toastr.success("[SAM] Generating summary")

        //console.log(promptL2);
        if (!presetName || !apiManager) {
            if (!apiManager) logger.warn("APIManager not initialized.");
            logger.warn("No API preset selected. Falling back to main generateQuietPrompt.");
            resultL2 = await generateQuietPrompt({ quietPrompt: promptL2, skipWIAN: settings.skipWIAN_When_summarizing });
        } else {
            try {
                logger.info(`Generating L2 summary with API preset: "${presetName}"`);


                // solution:
                // use system prompt to convert
                // use user prompt to insert data
                // then use user prompt to produce the final response?


                resultL2 = await apiManager.generate([{ role: 'user', content: promptL2 }], presetName, null);
            } catch (e) {
                logger.error("L2 Summarization with APIManager failed:", e);
                toastr.error(`SAM L2 Summary Failed: ${e.message}`);
                resultL2 = null;
            }
        }
        eventSource.emit(SAM_EVENTS.GENERATION_END);
        toastr.success("[SAM] Finishing summary");

        if (!resultL2 || sam_fsm_state === SAM_STATES.ABORTED) {
            logger.warn("L2 Summarization aborted or failed. FSM will reset to IDLE.");
            return false;
        }

        const { summaryContent, newInserts } = parseAiResponseForL2(resultL2);

        if (summaryContent) {
            data.responseSummary.L2.push(new Summary(startIndex, endIndex, summaryContent, 0));

            if (newInserts && Array.isArray(newInserts)) {
                for (const item of newInserts) await sam_db.setMemo(item.key, item.content, item.keywords);
            }

            data.summary_progress = endIndex;

            // --- L3 SUMMARY TRIGGER ---
            const l3Settings = settings.summary_levels.L3;
            if (l3Settings.enabled && data.responseSummary.L2.length >= l3Settings.frequency) {
                logger.info(`L3 summary threshold reached (${data.responseSummary.L2.length}/${l3Settings.frequency}). Generating L3 summary.`);

                const summariesToCondense = data.responseSummary.L2.slice(-l3Settings.frequency);
                const l3ContentString = summariesToCondense.map(s => `[Messages ${s.index_begin}-${s.index_end}]: ${s.content}`).join('\n');
                const promptL3 = substituteParamsExtended(settings.summary_prompt_L3, { summary_content: l3ContentString });

                let resultL3;
                try {
                    resultL3 = await apiManager.generate([{ role: 'user', content: promptL3 }], presetName, null);
                } catch (e) {
                    logger.error("L3 Summarization failed:", e);
                    toastr.error(`SAM L3 Summary Failed: ${e.message}`);
                    resultL3 = null;
                }

                if (resultL3) {
                    const l3StartIndex = summariesToCondense[0].index_begin;
                    const l3EndIndex = summariesToCondense[summariesToCondense.length - 1].index_end;

                    data.responseSummary.L3.push(new Summary(l3StartIndex, l3EndIndex, resultL3, 0));

                    // Condense L2 summaries by removing the ones that were just summarized
                    data.responseSummary.L2.splice(-l3Settings.frequency);
                    logger.info(`L3 summary created. ${l3Settings.frequency} L2 summaries have been condensed.`);
                } else {
                    logger.warn("L3 summary generation failed. L2 summaries will be kept for next attempt.");
                }
            }
            // --- END L3 TRIGGER ---

            if (sam_db && sam_db.isInitialized) data.jsondb = sam_db.export();

            setTimeout(() => { sam_set_data(data); }, 100);

            await eventSource.emit(SAM_EVENTS.INV);
            return true;
        }
        return false;
    }

    const handlers = {
        handleGenerationStarted: async (type, options, dry_run) => {
            if (dry_run) current_run_is_dry = true;
            else current_run_is_dry = false;
        },
        handleGenerationEnded: async () => {
            if (current_run_is_dry) { current_run_is_dry = false; return; }
            await SAM_FSM.triggerCheck();
        },
        handleGenerationStopped: async () => {
            if (current_run_is_dry) return;
            SAM_FSM.handleInterruption();
        },
        handleSwipe: async () => {
            SAM_FSM.handleInterruption();
        }
    };

    // --- API PRESET & SETTINGS MANAGEMENT FUNCTIONS ---
    async function sam_save_api_preset(name, config) {
        if (!apiManager) {
            logger.error("Cannot save preset, APIManager not initialized.");
            return false;
        }
        try {
            apiManager.savePreset(name, config);
            logger.info(`API preset "${name}" saved.`);
            return true;
        } catch (e) {
            logger.error("Failed to save API preset:", e);
            toastr.error(`Failed to save preset: ${e.message}`);
            return false;
        }
    }

    async function sam_delete_api_preset(name) {
        if (!apiManager) return false;
        const result = apiManager.deletePreset(name);
        if (result) logger.info(`API preset "${name}" deleted.`);
        return result;
    }

    function sam_get_all_api_presets() {
        if (!apiManager) return [];
        return apiManager.getAllPresets();
    }

    async function sam_set_active_preset(presetName) {
        await saveSamSettings('summary_api_preset', presetName);
        toastr.success(`SAM active preset set to: ${presetName}`);
    }
    
    /**
     * Exports all settings for the extension, EXCLUDING the API connection presets.
     * @returns {object} A JSON object of the current settings.
     */
    function sam_export_all_settings() {
        const allSettings = loadSamSettings();
        const settingsToExport = _.cloneDeep(allSettings);
        
        // Exclude the sensitive/user-specific connection presets
        delete settingsToExport.api_presets;

        logger.info("Exporting all settings (excluding API presets).");
        return settingsToExport;
    }

    /**
     * Sets all settings for the extension from an incoming JSON object, 
     * EXCLUDING the API connection presets, which are preserved.
     * @param {object} newSettings - A settings object to apply.
     */
    async function sam_set_all_settings(newSettings) {
        if (typeof newSettings !== 'object' || newSettings === null) {
            toastr.error("SAM: Invalid settings object provided.");
            logger.error("sam_set_all_settings received invalid data.", newSettings);
            return;
        }

        const currentSettings = loadSamSettings();
        const preservedPresets = currentSettings.api_presets; // Keep existing presets

        // Create the final settings object by merging the new settings
        // with the preserved presets.
        const finalSettings = { ...newSettings, api_presets: preservedPresets };

        // Replace the entire settings block for the module
        extensionSettings[MODULE_NAME] = finalSettings;
        saveSettingsDebounced();
        
        toastr.success("SAM: All settings have been imported successfully!");
        logger.info("Imported all settings (API presets were preserved).");

        // Force a refresh of dependent components
        await eventSource.emit(SAM_EVENTS.INV);
    }

    module.exports = {
        // Data and State
        sam_get_data,
        sam_set_data,
        sam_summary,
        sam_is_in_use,
        sam_get_status,

        // Settings
        sam_get_settings: loadSamSettings,
        sam_set_setting: saveSamSettings,
        sam_export_all_settings,
        sam_set_all_settings,
        
        // API Presets
        sam_save_api_preset,
        sam_delete_api_preset,
        sam_get_all_api_presets,
        sam_set_active_preset
    };

    (() => {
        $(async () => {
            console.log("SAM: DOM content loaded. Initializing...");
            try {
                const settings = loadSamSettings();
                await initializeDatabase();

                // Initialize APIManager with presets from settings and a callback to save them back.
                apiManager = new APIManager({
                    initialPresets: settings.api_presets,
                    onUpdate: async (updatedPresets) => {
                        await saveSamSettings('api_presets', updatedPresets);
                        logger.info("API presets were updated and saved to extension settings.");
                    }
                });

                eventSource.on(eventTypes.GENERATION_STARTED, handlers.handleGenerationStarted);
                eventSource.on(eventTypes.GENERATION_ENDED, handlers.handleGenerationEnded);
                eventSource.on(eventTypes.GENERATION_STOPPED, handlers.handleGenerationStopped);
                eventSource.on(eventSource.MESSAGE_SWIPED, handlers.handleSwipe);

                eventSource.on(SAM_EVENTS.EXT_ASK_STATUS, () => {
                    eventSource.emit(SAM_EVENTS.CORE_STATUS_RESPONSE, { state: sam_fsm_state });
                });

                registerMacro('SAM_serialized_memory', serialize_memory);
                registerMacro('SAM_serialized_db', serialize_db);


                logger.info(`V${SCRIPT_VERSION} FSM Utility loaded.`);
            } catch (error) {
                console.error("SAM: Initialization error.", error);
            }
        });
    })();
})();
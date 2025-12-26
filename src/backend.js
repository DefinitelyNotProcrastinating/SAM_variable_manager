// ============================================================================
// == Situational Awareness Manager (backend.js)
// ============================================================================
(function () {
    // --- CONFIGURATION ---
    const SCRIPT_NAME = "SAM-Util";
    const SCRIPT_VERSION = "5.4.5"; // Bumped for Schema Enforcement
    const { Summary } = require('./Summary.js');
    const { SAMDatabase } = require('./SAMDatabase.js');
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
        l2_summary_period: 20, 
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
    };

    let sam_settings = { ...DEFAULT_SETTINGS };
    let sam_db = null;

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
        SUMMARY_ERR : "SAM_SUMMARY_ERR"
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
        response_summary: { L1: [], L2: [], L3: [] }, 
        summary_progress: 0, 
        jsondb: null, 
        serialized_memory: "",
        serialized_db: "",
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
        triggerCheck: async function() {
            return this.Check();
        },

        Check: async function() {
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
            
            const last_progress = data.summary_progress || 0;
            const period = settings.l2_summary_period || 20;
            const current_msg_count = chat.length;
            const messages_since_last_summary = current_msg_count - last_progress;

            if (messages_since_last_summary >= period) {
                logger.info(`FSM Check: Threshold reached (Gap: ${messages_since_last_summary}/${period}). Initiating Summary.`);
                await this.startGeneration(last_progress, current_msg_count);
            } else {
                sam_fsm_state = SAM_STATES.IDLE;
            }
        },

        startGeneration: async function(startIndex, endIndex) {
            sam_fsm_state = SAM_STATES.GENERATING;
            try {
                const success = await processSummarizationRun(startIndex, endIndex);
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

        handleInterruption: function() {
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
    async function saveSamSettings(key, value) { var s = loadSamSettings(); _.set(s, key, value); saveSettingsDebounced(); }
    
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
            // Soft merge defaults without overwriting existing data
            _.defaultsDeep(data, INITIAL_STATE);
        }
        return data;
    }

    function sync_getVariables() {
        let data = SillyTavern.getContext().variables.local.get("SAM_data");
        if (!data || typeof data !== 'object') {
            data = goodCopy(INITIAL_STATE);
        } else {
            // Soft merge defaults without overwriting existing data
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
            
            // 1. Update Variables
            await sam_renewVariables(newData);

            // 2. Persist to Chat (Checkpoint logic)
            const chat = SillyTavern.getContext().chat;
            const lastAiMessage = chat[lastAiIndex];
            
            const cleanNarrative = lastAiMessage.mes.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            const newStateBlock = await chunkedStringify(newData);
            const finalContent = `${cleanNarrative}\n\n${STATE_BLOCK_START_MARKER}\n${newStateBlock}\n${STATE_BLOCK_END_MARKER}`;
            
            await TavernHelper.setChatMessages([{'message_id': lastAiIndex, 'message': finalContent}]);
            
            toastr.success("SAM API: Data block updated successfully!");
        } catch (error) {
            logger.error("[External API] sam_set_data failed.", error);
            toastr.error("SAM API: Failed to set data. Check console.");
        }
    };
    
    async function sam_summary() {
        logger.info("[SAM utils] Manual summary trigger");
        const chat = SillyTavern.getContext().chat;
        const data = await getVariables();
        SAM_FSM.startGeneration(data.summary_progress || 0, chat.length);
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

    async function serializeMemory(data) {
        let serialized_db = "尚未储存任何设定。";
        if (sam_db && sam_db.isInitialized) {
            const allMemos = await sam_db.getAllMemosAsObject();
            if (allMemos && Object.keys(allMemos).length > 0) serialized_db = Object.entries(allMemos).map(([k, v]) => `Key: ${k}\nContent: ${v}`).join('\n\n');
        }
        let serialized_memory_parts = [];
        const levels = Object.keys(data.response_summary || {}).sort().reverse();
        for (const level of levels) {
            for (const summary of (data.response_summary[level] || [])) {
                serialized_memory_parts.push(`[${level} Summary | Range: ${summary.index_begin}-${summary.index_end}]: ${summary.content}`);
            }
        }
        return { serialized_memory: serialized_memory_parts.join('\n'), serialized_db };
    }

    async function processSummarizationRun(startIndex, endIndex) {
        const settings = loadSamSettings();
        const chat = SillyTavern.getContext().chat;
        let data = await getVariables();
        data = goodCopy(data);

        // [FIX] Schema Enforcement for Summary
        // 1. Ensure response_summary object exists
        if (!data.response_summary || typeof data.response_summary !== 'object') {
            data.response_summary = { L1: [], L2: [], L3: [] };
        }
        
        // 2. Ensure Schema Levels exist (Append if missing)
        // If they don't exist, we create them as empty arrays.
        // If they exist, we keep them as is (to append later).

        if (!Array.isArray(data.response_summary.L1)) data.response_summary.L1 = [];
        if (!Array.isArray(data.response_summary.L2)) data.response_summary.L2 = [];
        if (!Array.isArray(data.response_summary.L3)) data.response_summary.L3 = [];

        const messagesToSummarize = chat.slice(startIndex, endIndex);
        if (messagesToSummarize.length === 0) return false;

        const contentString = messagesToSummarize.map(msg => {
            let processedMessage = msg.mes.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            if (settings.regexes && Array.isArray(settings.regexes)) {
                for (const regexObject of settings.regexes) {
                    if (regexObject.enabled && regexObject.regex_body) {
                        try { processedMessage = processedMessage.replace(new RegExp(regexObject.regex_body, 'g'), ''); } catch (e) {}
                    }
                }
            }
            return `${msg.name}: ${processedMessage}`;
        }).join('\n');

        const { serialized_db } = await serializeMemory(data);
        const prompt = substituteParamsExtended(settings.summary_prompt, { db_content: serialized_db, chat_content: contentString });

        const result = await generateQuietPrompt({ quietPrompt: prompt, skipWIAN: settings.skipWIAN_When_summarizing });
        
        if (!result || sam_fsm_state === SAM_STATES.ABORTED) {
            logger.warn("Summarization aborted/failed. FSM will Reset to IDLE.");
            return false;
        }

        const { summaryContent, newInserts } = parseAiResponseForL2(result);

        if (summaryContent) {
            // 3. Append to L2 (as per logic)
            data.response_summary.L2.push(new Summary(startIndex, endIndex, summaryContent, 0));
            
            if (newInserts && Array.isArray(newInserts)) {
                for (const item of newInserts) await sam_db.setMemo(item.key, item.content, item.keywords);
            }
            
            data.summary_progress = endIndex;

            const mem = await serializeMemory(data);
            data.serialized_memory = mem.serialized_memory;
            data.serialized_db = mem.serialized_db;
            if (sam_db && sam_db.isInitialized) data.jsondb = sam_db.export();

            logger.info("FINISHED UPDATING DATA");
            logger.info(data);

            // synchronization: Await for 100ms for the other guy to finish first. It'a light script, it will succeed.
            setTimeout(() => {
                sam_set_data(data);
            }, 100);


            await eventSource.emit(SAM_EVENTS.INV); // prompt for App.js to refresh
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
        handleGenerationStopped: async() => {
            if (current_run_is_dry) return;
            SAM_FSM.handleInterruption();
        },
        handleSwipe: async() => {
            SAM_FSM.handleInterruption();
        }
    };

    module.exports = {
        sam_get_data, 
        sam_set_data, 
        sam_summary, 
        sam_get_settings: loadSamSettings,
        sam_set_setting: saveSamSettings,
        sam_is_in_use,
        sam_get_status
    };

    (() => {
        $(async () => {
            console.log("SAM: DOM content loaded. Initializing FSM...");
            try {
                loadSamSettings();
                await initializeDatabase();

                eventSource.on(eventTypes.GENERATION_STARTED, handlers.handleGenerationStarted);
                eventSource.on(eventTypes.GENERATION_ENDED, handlers.handleGenerationEnded);
                eventSource.on(eventTypes.GENERATION_STOPPED, handlers.handleGenerationStopped);
                eventSource.on(eventSource.MESSAGE_SWIPED, handlers.handleSwipe);
                
                eventSource.on(SAM_EVENTS.EXT_ASK_STATUS, () => {
                    eventSource.emit(SAM_EVENTS.CORE_STATUS_RESPONSE, { state: sam_fsm_state });
                });

                registerMacro('SAM_serialized_memory',  () => {

                    return sync_getVariables()?.serialized_memory || "";

                });
                registerMacro('SAM_serialized_db',  () => {
                    return sync_getVariables()?.serialized_db || "" ;
                });

                logger.info(`V${SCRIPT_VERSION} FSM Utility loaded.`);
            } catch (error) {
                console.error("SAM: Initialization error.", error);
            }
        });
    })();
})();
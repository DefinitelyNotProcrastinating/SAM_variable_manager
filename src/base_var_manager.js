// ============================================================================
// == Situational Awareness Manager Util
// ============================================================================
// ****************************
// Required plugins: JS-slash-runner by n0vi028
// ****************************

(function () {
    // --- CONFIGURATION ---
    const SCRIPT_NAME = "SAM-Util";
    const SCRIPT_VERSION = "4.0.5";
    const JSON_REPAIR_URL = "https://cdn.jsdelivr.net/npm/jsonrepair/lib/umd/jsonrepair.min.js";

    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        disable_dtype_mutation: false,
        uniquely_identified: false,
        enable_auto_checkpoint: true,
        checkpoint_frequency: 20
    });

    let sam_settings = { ...DEFAULT_SETTINGS };

    // State block format markers
    const OLD_START_MARKER = '<!--<|state|>';
    const OLD_END_MARKER = '</|state|>-->';
    const NEW_START_MARKER = '$$$$$$data_block$$$$$$';
    const NEW_END_MARKER = '$$$$$$data_block_end$$$$$$';
    const STATE_BLOCK_START_MARKER = NEW_START_MARKER;
    const STATE_BLOCK_END_MARKER = NEW_END_MARKER;
    
    // [NEW] Logic Gate Constant
    const SAM_ACTIVATION_KEY = "__SAM_IDENTIFIER__";
    const MODULE_NAME = 'sam_extension';


    var { eventSource, eventTypes, extensionSettings,saveSettingsDebounced } = SillyTavern.getContext();
    var _ = require('lodash');

    // Flag to pause execution based on World Info presence
    var go_flag = false;
    
    // [NEW] Callback for React UI
    var _ui_update_callback = null;

    // Regexes for parsing and removing state blocks from messages
    const STATE_BLOCK_PARSE_REGEX = new RegExp(`(?:${OLD_START_MARKER.replace(/\|/g, '\\|')}|${NEW_START_MARKER.replace(/\$/g, '\\$')})\\s*([\\s\\S]*?)\\s*(?:${OLD_END_MARKER.replace(/\|/g, '\\|')}|${NEW_END_MARKER.replace(/\$/g, '\\$')})`, 's');
    const STATE_BLOCK_REMOVE_REGEX = new RegExp(`(?:${OLD_START_MARKER.replace(/\|/g, '\\|')}|${NEW_START_MARKER.replace(/\$/g, '\\$')})\\s*[\\s\\S]*?\\s*(?:${OLD_END_MARKER.replace(/\|/g, '\\|')}|${NEW_END_MARKER.replace(/\$/g, '\\$')})`, 'sg');
    const COMMAND_START_REGEX = /@\.(SET|ADD|DEL|SELECT_ADD|DICT_DEL|SELECT_DEL|SELECT_SET|TIME|TIMED_SET|RESPONSE_SUMMARY|CANCEL_SET|EVENT_BEGIN|EVENT_END|EVENT_ADD_PROC|EVENT_ADD_DEFN|EVENT_ADD_MEMBER|EVENT_SUMMARY|EVAL)\b\s*\(/gim;
    
    // The pure state object, stripped of configuration.
    const INITIAL_STATE = { static: {}, time: "", volatile: [], responseSummary: [], func: [], events: [], event_counter: 0 };

    // Performance tuning based on device type
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const DELAY_MS = isMobileDevice ? 10 : 5;
    const COMMAND_BATCH_SIZE = isMobileDevice ? 3 : 5;
    const REGEX_MATCH_INTERVAL = isMobileDevice ? 2 : 3;

    // --- STATE & LIFECYCLE MANAGEMENT ---
    let isProcessingState = false;
    let isDispatching = false;
    let isCheckpointing = false;
    let prevState = null;
    const event_queue = [];
    const executionLog = [];
    let generationWatcherId = null;

    const STATES = { IDLE: "IDLE", AWAIT_GENERATION: "AWAIT_GENERATION", PROCESSING: "PROCESSING" };
    var curr_state = STATES.IDLE;
    const WATCHER_INTERVAL_MS = 3000;
    const FORCE_PROCESS_COMPLETION = "FORCE_PROCESS_COMPLETION";
    const HANDLER_STORAGE_KEY = `__SAM_V4_EVENT_HANDLER_STORAGE__`;
    const SESSION_STORAGE_KEY = "__SAM_ID__";
    var session_id = "";

    const logger = {
        info: (...args) => {
            const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
            executionLog.push({ level: 'INFO', timestamp: new Date().toISOString(), message });
            console.log(`[${SCRIPT_NAME} ${SCRIPT_VERSION}]`, ...args);
        },
        warn: (...args) => {
            const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
            executionLog.push({ level: 'WARN', timestamp: new Date().toISOString(), message });
            console.warn(`[${SCRIPT_NAME} ${SCRIPT_VERSION}]`, ...args);
        },
        error: (...args) => {
            const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
            executionLog.push({ level: 'ERROR', timestamp: new Date().toISOString(), message });
            console.error(`[${SCRIPT_NAME} ${SCRIPT_VERSION}]`, ...args);
        }
    };


    function loadSamSettings() {
        if (!extensionSettings[MODULE_NAME]) {
            extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
        }
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
            if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
                extensionSettings[MODULE_NAME][key] = DEFAULT_SETTINGS[key];
            }
        }
        return extensionSettings[MODULE_NAME];
    }

    async function saveSamSettings(key, value){
        try {
            var settings = loadSamSettings();
            if(typeof key === 'object' && key !== null && !Array.isArray(key)) {
                 Object.assign(settings, key);
            } else {
                 settings[key] = value;
            }
            saveSettingsDebounced();
            logger.info("SAM settings saved successfully.");
        } catch (error) {
            logger.error("Failed to save SAM settings.", error);
            toastr.error("Failed to save SAM settings.");
        }
    }

    async function checkWorldInfoActivation() {
        try {
            const wi = await getCurrentWorldbookName();
            
            let wiidx = 0;
            let verified_go_flag = false;
            while (wi.entries[`${wiidx}`]){
                if (wi.entries[`${wiidx}`].comment === SAM_ACTIVATION_KEY) {
                    verified_go_flag = true;
                    logger.info(`[SAM] Activation Key "${SAM_ACTIVATION_KEY}" ${go_flag ? 'FOUND' : 'MISSING'}. Script is ${go_flag ? 'ACTIVE' : 'DORMANT'}.`);
                    break;
                }
                wiidx ++;
            }

            if (!verified_go_flag){
                logger.info(`[SAM] Did not find activation key in card`);
            }
            go_flag = verified_go_flag;

            

        } catch (e) {
            logger.error("Error checking world info activation:", e);
            go_flag = false;
        }
    }



    async function getVariables(){
        if (!SillyTavern.getContext().variables.local.get("SAM_data")){
            return {};
        }
        let data = SillyTavern.getContext().variables.local.get("SAM_data");
        return data;
    }

    async function setAllVariables(newData){
        if (!newData || typeof newData !== 'object'){
            return;
        }
        SillyTavern.getContext().variables.local.set("SAM_data", newData);
        return 0;
    }
    
    // [MODIFIED] Trigger UI callback here to ensure frontend sees exactly what is in memory
    async function sam_renewVariables(SAM_data){
        let curr_variables = await getVariables();
        if (!curr_variables || !curr_variables.SAM_data){
            console.log("[SAM] tried to renew, but SAM_data variable not found! Initializing.");
            curr_variables = { SAM_data: {} };
        }
        _.set(curr_variables, "SAM_data", goodCopy(SAM_data));
        await setAllVariables(curr_variables);

        // [NEW] Trigger React UI Update
        if (_ui_update_callback && typeof _ui_update_callback === 'function' && go_flag) {
            // setTimeout ensures we don't block the logic loop

            
            setTimeout(() => _ui_update_callback(), 0);
        }
        return 0;
    }

    // --- HELPER FUNCTIONS ---
    async function loadExternalLibrary(url, globalName) {
        if (window[globalName]) return;
        logger.info(`[SAM] Downloading external library: ${globalName}...`);
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => {
                logger.info(`[SAM] Library ${globalName} loaded successfully.`);
                resolve();
            };
            script.onerror = () => {
                const err = new Error(`Failed to load script: ${url}`);
                logger.error(err);
                reject(err);
            };
            document.head.appendChild(script);
        });
    }

    function extractBalancedParams(text, startIndex) {
        let depth = 1;
        let inString = false;
        let quoteChar = '';
        let i = startIndex;
        const len = text.length;
        while (i < len && depth > 0) {
            const c = text[i];
            if (inString) {
                if (c === quoteChar) {
                    let backslashCount = 0;
                    let j = i - 1;
                    while (j >= startIndex && text[j] === '\\') {
                        backslashCount++;
                        j--;
                    }
                    if (backslashCount % 2 === 0) {
                        inString = false;
                    }
                }
            } else {
                if (c === '"' || c === "'" || c === '`') {
                    inString = true;
                    quoteChar = c;
                } else if (c === '(') {
                    depth++;
                } else if (c === ')') {
                    depth--;
                }
            }
            i++;
        }
        if (depth === 0) {
            return {
                params: text.substring(startIndex, i - 1),
                endIndex: i
            };
        }
        return null;
    }

    function extractCommandsFromText(messageContent) {
        COMMAND_START_REGEX.lastIndex = 0;
        let match;
        const commands = [];
        while ((match = COMMAND_START_REGEX.exec(messageContent)) !== null) {
            const commandType = match[1].toUpperCase();
            const openParenIndex = match.index + match[0].length;
            const extraction = extractBalancedParams(messageContent, openParenIndex);
            if (extraction) {
                commands.push({ type: commandType, params: extraction.params.trim() });
                COMMAND_START_REGEX.lastIndex = extraction.endIndex;
            } else {
                logger.warn(`[SAM] Malformed command or unbalanced parentheses for ${commandType} at index ${match.index}. Skipping.`);
            }
        }
        return commands;
    }

    function stopGenerationWatcher() {
        if (generationWatcherId) {
            logger.info('[SAM Watcher] Stopping generation watcher.');
            clearInterval(generationWatcherId);
            generationWatcherId = null;
        }
    }
    
    function startGenerationWatcher() {
        stopGenerationWatcher();
        logger.info(`[SAM] [Await watcher] Starting generation watcher. Will check UI every ${WATCHER_INTERVAL_MS / 1000}s.`);
        const GENERATION_TIMEOUT_MS = 300000;
        const watcherStartTime = Date.now();
        generationWatcherId = setInterval(() => {
            const isUiGenerating = $('#mes_stop').is(':visible');
            const elapsedTime = Date.now() - watcherStartTime;
            if (elapsedTime > GENERATION_TIMEOUT_MS) {
                logger.error('[SAM Watcher] Generation timeout! Forcing completion.');
                stopGenerationWatcher();
                unifiedEventHandler(FORCE_PROCESS_COMPLETION);
                return;
            }
            if (curr_state === STATES.AWAIT_GENERATION && !isUiGenerating) {
                logger.warn('[SAM] [Await watcher] DETECTED DESYNC! Forcing state transition.');
                stopGenerationWatcher();
                unifiedEventHandler(FORCE_PROCESS_COMPLETION);
            } else if (curr_state !== STATES.AWAIT_GENERATION) {
                logger.info('[SAM Watcher] FSM is no longer awaiting generation. Shutting down watcher.');
                stopGenerationWatcher();
            }
        }, WATCHER_INTERVAL_MS);
    }
    
    
    function parseStateFromMessage(messageContent) {
        if (!messageContent) return null;
        const match = messageContent.match(STATE_BLOCK_PARSE_REGEX);
        if (match && match[1]) {
            try {
                const parsed = JSON.parse(match[1].trim());
                return {
                    static: parsed.static ?? {},
                    time: parsed.time ?? "",
                    volatile: parsed.volatile ?? [],
                    responseSummary: parsed.responseSummary ?? [],
                    func: parsed.func ?? [],
                    events: parsed.events ?? [],
                    event_counter: parsed.event_counter ?? 0
                };
            } catch (error) {
                logger.error("Failed to parse state JSON from message. This might be a corrupted checkpoint.", error);
                return null;
            }
        }
        return null;
    }

    async function findLatestState(chatHistory, targetIndex = chatHistory.length - 1) {
        logger.info(`[SAM] Reconstructing state up to index ${targetIndex}...`);
        let baseState = _.cloneDeep(INITIAL_STATE);
        let checkpointIndex = -1;
        if (targetIndex < 0) {
            const baseData = await getBaseDataFromWI();
            if (baseData) {
                logger.info("[SAM] Base data from World Info found for new chat. Merging into initial state.");
                baseState = _.merge({}, baseState, baseData);
            }
            return baseState;
        }
        for (let i = targetIndex; i >= 0; i--) {
            const message = chatHistory[i];
            if (message.is_user) continue;
            const stateFromBlock = parseStateFromMessage(message.mes);
            if (stateFromBlock) {
                logger.info(`[SAM] Found checkpoint at index ${i}.`);
                baseState = stateFromBlock;
                checkpointIndex = i;
                break;
            }
        }
        if (checkpointIndex === -1) {
            logger.warn("[SAM] No checkpoint found. Reconstructing from the beginning of AI messages.");
            if (targetIndex >= 0) {
                const baseData = await getBaseDataFromWI();
                if (baseData) {
                    logger.info("[SAM] Base data from World Info found. Merging into initial state.");
                    baseState = _.merge({}, baseState, baseData);
                }
            }
        }
        const commandsToApply = [];
        const startIndex = checkpointIndex === -1 ? 0 : checkpointIndex + 1;
        for (let i = startIndex; i <= targetIndex; i++) {
            const message = chatHistory[i];
            if (!message || message.is_user) continue;
            const messageCommands = extractCommandsFromText(message.mes);
            if (messageCommands.length > 0) {
                commandsToApply.push(...messageCommands);
            }
        }
        logger.info(`[SAM] Found ${commandsToApply.length} commands to apply on top of the base state from index ${checkpointIndex}.`);
        const reconstructedState = await applyCommandsToState(commandsToApply, baseState);
        logger.info(`[SAM] State reconstruction complete up to index ${targetIndex}.`);
        return reconstructedState;
    }

    function findLatestUserMsgIndex() {
        for (let i = SillyTavern.getContext().chat.length - 1; i >= 0; i--) {
            if (SillyTavern.getContext().chat[i].is_user) { return i; }
        }
        return -1;
    }

    function goodCopy(state) {
        if (!state) return _.cloneDeep(INITIAL_STATE);
        try {
            return JSON.parse(JSON.stringify(state));
        } catch (error) {
            logger.warn('goodCopy: JSON method failed, falling back to _.cloneDeep', error);
            return _.cloneDeep(state);
        }
    }


    async function sam_getWorldbook(name) {
        let index = 0;
        for (let i = 0; i < SillyTavern.getContext().characters.length; i++) {
            if (SillyTavern.getContext().characters[i].name === name) {
                index = i;
                break;
            }
        }
        if (index < 0 || index >= SillyTavern.getContext().characters.length) {
            return {};
        }
        let winame = SillyTavern.getContext().characters[index].data.extensions.world
        let wi = SillyTavern.getContext().loadWorldInfo(winame);
        return wi
    }

    async function getCurrentWorldbookName() {
        let curr_name = SillyTavern.getContext().characters[SillyTavern.getContext().characterId].name;
        return await sam_getWorldbook(curr_name);
    }

    async function getBaseDataFromWI() {
        const WI_ENTRY_NAME = "__SAM_base_data__";
        try {
            const wi = await getCurrentWorldbookName();
            if (!wi || !Array.isArray(wi)) {
                return null;
            }
            const baseDataEntry = wi.find(entry => entry.name === WI_ENTRY_NAME);
            if (!baseDataEntry || !baseDataEntry.content) {
                return null;
            }
            try {
                const parsedData = JSON.parse(baseDataEntry.content);
                logger.info(`Successfully parsed base data from "${WI_ENTRY_NAME}".`);
                return parsedData;
            } catch (jsonError) {
                logger.error(`Base data check: Failed to parse JSON from entry "${WI_ENTRY_NAME}".`, jsonError);
                return null;
            }
        } catch (error) {
            logger.error(`Base data check: An unexpected error occurred while fetching world info.`, error);
            return null;
        }
    }
    


    async function chunkedStringify(obj) {
        return new Promise((resolve) => {
            setTimeout(() => {
                try {
                    resolve(JSON.stringify(obj, null, 2));
                } catch (error) {
                    logger.error('JSON stringify failed:', error);
                    resolve('{}');
                }
            }, DELAY_MS);
        });
    }

    async function loadStateToMemory(targetIndex) {
        logger.info(`Loading state into memory up to index ${targetIndex}.`);
        if (targetIndex === "{{lastMessageId}}") { targetIndex = SillyTavern.getContext().chat.length - 1; }
        let state = await findLatestState(SillyTavern.getContext().chat, targetIndex);
        if (targetIndex <= 0) {
            const baseData = await getBaseDataFromWI();
            if (baseData) {
               logger.info("[SAM] Base data found. Merging into current state.");
               state = _.merge({}, baseData, state);
            }
        }
        await sam_renewVariables(state);
        logger.info(`SAM_data in global variables updated.`);
        return state;
    }

    async function findLastAiMessageAndIndex(beforeIndex = -1) {
        const chat = SillyTavern.getContext().chat;
        const searchUntil = (beforeIndex === -1) ? chat.length : beforeIndex;
        for (let i = searchUntil - 1; i >= 0; i--) {
            if (chat[i] && chat[i].is_user === false) return i;
        }
        return -1;
    }

    async function sync_latest_state() {
        if (!go_flag) {
            logger.info("[Sync] Sync skipped, script is dormant (No Identifier).");
            return;
        }
        var lastlastAIMessageIdx = await findLastAiMessageAndIndex();
        await loadStateToMemory(lastlastAIMessageIdx);
    }

    async function dispatcher(event, ...event_params) {
        if (!go_flag && event !== eventTypes.CHAT_COMPLETION_PROMPT_READY) {
            return;
        }

        if (!dispatcher.deviceLogged) {
            logger.info(`[SAM] Perf Settings - Delay: ${DELAY_MS}ms, Batch: ${COMMAND_BATCH_SIZE}`);
            dispatcher.deviceLogged = true;
        }
        try {
            switch (curr_state) {
                case STATES.IDLE:
                    switch (event) {
                        case eventTypes.CHAT_COMPLETION_PROMPT_READY:
                            curr_state = STATES.AWAIT_GENERATION;
                            startGenerationWatcher();
                            break;
                        case eventTypes.MESSAGE_SENT:
                        case eventTypes.GENERATION_STARTED:
                            if (event_params[2]) { return; }
                            if (event_params[0] === "swipe" || event_params[0] === "regenerate") {
                                await loadStateToMemory(findLatestUserMsgIndex());
                                
                                prevState = goodCopy((await getVariables()).SAM_data);
                            } 
                            curr_state = STATES.AWAIT_GENERATION;
                            startGenerationWatcher();
                            break;
                        case eventTypes.MESSAGE_SWIPED:
                        case eventTypes.MESSAGE_DELETED:
                        case eventTypes.MESSAGE_EDITED:
                            await sync_latest_state();
                            prevState = goodCopy((await getVariables()).SAM_data);
                            break;
                        case eventTypes.CHAT_CHANGED:
                            go_flag = false;
                            prevState = null;
                            logger.info("[SAM] Chat changed. Resetting to dormant state.");
                            break;
                    }
                    break;
                case STATES.AWAIT_GENERATION:
                    switch (event) {
                        case eventTypes.GENERATION_STOPPED:
                        case FORCE_PROCESS_COMPLETION:
                        case eventTypes.GENERATION_ENDED:
                            stopGenerationWatcher();
                            curr_state = STATES.PROCESSING;


                            curr_state = STATES.IDLE;
                            prevState = null;
                            break;
                        case eventTypes.CHAT_CHANGED:
                            stopGenerationWatcher();
                            go_flag = false;
                            prevState = null;
                            curr_state = STATES.IDLE;
                            break;
                    }
                    break;
                case STATES.PROCESSING:
                    logger.warn(`[PROCESSING] Received event ${event} while processing. Ignoring.`);
                    break;
            }
        } catch (e) {
            stopGenerationWatcher();
            logger.error(`[Dispatcher] FSM Scheduling failed. Error: ${e}`);
            curr_state = STATES.IDLE;
            prevState = null;
        }
    }
    
    async function unifiedEventHandler(event, ...args) {
        if (!sam_settings.enabled) {
            return;
        }
        if (event_queue.length > 100) {
            event_queue.splice(0, 50);
        }
        event_queue.push({ event_id: event, args: [...args] });
        await unified_dispatch_executor();
    }
    
    async function unified_dispatch_executor() {
        if (isDispatching) { return; }
        isDispatching = true;
        const MAX_EVENTS_PER_BATCH = 20;
        let processedCount = 0;
        while (event_queue.length > 0 && processedCount < MAX_EVENTS_PER_BATCH) {
            const { event_id, args } = event_queue.shift();
            try {
                await dispatcher(event_id, ...args);
                processedCount++;
            }
            catch (error) {
                logger.error(`[UDE] Unhandled error during dispatch of ${event_id}:`, error);
                curr_state = STATES.IDLE;
                prevState = null;
            }
        }
        isDispatching = false;
        if (event_queue.length > 0) {
            setTimeout(() => unified_dispatch_executor(), 10);
        }
    }

    const handlers = {
        handlePromptReady: async () => {
            logger.info("[SAM] Prompt Ready Event Detected. Checking activation...");
            await checkWorldInfoActivation();
            if (go_flag) {
                logger.info("[SAM] Identifier found. Syncing state from history before generation...");
                await sync_latest_state();
                prevState = goodCopy((await getVariables()).SAM_data);
                await unifiedEventHandler(eventTypes.CHAT_COMPLETION_PROMPT_READY);
            }

            if (_ui_update_callback){
                console.log("UI CALLBACK TRIGGER");
                setTimeout(() => _ui_update_callback(), 0);
                console.log("UI CALLBACK TRIGGER COMPLETE");
            }

        },
		handleGenerationStarted: async (ev, options, dry_run) => { await unifiedEventHandler(eventTypes.GENERATION_STARTED, ev, options, dry_run); },
		handleGenerationEnded: async () => { await unifiedEventHandler(eventTypes.GENERATION_ENDED); },
		handleMessageSwiped: () => { setTimeout(async () => { await unifiedEventHandler(eventTypes.MESSAGE_SWIPED); }, 0); },
		handleMessageDeleted: (message) => { setTimeout(async () => { await unifiedEventHandler(eventTypes.MESSAGE_DELETED, message); }, 0); },
		handleMessageEdited: () => { setTimeout(async () => { await unifiedEventHandler(eventTypes.MESSAGE_EDITED); }, 0); },
		handleChatChanged: () => { setTimeout(async () => { await unifiedEventHandler(eventTypes.CHAT_CHANGED); }, 10); },
		handleMessageSent: () => { setTimeout(async () => { await unifiedEventHandler(eventTypes.MESSAGE_SENT); }, 0); },
		handleGenerationStopped: () => { setTimeout(async () => { await unifiedEventHandler(eventTypes.GENERATION_STOPPED); }, 0); },
	};
    
    // ============================================================================
    // == EXPOSED API FOR EXTERNAL SCRIPTS
    // ============================================================================
    
    // [NEW] API to register callback
    function sam_register_update_callback(callback) {
        if (typeof callback === 'function') {
            _ui_update_callback = callback;
            logger.info("UI Update Callback registered.");
        } else {
            logger.warn("Attempted to register an invalid UI callback.");
        }
    }

    function sam_get_state() { return curr_state; };

    async function sam_get_data() {
        try {
            const variables = await getVariables();
            return variables;
        } catch (error) {
            logger.error("[External API] Failed to get SAM_data from variables.", error);
            return null;
        }
    };

    async function sam_set_data(newData) {
        if (typeof newData !== 'object' || newData === null) {
            toastr.error("SAM API: sam_set_data requires a valid object.");
            return;
        }
        if (isCheckpointing || isProcessingState || curr_state !== STATES.IDLE) {
            toastr.warning("SAM is busy. Cannot set data now.");
            return;
        }
        isCheckpointing = true;
        try {
            const lastAiIndex = await findLastAiMessageAndIndex();
            if (lastAiIndex === -1) {
                toastr.error("SAM API: Cannot set data. No AI message found.");
                return;
            }
            const lastAiMessage = SillyTavern.getContext().chat[lastAiIndex];
            const cleanNarrative = lastAiMessage.mes.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            const newStateBlock = await chunkedStringify(newData);
            const finalContent = `${cleanNarrative}\n\n${STATE_BLOCK_START_MARKER}\n${newStateBlock}\n${STATE_BLOCK_END_MARKER}`;
            await TavernHelper.setChatMessages([{'message_id': lastAiIndex, 'message': finalContent}]);
            await sam_renewVariables(newData);
            toastr.success("SAM API: Data block updated successfully!");
        } catch (error) {
            logger.error("[External API] sam_set_data failed.", error);
            toastr.error("SAM API: Failed to set data. Check console.");
        } finally {
            isCheckpointing = false;
        }
    };
    
    function sam_abort_cycle() { 
        stopGenerationWatcher();
        curr_state = STATES.IDLE;
        isDispatching = false;
        event_queue.length = 0;
        prevState = null;
        checkWorldInfoActivation().then(() => { if(go_flag) sync_latest_state(); });
    };

    async function sam_enable(){
        sam_settings.enabled = true;
        toastr.success("Situational Awareness Manager has been enabled.");
        await saveSamSettings();
        await sync_latest_state();
    }

    async function sam_disable(){
        sam_settings.enabled = false;
        toastr.success("Situational Awareness Manager has been disabled.");
        await saveSamSettings();
    }

    async function sam_set_setting(key, value) {
        await saveSamSettings(key, value);
    }

    async function sam_is_in_use(){
        await checkWorldInfoActivation();
        return go_flag;
    }
    
    function sam_get_settings() {
        return loadSamSettings();
    }

    module.exports = {
        sam_get_state,
        sam_get_data,
        sam_set_data,
        sam_abort_cycle,
        sam_enable,
        sam_disable,
        sam_is_in_use,
        sam_set_setting,
        sam_get_settings,
        sam_register_update_callback, // [NEW] Export
    };

    (() => {
        $(async () => {
            console.log("SAM: DOM content loaded. Initializing...");
            try {
                loadSamSettings();

                window[HANDLER_STORAGE_KEY] = handlers;
                
                logger.info(`V${SCRIPT_VERSION} Utility loaded.`);
                session_id = JSON.stringify(new Date());
                sessionStorage.setItem(SESSION_STORAGE_KEY, session_id);

            } catch (error) {
                console.error("SAM: A fatal error occurred during initialization.", error);
            }
        });
    })();

})();
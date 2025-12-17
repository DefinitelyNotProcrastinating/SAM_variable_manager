// ============================================================================
// == Situational Awareness Manager
// == Version: 4.0.5
// ==
// == This script provides a robust state management system for SillyTavern.
// == It now features a revolutionary checkpointing system to significantly
// == reduce chat history bloat.
// ==
// == [FIX in 4.0.5] Corrected settings persistence to use the standard 'extension_settings' object.
// == [NEW in 4.0.4] Event-Driven Architecture. Data loading is deferred until
// ==                'chat_completion_prompt_ready'.
// == [NEW in 4.0.4] Logic now gated by World Info entry "__SAM_IDENTIFIER__".
// == [NEW in 4.0.3] Moved all configuration to a dedicated extension settings file.
// == [NEW in 4.0.3] Added API functions to get/set individual settings.
// == [NEW in 4.0.2] Adds persistent enable/disable flag.
// ============================================================================
// ****************************
// Required plugins: JS-slash-runner by n0vi028
// ****************************

(function () {
    // --- CONFIGURATION ---
    const SCRIPT_NAME = "Situational Awareness Manager";
    const SCRIPT_VERSION = "4.0.5";
    const JSON_REPAIR_URL = "https://cdn.jsdelivr.net/npm/jsonrepair/lib/umd/jsonrepair.min.js";

    // NEW: Centralized settings management


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


    var { eventSource, event_types, extensionSettings,saveSettingsDebounced } = SillyTavern.getContext();
    var _ = require('lodash');

    // Flag to pause execution based on World Info presence
    var go_flag = false;

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
        // Initialize settings if they don't exist
        if (!extensionSettings[MODULE_NAME]) {
            extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
        }

        // Ensure all default keys exist (helpful after updates)
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
            if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
                extensionSettings[MODULE_NAME][key] = DEFAULT_SETTINGS[key];
            }
        }

        return extensionSettings[MODULE_NAME];
    }


    async function saveSamSettings(new_settings_json) {
        try {
            // Directly assign the current settings object to the global settings object.
            // SillyTavern's framework handles the actual persistence to storage.
            const settings = loadSamSettings();

            settings = new_settings_json;
            saveSettingsDebounced();

            logger.info("SAM settings saved successfully.");
        } catch (error) {
            logger.error("Failed to save SAM settings.", error);
            toastr.error("Failed to save SAM settings.");
        }
    }
    async function saveSamSettings(key, value){
        try {
            // Directly assign the current settings object to the global settings object.
            // SillyTavern's framework handles the actual persistence to storage.
            var settings = loadSamSettings();

            settings[key] = value;
            saveSettingsDebounced();

            logger.info("SAM settings saved successfully.");
        } catch (error) {
            logger.error("Failed to save SAM settings.", error);
            toastr.error("Failed to save SAM settings.");
        }
    }








    // [MODIFIED] Replaces updateGoFlag. Checks strictly for World Info entry.
    async function checkWorldInfoActivation() {
        try {
            const wi = await getCurrentWorldbookName();
            if (wi && Array.isArray(wi)) {
                // Check if any entry has the magic name
                const hasIdentifier = wi.some(entry => entry.name === SAM_ACTIVATION_KEY);
                if (go_flag !== hasIdentifier) {
                    go_flag = hasIdentifier;
                    logger.info(`[SAM] Activation Key "${SAM_ACTIVATION_KEY}" ${go_flag ? 'FOUND' : 'MISSING'}. Script is ${go_flag ? 'ACTIVE' : 'DORMANT'}.`);
                }
            } else {
                go_flag = false;
            }
        } catch (e) {
            logger.error("Error checking world info activation:", e);
            go_flag = false;
        }
    }

    const cleanupPreviousInstance = () => {
        const oldHandlers = window[HANDLER_STORAGE_KEY];
        if (!oldHandlers) { logger.info("No previous instance found. Starting fresh."); return; }
        logger.info("Found a previous instance. Removing its event listeners to prevent duplicates.");
        eventSource.off(event_types.GENERATION_STARTED, oldHandlers.handleGenerationStarted);
        eventSource.off(event_types.GENERATION_ENDED, oldHandlers.handleGenerationEnded);
        eventSource.off(event_types.MESSAGE_SWIPED, oldHandlers.handleMessageSwiped);
        eventSource.off(event_types.MESSAGE_DELETED, oldHandlers.handleMessageDeleted);
        eventSource.off(event_types.MESSAGE_EDITED, oldHandlers.handleMessageEdited);
        eventSource.off(event_types.CHAT_CHANGED, oldHandlers.handleChatChanged);
        eventSource.off(event_types.MESSAGE_SENT, oldHandlers.handleMessageSent);
        eventSource.off(event_types.GENERATION_STOPPED, oldHandlers.handleGenerationStopped);
        
        // Remove the new listener
        eventSource.off(event_types.CHAT_COMPLETION_PROMPT_READY, oldHandlers.handlePromptReady);
        
        delete window[HANDLER_STORAGE_KEY];
    };

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

    async function sam_renewVariables(SAM_data){
        let curr_variables = await getVariables();
        if (!curr_variables || !curr_variables.SAM_data){
            console.log("[SAM] tried to renew, but SAM_data variable not found!");
            return -1;
        }
        _.set(curr_variables, "SAM_data", goodCopy(SAM_data));
        await setAllVariables(curr_variables);
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
    
    async function getRoundCounter() { return SillyTavern.getContext().chat.length - 1; }
    
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

    function getActiveEvent(state) {
        if (!state.events || state.events.length === 0) return null;
        for (let i = state.events.length - 1; i >= 0; i--) {
            if (state.events[i].status === 0) {
                return state.events[i];
            }
        }
        return null;
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

    async function runSandboxedFunction(funcName, params, state) {
        const funcDef = state.func?.find(f => f.func_name === funcName);
        if (!funcDef) { logger.warn(`EVAL: Function '${funcName}' not found.`); return; }
        const timeout = funcDef.timeout ?? 2000;
        const allowNetwork = funcDef.network_access === true;
        const rawParamNames = funcDef.func_params || [];
        let formalParamNames = [];
        let restParamName = null;
        for (const param of rawParamNames) {
            if (param.startsWith('...')) { restParamName = param.substring(3); }
            else { formalParamNames.push(param); }
        }
        let bodyPrologue = '';
        if (restParamName) {
            const startIndex = formalParamNames.length;
            bodyPrologue = `const ${restParamName} = Array.from(arguments).slice(${4 + startIndex});\n`;
        }
        const executionPromise = new Promise(async (resolve, reject) => {
            try {
                const networkBlocker = () => { throw new Error('EVAL: Network access is disabled for this function.'); };
                const fetchImpl = allowNetwork ? window.fetch.bind(window) : networkBlocker;
                const xhrImpl = allowNetwork ? window.XMLHttpRequest : networkBlocker;
                const argNames = ['state', '_', 'fetch', 'XMLHttpRequest', ...formalParamNames];
                const argValues = [state, _, fetchImpl, xhrImpl, ...params];
                const functionBody = `'use strict';\n${bodyPrologue}${funcDef.func_body}`;
                const userFunction = new Function(...argNames, functionBody);
                const result = await userFunction.apply(null, argValues);
                resolve(result);
            } catch (error) { reject(error); }
        });
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`EVAL: Function '${funcName}' timed out after ${timeout}ms.`)), timeout);
        });
        try {
            const result = await Promise.race([executionPromise, timeoutPromise]);
            logger.info(`EVAL: Function '${funcName}' executed successfully.`, { result });
        } catch (error) {
            logger.error(`EVAL: Error executing function '${funcName}'.`, error);
        }
    }

    // --- CORE LOGIC ---
    async function processVolatileUpdates(state) {
        if (!state.volatile || !state.volatile.length) return [];
        const promotedCommands = [];
        const remainingVolatiles = [];
        const currentRound = await getRoundCounter();
        const currentTime = state.time ? new Date(state.time) : new Date();
        for (const volatile of state.volatile) {
            const [varName, varValue, isRealTime, targetTime, reason] = volatile;
            let triggered = isRealTime ? (currentTime >= new Date(targetTime)) : (currentRound >= targetTime);
            if (triggered) {
                const params = `${JSON.stringify(varName)}, ${JSON.stringify(varValue)}`;
                promotedCommands.push({ type: 'SET', params: params });
                logger.info(`[Volatile] Triggered timed event '${reason || varName}'. Setting ${varName} to ${varValue}.`);
            } else {
                remainingVolatiles.push(volatile);
            }
        }
        state.volatile = remainingVolatiles;
        return promotedCommands;
    }

    function buildPathMap(obj, currentPath = '', pathMap = new Map(), collisionSet = new Set()) {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return;
        for (const key of Object.keys(obj)) {
            const newPath = currentPath ? `${currentPath}.${key}` : key;
            if (pathMap.has(key)) {
                collisionSet.add(key);
            } else {
                pathMap.set(key, newPath);
            }
            buildPathMap(obj[key], newPath, pathMap, collisionSet);
        }
        return { pathMap, collisionSet };
    }

    function isTypeMutationAllowed(oldValue, newValue) {
        if (oldValue === null || typeof oldValue === 'undefined') {
            return true;
        }
        const oldType = Array.isArray(oldValue) ? 'array' : typeof oldValue;
        const newType = Array.isArray(newValue) ? 'array' : typeof newValue;
        return oldType === newType;
    }

    async function applyCommandsToState(commands, state) {
        if (!commands || commands.length === 0) return state;
        const currentRound = await getRoundCounter();
        let modifiedListPaths = new Set();

        let pathMap = null;
        if (sam_settings.uniquely_identified) {
            const { pathMap: generatedMap, collisionSet } = buildPathMap(state.static);
            for (const key of collisionSet) {
                generatedMap.delete(key);
            }
            pathMap = generatedMap;
            if (collisionSet.size > 0) {
                logger.warn(`[SAM] Abbreviation mapping disabled for colliding keys: ${[...collisionSet].join(', ')}`);
                toastr.warning(`SAM: Abbreviation mapping disabled for non-unique keys: ${[...collisionSet].join(', ')}`);
            }
        }
        const resolvePath = (path) => pathMap?.get(path) ?? path;

        for (let i = 0; i < commands.length; i++) {
            const command = commands[i];
            if (i > 0 && i % COMMAND_BATCH_SIZE === 0) {
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
            let params;
            const paramsString = command.params.trim();
            const wrappedString = `[${paramsString}]`;
            try {
                params = paramsString ? JSON.parse(wrappedString) : [];
            } catch (error) {
                logger.warn(`[SAM] JSON parse failed for command ${command.type}. Attempting repair...`);
                try {
                    if (typeof window.jsonrepair !== 'function') {
                        await loadExternalLibrary(JSON_REPAIR_URL, 'jsonrepair');
                    }
                    const fixed = window.jsonrepair(wrappedString);
                    params = JSON.parse(fixed);
                    toastr.info(`[SAM] JSON input format incorrect. Attempting to repair JSON`);
                } catch (repairError) {
                    logger.error(`[SAM] Fatal: Failed to repair JSON for command ${command.type}. Skipping.`, repairError);
                    toastr.error(`SAM: Failed to parse/repair command ${command.type}.`);
                    continue;
                }
            }

            try {
                const pathCommands = ['SET', 'ADD', 'DEL', 'SELECT_DEL', 'SELECT_ADD', 'SELECT_SET', 'TIMED_SET'];
                if (pathCommands.includes(command.type) && params.length > 0 && typeof params[0] === 'string') {
                    const originalPath = params[0];
                    params[0] = resolvePath(originalPath);
                    if (originalPath !== params[0]) {
                        logger.info(`[SAM] Abbreviation resolved: '${originalPath}' -> '${params[0]}'`);
                    }
                }

                switch (command.type) {
                    case 'SET': {
                        if (sam_settings.disable_dtype_mutation) {
                            const oldValue = _.get(state.static, params[0]);
                            if (!isTypeMutationAllowed(oldValue, params[1])) {
                                logger.warn(`[SAM] Blocked illegal type mutation for path "${params[0]}".`);
                                toastr.warning(`SAM: Blocked illegal type mutation on "${params[0]}".`);
                                continue;
                            }
                        }
                        _.set(state.static, params[0], params[1]);
                        break;
                    }
                    case 'ADD': {
                        const [varName, valueToAdd] = params;
                        const existing = _.get(state.static, varName, 0);
                        if (Array.isArray(existing)) { existing.push(valueToAdd); }
                        else { _.set(state.static, varName, (Number(existing) || 0) + Number(valueToAdd)); }
                        break;
                    }
                    case 'RESPONSE_SUMMARY': {
                        if (!Array.isArray(state.responseSummary)) { state.responseSummary = []; }
                        if (params[0] && !state.responseSummary.includes(params[0])) { state.responseSummary.push(params[0]); }
                        break;
                    }
                    case "TIME": {
                        if (state.time) { state.dtime = new Date(params[0]) - new Date(state.time); }
                        else { state.dtime = 0; }
                        state.time = params[0];
                        break;
                    }
                    case 'TIMED_SET': {
                        const [varName, varValue, reason, isRealTime, timepoint] = params;
                        if (sam_settings.disable_dtype_mutation) {
                            const oldValue = _.get(state.static, varName);
                            if (!isTypeMutationAllowed(oldValue, varValue)) {
                                logger.warn(`[SAM] Blocked scheduling of illegal type mutation for path "${varName}".`);
                                toastr.warning(`SAM: Blocked timed set due to illegal type mutation on "${varName}".`);
                                continue;
                            }
                        }
                        const targetTime = isRealTime ? new Date(timepoint).toISOString() : currentRound + Number(timepoint);
                        if (!state.volatile) state.volatile = [];
                        state.volatile.push([varName, varValue, isRealTime, targetTime, reason]);
                        break;
                    }
                    case 'CANCEL_SET': {
                        const identifier = params[0];
                        const index = parseInt(identifier, 10);
                        if (!isNaN(index)) {
                            if (state.volatile && index >= 0 && index < state.volatile.length) {
                                state.volatile.splice(index, 1);
                            } else {
                                logger.warn(`[Volatile] CANCEL_SET failed: Index ${index} out of bounds.`);
                            }
                        }
                        else {
                            const initialLength = state.volatile.length;
                            state.volatile = state.volatile.filter(entry => entry[4] !== identifier);
                            if (state.volatile.length === initialLength) {
                                logger.warn(`[Volatile] CANCEL_SET failed: No timed event found with reason '${identifier}'.`);
                            }
                        }
                        break;
                    }
                    case 'DEL': {
                        const [listPath, index] = params;
                        const list = _.get(state.static, listPath);
                        if (Array.isArray(list) && index >= 0 && index < list.length) {
                            list[index] = undefined;
                            modifiedListPaths.add(listPath);
                        } else {
                            logger.warn(`[SAM] DEL failed: Path "${listPath}" is not a list or index ${index} is out of bounds.`);
                        }
                        break;
                    }
                    case 'SELECT_DEL': {
                        const [listPath, identifier, targetId] = params;
                        const initialLength = _.get(state.static, listPath, []).length;
                        _.update(state.static, listPath, list => _.reject(list, { [identifier]: targetId }));
                        if (_.get(state.static, listPath, []).length === initialLength) {
                            logger.warn(`[SAM] SELECT_DEL failed: Target not found with ${identifier}=${JSON.stringify(targetId)} in list ${listPath}.`);
                        }
                        break;
                    }
                    case 'SELECT_ADD': {
                        const [listPath, selProp, selVal, recProp, valToAdd] = params;
                        const list = _.get(state.static, listPath);
                        if (!Array.isArray(list)) {
                            logger.warn(`[SAM] SELECT_ADD failed: Path "${listPath}" is not a list.`);
                            break;
                        }
                        const targetIndex = _.findIndex(list, { [selProp]: selVal });
                        if (targetIndex > -1) {
                            const fullPath = `${listPath}[${targetIndex}].${recProp}`;
                            const existing = _.get(state.static, fullPath);
                            if (Array.isArray(existing)) {
                                existing.push(valToAdd);
                            } else {
                                _.set(state.static, fullPath, (Number(existing) || 0) + Number(valToAdd));
                            }
                        } else {
                            logger.warn(`[SAM] SELECT_ADD failed: Target not found with selector ${selProp}=${JSON.stringify(selVal)} in list ${listPath}.`);
                        }
                        break;
                    }
                    case 'SELECT_SET': {
                        const [listPath, selProp, selVal, recProp, valToSet] = params;
                        const list = _.get(state.static, listPath);
                        if (!Array.isArray(list)) {
                            logger.warn(`[SAM] SELECT_SET failed: Path "${listPath}" is not a list.`);
                            break;
                        }
                        const targetIndex = _.findIndex(list, (item) => _.get(item, selProp) === selVal);
                        if (targetIndex > -1) {
                            const fullPath = `${listPath}[${targetIndex}].${recProp}`;
                            if (sam_settings.disable_dtype_mutation) {
                                const oldValue = _.get(state.static, fullPath);
                                if (!isTypeMutationAllowed(oldValue, valToSet)) {
                                    logger.warn(`[SAM] Blocked illegal type mutation for path "${fullPath}".`);
                                    toastr.warning(`SAM: Blocked illegal type mutation on "${fullPath}".`);
                                    continue;
                                }
                            }
                            _.set(state.static, fullPath, valToSet);
                        } else {
                            logger.warn(`[SAM] SELECT_SET failed: Target not found with selector ${selProp}=${JSON.stringify(selVal)} in list ${listPath}.`);
                        }
                        break;
                    }
                    case 'EVENT_BEGIN': {
                        if (getActiveEvent(state)) {
                            logger.error(`EVENT_BEGIN failed: An event is already active.`);
                            break;
                        }
                        const [name, objective, ...initialProcs] = params;
                        if (!name || !objective) {
                            logger.error("EVENT_BEGIN failed: 'name' and 'objective' are required.");
                            break;
                        }
                        state.event_counter = (state.event_counter || 0) + 1;
                        const newEvent = {
                            name, evID: state.event_counter, start_time: state.time || new Date().toISOString(),
                            end_time: null, objective, members: [], procedural: initialProcs || [],
                            new_defines: [], status: 0, summary: null
                        };
                        if (!state.events) state.events = [];
                        state.events.push(newEvent);
                        break;
                    }
                    case 'EVENT_END': {
                        const activeEvent = getActiveEvent(state);
                        if (!activeEvent) {
                            logger.warn("EVENT_END called but no active event was found.");
                            break;
                        }
                        activeEvent.status = params[0] ?? 1;
                        activeEvent.end_time = state.time || new Date().toISOString();
                        if (params[1]) { activeEvent.summary = params[1]; }
                        break;
                    }
                    case 'EVENT_ADD_PROC': {
                        const activeEvent = getActiveEvent(state);
                        if (activeEvent) params.forEach(proc => activeEvent.procedural.push(proc));
                        break;
                    }
                    case 'EVENT_ADD_DEFN': {
                        const activeEvent = getActiveEvent(state);
                        if (activeEvent && params.length >= 2) activeEvent.new_defines.push({ name: params[0], desc: params[1] });
                        break;
                    }
                    case 'EVENT_ADD_MEMBER': {
                        const activeEvent = getActiveEvent(state);
                        if (activeEvent) params.forEach(member => { if (!activeEvent.members.includes(member)) activeEvent.members.push(member); });
                        break;
                    }
                    case 'EVENT_SUMMARY': {
                        const activeEvent = getActiveEvent(state);
                        if (activeEvent) activeEvent.summary = params[0] || null;
                        break;
                    }
                    case 'EVAL': {
                        const [funcName, ...funcParams] = params;
                        await runSandboxedFunction(funcName, funcParams, state);
                        break;
                    }
                }
            } catch (error) {
                logger.error(`Error processing command: ${JSON.stringify(command)}`, error);
            }
        }
        for (const path of modifiedListPaths) {
            _.update(state.static, path, list => _.filter(list, item => item !== undefined));
        }
        return state;
    }
    
    async function executeCommandPipeline(messageCommands, state) {
        const promotedVolatileCommands = await processVolatileUpdates(state);
        const periodicCommands = state.func?.filter(f => f.periodic === true).map(f => ({ type: 'EVAL', params: `"${f.func_name}"` })) || [];
        const allPotentialCommands = [...messageCommands, ...promotedVolatileCommands, ...periodicCommands];
        const priorityCommands = [], firstEvalItems = [], lastEvalItems = [], normalCommands = [];
        const funcDefMap = new Map(state.func?.map(f => [f.func_name, f]) || []);
        for (const command of allPotentialCommands) {
            if (command.type === "TIME") { priorityCommands.push(command); continue; }
            if (command.type === 'EVAL') {
                const funcName = (command.params.split(',')[0] || '').trim().replace(/"/g, '');
                const funcDef = funcDefMap.get(funcName);
                if (funcDef?.order === 'first') { firstEvalItems.push({ command, funcDef }); }
                else if (funcDef?.order === 'last') { lastEvalItems.push({ command, funcDef }); }
                else { normalCommands.push(command); }
            } else { normalCommands.push(command); }
        }
        const sortBySequence = (a, b) => (a.funcDef.sequence || 0) - (b.funcDef.sequence || 0);
        firstEvalItems.sort(sortBySequence); lastEvalItems.sort(sortBySequence);
        const firstCommands = firstEvalItems.map(item => item.command);
        const lastCommands = lastEvalItems.map(item => item.command);
        await applyCommandsToState(priorityCommands, state);
        await applyCommandsToState(firstCommands, state);
        await applyCommandsToState(normalCommands, state);
        await applyCommandsToState(lastCommands, state);
        return state;
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

    async function processMessageState(index) {
        if (isProcessingState) { return; }
        isProcessingState = true;
        try {
            if (index === "{{lastMessageId}}") { index = SillyTavern.getContext().chat.length - 1; }
            const lastAIMessage = SillyTavern.getContext().chat[index];
            if (!lastAIMessage || lastAIMessage.is_user) { return; }

            let state;
            if (prevState) {
                state = goodCopy(prevState);
            } else {
                state = await findLatestState(SillyTavern.getContext().chat, index - 1);
            }
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            const newCommands = extractCommandsFromText(lastAIMessage.mes);
            const newState = await executeCommandPipeline(newCommands, state);
            await sam_renewVariables(newState);

            const cleanNarrative = lastAIMessage.mes.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            let finalContent = cleanNarrative;
            const currentRound = await getRoundCounter();
            const shouldCheckpoint = sam_settings.enable_auto_checkpoint && sam_settings.checkpoint_frequency > 0 &&
                                     (currentRound > 0 && (currentRound % sam_settings.checkpoint_frequency === 0 || index === 0));
            if (shouldCheckpoint) {
                logger.info(`[SAM] Checkpoint condition met (Round ${currentRound}). Writing full state block.`);
                const newStateBlock = await chunkedStringify(newState);
                finalContent += `\n\n${STATE_BLOCK_START_MARKER}\n${newStateBlock}\n${STATE_BLOCK_END_MARKER}`;
            }
            await setChatMessage({ message: finalContent }, index, "display_current");
        } catch (error) {
            logger.error(`Error in processMessageState for index ${index}:`, error);
        } finally {
            isProcessingState = false;
        }
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
        // [MODIFIED] Dispatcher only reacts if go_flag is true, except for the ready check
        if (!go_flag && event !== event_types.CHAT_COMPLETION_PROMPT_READY) {
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
                        case event_types.CHAT_COMPLETION_PROMPT_READY:
                            // State loading happens in the handler itself for this event,
                            // we just need to ensure we transition correctly for the generation.
                            curr_state = STATES.AWAIT_GENERATION;
                            startGenerationWatcher();
                            break;
                            
                        // Fallback logic for regenerations/swipes which might bypass prompt_ready in some flows
                        case event_types.MESSAGE_SENT:
                        case event_types.GENERATION_STARTED:
                            if (event_params[2]) { return; }
                            if (event_params[0] === "swipe" || event_params[0] === "regenerate") {
                                await loadStateToMemory(findLatestUserMsgIndex());
                                prevState = goodCopy((await getVariables()).SAM_data);
                            } 
                            curr_state = STATES.AWAIT_GENERATION;
                            startGenerationWatcher();
                            break;
                        case event_types.MESSAGE_SWIPED:
                        case event_types.MESSAGE_DELETED:
                        case event_types.MESSAGE_EDITED:
                            await sync_latest_state();
                            prevState = goodCopy((await getVariables()).SAM_data);
                            break;
                        case event_types.CHAT_CHANGED:
                            // Reset everything on chat change
                            go_flag = false;
                            prevState = null;
                            logger.info("[SAM] Chat changed. Resetting to dormant state.");
                            break;
                    }
                    break;
                case STATES.AWAIT_GENERATION:
                    switch (event) {
                        case event_types.GENERATION_STOPPED:
                        case FORCE_PROCESS_COMPLETION:
                        case event_types.GENERATION_ENDED:
                            stopGenerationWatcher();
                            curr_state = STATES.PROCESSING;
                            const index = SillyTavern.getContext().chat.length - 1;
                            await processMessageState(index);
                            curr_state = STATES.IDLE;
                            prevState = null;
                            break;
                        case event_types.CHAT_CHANGED:
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
        // [NEW] The critical handler that gates execution
        handlePromptReady: async () => {
            logger.info("[SAM] Prompt Ready Event Detected. Checking activation...");
            await checkWorldInfoActivation();
            if (go_flag) {
                logger.info("[SAM] Identifier found. Syncing state from history before generation...");
                await sync_latest_state();
                prevState = goodCopy((await getVariables()).SAM_data);
                // Trigger dispatcher to shift state to AWAIT_GENERATION
                await unifiedEventHandler(event_types.CHAT_COMPLETION_PROMPT_READY);
            }
        },
		handleGenerationStarted: async (ev, options, dry_run) => { await unifiedEventHandler(event_types.GENERATION_STARTED, ev, options, dry_run); },
		handleGenerationEnded: async () => { await unifiedEventHandler(event_types.GENERATION_ENDED); },
		handleMessageSwiped: () => { setTimeout(async () => { await unifiedEventHandler(event_types.MESSAGE_SWIPED); }, 0); },
		handleMessageDeleted: (message) => { setTimeout(async () => { await unifiedEventHandler(event_types.MESSAGE_DELETED, message); }, 0); },
		handleMessageEdited: () => { setTimeout(async () => { await unifiedEventHandler(event_types.MESSAGE_EDITED); }, 0); },
		handleChatChanged: () => { setTimeout(async () => { await unifiedEventHandler(event_types.CHAT_CHANGED); }, 10); },
		handleMessageSent: () => { setTimeout(async () => { await unifiedEventHandler(event_types.MESSAGE_SENT); }, 0); },
		handleGenerationStopped: () => { setTimeout(async () => { await unifiedEventHandler(event_types.GENERATION_STOPPED); }, 0); },
	};

    function resetCurrentState() {
        stopGenerationWatcher();
        curr_state = STATES.IDLE;
        isDispatching = false;
        isProcessingState = false;
        isCheckpointing = false;
        event_queue.length = 0;
        prevState = null;
        // In the new logic, we re-check logic gate on reset
        checkWorldInfoActivation().then(() => {
            if(go_flag) {
                sync_latest_state().then(() => toastr.success("SAM state has been reset and re-synced."));
            } else {
                 toastr.info("SAM state reset. Logic dormant (No identifier).");
            }
        });
    }

    async function manualCheckpoint() {
        if (isCheckpointing || isProcessingState || curr_state !== STATES.IDLE) {
            toastr.warning("SAM is busy. Cannot create checkpoint now.");
            return;
        }
        isCheckpointing = true;
        try {
            const lastAiIndex = await findLastAiMessageAndIndex();
            if (lastAiIndex === -1) {
                toastr.error("Cannot checkpoint: No AI message found.");
                return;
            }
            const currentState = (await getVariables()).SAM_data;
            if (!currentState) {
                toastr.error("Current state is invalid. Cannot checkpoint.");
                return;
            }
            const lastAiMessage = SillyTavern.getContext().chat[lastAiIndex];
            const cleanNarrative = lastAiMessage.mes.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            const newStateBlock = await chunkedStringify(currentState);
            const finalContent = `${cleanNarrative}\n\n${STATE_BLOCK_START_MARKER}\n${newStateBlock}\n${STATE_BLOCK_END_MARKER}`;
            
            await TavernHelper.setChatMessages([{'message_id': lastAiIndex, 'message': finalContent}]);
            
            toastr.success("Checkpoint created successfully!");
        } catch (error) {
            logger.error("Manual checkpoint failed.", error);
            toastr.error("Checkpoint failed. Check console.");
        } finally {
            isCheckpointing = false;
        }
    }

    async function rerunLatestCommands() {
        if (curr_state !== STATES.IDLE) {
            toastr.error("Cannot rerun commands now. The script is busy.");
            return;
        }
        const lastAiIndex = await findLastAiMessageAndIndex();
        if (lastAiIndex === -1) {
            toastr.info("No AI message found to rerun.");
            return;
        }
        isProcessingState = true;
        try {
            const initialState = await findLatestState(SillyTavern.getContext().chat, lastAiIndex - 1);
            const messageContent = SillyTavern.getContext().chat[lastAiIndex].mes;
            const newCommands = extractCommandsFromText(messageContent);
            const newState = await executeCommandPipeline(newCommands, initialState);
            await sam_renewVariables(newState);
            const currentRound = await getRoundCounter();
            const shouldCheckpoint = sam_settings.enable_auto_checkpoint && sam_settings.checkpoint_frequency > 0 &&
                                     (currentRound > 0 && (currentRound % sam_settings.checkpoint_frequency === 0 || lastAiIndex === 0));
            const cleanNarrative = messageContent.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            let finalContent = cleanNarrative;
            if (shouldCheckpoint) {
                const newStateBlock = await chunkedStringify(newState);
                finalContent += `\n\n${STATE_BLOCK_START_MARKER}\n${newStateBlock}\n${STATE_BLOCK_END_MARKER}`;
            }
            await TavernHelper.setChatMessages([{'message_id':lastAiIndex, 'message':finalContent}]);
            toastr.success("Rerun complete. State saved.");
        } catch (error) {
            logger.error("Manual rerun failed.", error);
            toastr.error("Rerun failed. Check console.");
        } finally {
            isProcessingState = false;
        }
    }
    
    // ============================================================================
    // == EXPOSED API FOR EXTERNAL SCRIPTS
    // ============================================================================
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
    
    function sam_abort_cycle() { resetCurrentState(); };

    async function sam_enable(){
        if (!sam_settings.enabled) {
            sam_settings.enabled = true;
            toastr.success("Situational Awareness Manager has been enabled.");
            logger.info("SAM has been ENABLED via API call.");
            await saveSamSettings();
            await sync_latest_state();
        }
    }

    async function sam_disable(){
        if (sam_settings.enabled) {
            sam_settings.enabled = false;
            toastr.success("Situational Awareness Manager has been disabled.");
            logger.info("SAM has been DISABLED via API call.");
            await saveSamSettings();
        }
    }

    async function sam_set_setting(key, value) {

        try{
            await saveSamSettings(key, value);
        }catch (error){
            logger.error(`[SAM] failed to save extension settings.`, error);
        }
    }

    function sam_is_in_use(){
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
    };

    (() => {
        $(async () => {
            console.log("SAM: DOM content loaded. Initializing...");
            try {
                loadSamSettings();
                if (!sam_settings.enabled) {
                    logger.info("SAM is disabled in settings. Halting initialization.");
                    return;
                }

                cleanupPreviousInstance();
                
                // [MODIFIED] Immediate loading logic REMOVED.
                // We now strictly wait for events to trigger data loading.
                logger.info("SAM: Event listeners registered. Waiting for prompt ready event or activation key.");

                eventSource.makeFirst(event_types.GENERATION_STARTED, handlers.handleGenerationStarted);
                eventSource.on(event_types.GENERATION_ENDED, handlers.handleGenerationEnded);
                eventSource.on(event_types.MESSAGE_SWIPED, handlers.handleMessageSwiped);
                eventSource.on(event_types.MESSAGE_DELETED, handlers.handleMessageDeleted);
                eventSource.on(event_types.MESSAGE_EDITED, handlers.handleMessageEdited);
                eventSource.on(event_types.CHAT_CHANGED, handlers.handleChatChanged);
                eventSource.on(event_types.MESSAGE_SENT, handlers.handleMessageSent);
                eventSource.on(event_types.GENERATION_STOPPED, handlers.handleGenerationStopped);
                
                // [NEW] The specific event requested
                eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, handlers.handlePromptReady);
                
                window[HANDLER_STORAGE_KEY] = handlers;
                
                logger.info(`V${SCRIPT_VERSION} loaded. Event Driven Mode.`);
                session_id = JSON.stringify(new Date());
                sessionStorage.setItem(SESSION_STORAGE_KEY, session_id);

            } catch (error) {
                console.error("SAM: A fatal error occurred during initialization.", error);
            }
        });
    })();

})();
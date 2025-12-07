// ============================================================================
// == Situational Awareness Manager
// == Version: 4.0.3 "Lepton"
// ==
// == This script provides a robust state management system for SillyTavern.
// == It now features a revolutionary checkpointing system to significantly
// == reduce chat history bloat. The full state object ("data block") is no
// == longer written to every AI response. Instead, it's saved periodically
// == as a "checkpoint" or on manual user command. Between checkpoints, AI
// == messages only contain state-mutating commands. The script reconstructs
// == the full state in memory by applying commands sequentially from the
// == last checkpoint, optimizing performance for operations like swipes.
// ==
// == [NEW in 4.0.3] Moved all configuration to a dedicated extension settings file.
// == [NEW in 4.0.3] Added API functions to get/set individual settings.
// == [NEW in 4.0.2] Adds persistent enable/disable flag.
// == [NEW in 4.0.2] Pauses execution on empty chats to prevent errors.
// == [NEW in 4.0.1] Refactored with external API functions (sam_get_state, etc.)
// == [NEW in 4.0.0] Checkpointing System
// ============================================================================
// ****************************
// Required plugins: JS-slash-runner by n0vi028
// ****************************

// Plug and play command reference, paste into prompt:
/*
command_syntax:
  - command: TIME
    description: Updates the time progression.
    syntax: '@.TIME("new_datetime_string");'
    parameters:
      - name: new_datetime_string
        type: string
        description: A string that can be parsed as a Date (e.g., "2024-07-29T10:30:00Z").
  - command: SET
    description: Sets a variable at a specified path to a given value.
    syntax: '@.SET("path.to.var", value);'
    parameters:
      - name: path.to.var
        type: string
        description: The dot-notation path to the variable in the state object.
      - name: value
        type: any
        description: The new value to assign. Can be a string, number, boolean, null, or a JSON object/array.
  - command: ADD
    description: Adds a value. If the target is a number, it performs numeric addition. If the target is a list (array), it appends the value.
    syntax: '@.ADD("path.to.var", value_to_add);'
    parameters:
      - name: path.to.var
        type: string
        description: The path to the numeric variable or list.
      - name: value_to_add
        type: number | any
        description: The number to add or the item to append to the list.
  - command: DEL
    description: Deletes an item from a list by its numerical index. The item is removed, and the list is compacted.
    syntax: '@.DEL("path.to.list", index);'
    parameters:
      - name: path.to.list
        type: string
        description: The path to the list.
      - name: index
        type: integer
        description: The zero-based index of the item to delete.
  - command: SELECT_SET
    description: Finds a specific object within a list and sets a property on that object to a new value.
    syntax: '@.SELECT_SET("path.to.list", "selector_key", "selector_value", "receiver_key", new_value);'
    parameters:
      - name: path.to.list
        type: string
        description: The path to the list of objects.
      - name: selector_key
        type: string
        description: The property name to search for in each object.
      - name: selector_value
        type: any
        description: The value to match to find the correct object.
      - name: receiver_key
        type: string
        description: The property name on the found object to update.
      - name: new_value
        type: any
        description: The new value to set.
  - command: SELECT_ADD
    description: Finds a specific object within a list and adds a value to one of its properties.
    syntax: '@.SELECT_ADD("path.to.list", "selector_key", "selector_value", "receiver_key", value_to_add);'
    parameters:
      - name: path.to.list
        type: string
        description: The path to the list of objects.
      - name: selector_key
        type: string
        description: The property name to search for in each object.
      - name: selector_value
        type: any
        description: The value to match to find the correct object.
      - name: receiver_key
        type: string
        description: The property on the found object to add to (must be a number or a list).
      - name: value_to_add
        type: any
        description: The value to add or append.
  - command: SELECT_DEL
    description: Finds and completely deletes an object from a list based on a key-value match.
    syntax: '@.SELECT_DEL("path.to.list", "selector_key", "selector_value");'
    parameters:
      - name: path.to.list
        type: string
        description: The path to the list of objects.
      - name: selector_key
        type: string
        description: The property name to search for in each object.
      - name: selector_value
        type: any
        description: The value to match to identify the object for deletion.
  - command: TIMED_SET
    description: Schedules a variable to be set to a new value in the future, either based on real-world time or in-game rounds.
    syntax: '@.TIMED_SET("path.to.var", new_value, "reason", is_real_time, timepoint);'
    parameters:
      - name: path.to.var
        type: string
        description: The dot-notation path to the variable to set.
      - name: new_value
        type: any
        description: The value to set the variable to when the time comes.
      - name: reason
        type: string
        description: A unique identifier for this scheduled event, used for cancellation.
      - name: is_real_time
        type: boolean
        description: If true, `timepoint` is a date string. If false, `timepoint` is a number of rounds from now.
      - name: timepoint
        type: string | integer
        description: The target time. A date string like "2024-10-26T10:00:00Z" if `is_real_time` is true, or a number of rounds (e.g., 5) if false.
  - command: CANCEL_SET
    description: Cancels a previously scheduled TIMED_SET command.
    syntax: '@.CANCEL_SET("identifier");'
    parameters:
      - name: identifier
        type: string | integer
        description: The `reason` string or the numerical index of the scheduled event in the `state.volatile` array to cancel.
  - command: RESPONSE_SUMMARY
    description: Adds a text summary of the current response to the special `state.responseSummary` list.
    syntax: '@.RESPONSE_SUMMARY("summary_text");'
    parameters:
      - name: summary_text
        type: string
        description: A concise summary of the AI's response.
  - command: EVENT_BEGIN
    description: Starts a new narrative event. Fails if another event is already active.
    syntax: '@.EVENT_BEGIN("name", "objective", "optional_first_step", ...);'
    parameters:
      - name: name
        type: string
        description: The name of the event (e.g., "The Council of Elrond").
      - name: objective
        type: string
        description: The goal of the event (e.g., "Decide the fate of the One Ring").
      - name: '...'
        type: string
        description: Optional. One or more strings to add as the first procedural step(s) of the event.
  - command: EVENT_END
    description: Concludes the currently active event, setting its status and end time.
    syntax: '@.EVENT_END(exitCode, "optional_summary");'
    parameters:
      - name: exitCode
        type: integer
        description: The status code for the event's conclusion (1=success, -1=aborted/failed, other numbers for custom states).
      - name: optional_summary
        type: string
        description: Optional. A final summary of the event's outcome.
  - command: EVENT_ADD_PROC
    description: Adds one or more procedural steps to the active event's log.
    syntax: '@.EVENT_ADD_PROC("step_description_1", "step_description_2", ...);'
    parameters:
      - name: '...'
        type: string
        description: One or more strings detailing what just happened in the event.
  - command: EVENT_ADD_DEFN
    description: Adds a temporary, event-specific definition (like a new item or concept) to the active event.
    syntax: '@.EVENT_ADD_DEFN("item_name", "item_description");'
    parameters:
      - name: item_name
        type: string
        description: The name of the new concept (e.g., "Shard of Narsil").
      - name: item_description
        type: string
        description: A brief description of the concept.
  - command: EVENT_ADD_MEMBER
    description: Adds one or more members to the list of participants in the active event.
    syntax: '@.EVENT_ADD_MEMBER("name_1", "name_2", ...);'
    parameters:
      - name: '...'
        type: string
        description: The names of the characters or entities involved in the event.
  - command: EVENT_SUMMARY
    description: Sets or updates the summary for the active event. This can be done before the event ends.
    syntax: '@.EVENT_SUMMARY("summary_text");'
    parameters:
      - name: summary_text
        type: string
        description: The summary content.
  - command: EVAL
    description: Executes a user-defined function stored in `state.func`. DANGEROUS - use with caution.
    syntax: '@.EVAL("function_name", param1, param2, ...);'
    parameters:
      - name: function_name
        type: string
        description: The `func_name` of the function object to execute from the `state.func` array.
      - name: '...'
        type: any
        description: Optional, comma-separated parameters to pass to the function.
*/

// -------------------------------------------------------------------------------------------

(function () {
    // --- CONFIGURATION ---
    const SCRIPT_NAME = "Situational Awareness Manager";
    const SCRIPT_VERSION = "4.0.3";
    const JSON_REPAIR_URL = "https://cdn.jsdelivr.net/npm/jsonrepair/lib/umd/jsonrepair.min.js";

    // NEW: Centralized settings management
    const DEFAULT_SETTINGS = {
        enabled: true,
        disable_dtype_mutation: false,
        uniquely_identified: false,
        enable_auto_checkpoint: true,
        checkpoint_frequency: 20
    };
    let sam_settings = { ...DEFAULT_SETTINGS };

    // State block format markers
    const OLD_START_MARKER = '<!--<|state|>';
    const OLD_END_MARKER = '</|state|>-->';
    const NEW_START_MARKER = '$$$$$$data_block$$$$$$';
    const NEW_END_MARKER = '$$$$$$data_block_end$$$$$$';
    const STATE_BLOCK_START_MARKER = NEW_START_MARKER;
    const STATE_BLOCK_END_MARKER = NEW_END_MARKER;

    var { eventSource, event_types } = SillyTavern.getContext();
    var _ = require('lodash');

    // Flag to pause execution on empty chats
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

// NEW: Settings functions using SillyTavern's extension API
    async function loadSamSettings() {
        try {
            // Use the SillyTavern API to read settings stored under the script's name.
            const storedSettings = await SillyTavern.getContext().readExtensionSettings(SCRIPT_NAME);

            // Merge the loaded settings with defaults to ensure all keys are present
            // and to handle cases where new settings are added in script updates.
            sam_settings = { ...DEFAULT_SETTINGS, ...storedSettings };
            logger.info("SAM settings loaded successfully.", sam_settings);
        } catch (error) {
            logger.warn("Could not load SAM settings, using defaults. This is normal on first run.", error);
            // If loading fails (e.g., first time running), we still have the defaults.
            // Attempt to save them to create the settings file for the next session.
            await saveSamSettings();
        }
    }

    async function saveSamSettings() {
        try {
            // Use the SillyTavern API to write the current settings object,
            // associating it with the script's name.
            await SillyTavern.getContext().writeExtensionSettings(SCRIPT_NAME, sam_settings);
            logger.info("SAM settings saved successfully.");
        } catch (error) {
            logger.error("Failed to save SAM settings.", error);
            toastr.error("Failed to save SAM settings.");
        }
    }

    function updateGoFlag() {
        const chatLength = SillyTavern.getContext().chat?.length ?? 0;
        const new_flag_state = chatLength > 0;
        if (go_flag !== new_flag_state) {
            go_flag = new_flag_state;
            logger.info(`[SAM] Activity flag set to ${go_flag} (chat length: ${chatLength}). Script is ${go_flag ? 'active' : 'paused'}.`);
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
        delete window[HANDLER_STORAGE_KEY];
    };

    async function getVariables(){
        if (!SillyTavern.getContext().variables.local.has("SAM_data")){
            return {};
        }
        return SillyTavern.getContext().variables.local.get("SAM_data");
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
    
    async function getRoundCounter() { return SillyTavern.chat.length - 1; }
    
    function parseStateFromMessage(messageContent) {
        if (!messageContent) return null;
        const match = messageContent.match(STATE_BLOCK_PARSE_REGEX);
        if (match && match[1]) {
            try {
                const parsed = JSON.parse(match[1].trim());
                // Configuration flags are no longer part of the state block.
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
        logger.info(`[Lepton] Reconstructing state up to index ${targetIndex}...`);
        let baseState = _.cloneDeep(INITIAL_STATE);
        let checkpointIndex = -1;
        if (targetIndex < 0) {
            const baseData = await getBaseDataFromWI();
            if (baseData) {
                logger.info("[Lepton] Base data from World Info found for new chat. Merging into initial state.");
                baseState = _.merge({}, baseState, baseData);
            }
            return baseState;
        }
        for (let i = targetIndex; i >= 0; i--) {
            const message = chatHistory[i];
            if (message.is_user) continue;
            const stateFromBlock = parseStateFromMessage(message.mes);
            if (stateFromBlock) {
                logger.info(`[Lepton] Found checkpoint at index ${i}.`);
                baseState = stateFromBlock;
                checkpointIndex = i;
                break;
            }
        }
        if (checkpointIndex === -1) {
            logger.warn("[Lepton] No checkpoint found. Reconstructing from the beginning of AI messages.");
            if (targetIndex >= 0) {
                const baseData = await getBaseDataFromWI();
                if (baseData) {
                    logger.info("[Lepton] Base data from World Info found. Merging into initial state.");
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
        logger.info(`[Lepton] Found ${commandsToApply.length} commands to apply on top of the base state from index ${checkpointIndex}.`);
        const reconstructedState = await applyCommandsToState(commandsToApply, baseState);
        logger.info(`[Lepton] State reconstruction complete up to index ${targetIndex}.`);
        return reconstructedState;
    }

    function findLatestUserMsgIndex() {
        for (let i = SillyTavern.chat.length - 1; i >= 0; i--) {
            if (SillyTavern.chat[i].is_user) { return i; }
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
        let wi = await loadWorldInfo(winame);
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
            if (index === "{{lastMessageId}}") { index = SillyTavern.chat.length - 1; }
            const lastAIMessage = SillyTavern.chat[index];
            if (!lastAIMessage || lastAIMessage.is_user) { return; }

            let state;
            if (prevState) {
                state = goodCopy(prevState);
            } else {
                state = await findLatestState(SillyTavern.chat, index - 1);
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
                logger.info(`[Lepton] Checkpoint condition met (Round ${currentRound}). Writing full state block.`);
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
        if (targetIndex === "{{lastMessageId}}") { targetIndex = SillyTavern.chat.length - 1; }
        let state = await findLatestState(SillyTavern.chat, targetIndex);
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
        const chat = SillyTavern.chat;
        const searchUntil = (beforeIndex === -1) ? chat.length : beforeIndex;
        for (let i = searchUntil - 1; i >= 0; i--) {
            if (chat[i] && chat[i].is_user === false) return i;
        }
        return -1;
    }

    async function sync_latest_state() {
        if (!go_flag) {
            logger.info("[Sync] Sync skipped, chat is empty. Loading initial state.");
            await loadStateToMemory(-1);
            return;
        }
        var lastlastAIMessageIdx = await findLastAiMessageAndIndex();
        await loadStateToMemory(lastlastAIMessageIdx);
    }

    async function dispatcher(event, ...event_params) {
        if (!go_flag && event !== event_types.CHAT_CHANGED && event !== event_types.MESSAGE_SENT) {
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
                        case event_types.MESSAGE_SENT:
                        case event_types.GENERATION_STARTED:
                            if (event_params[2]) { return; }
                            if (event_params[0] === "swipe" || event_params[0] === "regenerate") {
                                await loadStateToMemory(findLatestUserMsgIndex());
                                prevState = goodCopy((await getVariables()).SAM_data);
                            } else if (event === event_types.MESSAGE_SENT) {
                                const lastAiIndex = await findLastAiMessageAndIndex();
                                prevState = await loadStateToMemory(lastAiIndex);
                            }
                            curr_state = STATES.AWAIT_GENERATION;
                            startGenerationWatcher();
                            break;
                        case event_types.MESSAGE_SWIPED:
                        case event_types.MESSAGE_DELETED:
                        case event_types.MESSAGE_EDITED:
                        case event_types.CHAT_CHANGED:
                            await sync_latest_state();
                            prevState = goodCopy((await getVariables()).SAM_data);
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
                            const index = SillyTavern.chat.length - 1;
                            await processMessageState(index);
                            curr_state = STATES.IDLE;
                            prevState = null;
                            break;
                        case event_types.CHAT_CHANGED:
                            stopGenerationWatcher();
                            await sync_latest_state();
                            prevState = goodCopy((await getVariables()).SAM_data);
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
		handleGenerationStarted: async (ev, options, dry_run) => { await unifiedEventHandler(event_types.GENERATION_STARTED, ev, options, dry_run); },
		handleGenerationEnded: async () => { await unifiedEventHandler(event_types.GENERATION_ENDED); },
		handleMessageSwiped: () => { setTimeout(async () => { await unifiedEventHandler(event_types.MESSAGE_SWIPED); }, 0); },
		handleMessageDeleted: (message) => { setTimeout(async () => { await unifiedEventHandler(event_types.MESSAGE_DELETED, message); }, 0); },
		handleMessageEdited: () => { setTimeout(async () => { await unifiedEventHandler(event_types.MESSAGE_EDITED); }, 0); },
		handleChatChanged: () => { setTimeout(async () => { updateGoFlag(); await unifiedEventHandler(event_types.CHAT_CHANGED); }, 10); },
		handleMessageSent: () => { setTimeout(async () => { updateGoFlag(); await unifiedEventHandler(event_types.MESSAGE_SENT); }, 0); },
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
        sync_latest_state().then(() => toastr.success("SAM state has been reset and re-synced."))
            .catch(err => toastr.error("SAM state reset, but re-sync failed."));
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
            const lastAiMessage = SillyTavern.chat[lastAiIndex];
            const cleanNarrative = lastAiMessage.mes.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            const newStateBlock = await chunkedStringify(currentState);
            const finalContent = `${cleanNarrative}\n\n${STATE_BLOCK_START_MARKER}\n${newStateBlock}\n${STATE_BLOCK_END_MARKER}`;
            await setChatMessages([{'message_id': lastAiIndex, 'message': finalContent}]);
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
            const initialState = await findLatestState(SillyTavern.chat, lastAiIndex - 1);
            const messageContent = SillyTavern.chat[lastAiIndex].mes;
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
            await setChatMessages([{'message_id':lastAiIndex, 'message':finalContent}]);
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
            return variables.SAM_data;
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
            const lastAiMessage = SillyTavern.chat[lastAiIndex];
            const cleanNarrative = lastAiMessage.mes.replace(STATE_BLOCK_REMOVE_REGEX, '').trim();
            const newStateBlock = await chunkedStringify(newData);
            const finalContent = `${cleanNarrative}\n\n${STATE_BLOCK_START_MARKER}\n${newStateBlock}\n${STATE_BLOCK_END_MARKER}`;
            await setChatMessages([{'message_id': lastAiIndex, 'message': finalContent}]);
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
        if (Object.prototype.hasOwnProperty.call(sam_settings, key)) {
            if (typeof value !== typeof DEFAULT_SETTINGS[key]) {
                const msg = `SAM API: Invalid type for setting '${key}'. Expected ${typeof DEFAULT_SETTINGS[key]}, got ${typeof value}.`;
                logger.error(msg);
                toastr.error(msg);
                return;
            }
            sam_settings[key] = value;
            await saveSamSettings();
            const msg = `SAM setting '${key}' updated to: ${JSON.stringify(value)}`;
            logger.info(msg);
            toastr.info(msg);
        } else {
            const msg = `SAM API: Attempted to set unknown setting '${key}'.`;
            logger.warn(msg);
            toastr.warning(msg);
        }
    }
    
    function sam_get_settings() {
        return { ...sam_settings };
    }

    module.exports = {
        sam_get_state,
        sam_get_data,
        sam_set_data,
        sam_abort_cycle,
        sam_enable,
        sam_disable,
        sam_set_setting,
        sam_get_settings,
    };

    (() => {
        $(async () => {
            console.log("SAM: DOM content loaded. Initializing...");
            try {
                await loadSamSettings();
                if (!sam_settings.enabled) {
                    logger.info("SAM is disabled in settings. Halting initialization.");
                    return;
                }

                cleanupPreviousInstance();
                const initializeOrReloadStateForCurrentChat = async () => {
                    updateGoFlag();
                    if (!go_flag) {
                        await loadStateToMemory(-1);
                    } else {
                        const lastAiIndex = await findLastAiMessageAndIndex();
                        await loadStateToMemory(lastAiIndex);
                    }
                    prevState = goodCopy((await getVariables()).SAM_data);
                    logger.info("Initialization finalized, prevState primed.");
                };

                eventSource.makeFirst(event_types.GENERATION_STARTED, handlers.handleGenerationStarted);
                eventSource.on(event_types.GENERATION_ENDED, handlers.handleGenerationEnded);
                eventSource.on(event_types.MESSAGE_SWIPED, handlers.handleMessageSwiped);
                eventSource.on(event_types.MESSAGE_DELETED, handlers.handleMessageDeleted);
                eventSource.on(event_types.MESSAGE_EDITED, handlers.handleMessageEdited);
                eventSource.on(event_types.CHAT_CHANGED, handlers.handleChatChanged);
                eventSource.on(event_types.MESSAGE_SENT, handlers.handleMessageSent);
                eventSource.on(event_types.GENERATION_STOPPED, handlers.handleGenerationStopped);
                window[HANDLER_STORAGE_KEY] = handlers;
                
                logger.info(`V${SCRIPT_VERSION} loaded. GLHF, player.`);
                await initializeOrReloadStateForCurrentChat();
                session_id = JSON.stringify(new Date());
                sessionStorage.setItem(SESSION_STORAGE_KEY, session_id);

            } catch (error) {
                console.error("SAM: A fatal error occurred during initialization.", error);
            }
        });
    })();

})();
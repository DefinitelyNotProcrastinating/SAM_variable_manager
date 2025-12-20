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

    const DEFAULT_SETTINGS = {
        enabled: true,
        disable_dtype_mutation: false,
        uniquely_identified: false,
        enable_auto_checkpoint: true,
        checkpoint_frequency: 20,
        summary_prompt: 'Condense the following chat messages into a concise summary of the most important facts and events. If a previous summary is provided, use it as a base and expand on it with new information. Limit the new summary to {{words}} words or less. Your response should include nothing but the summary.',
        summary_frequency: 30,
        summary_words: 150
    };

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


    const SAM_EVENTS = {
        CORE_UPDATED: 'SAM_CORE_UPDATED',            // Emitted by Core when state is updated
        EXT_ASK_STATUS: 'SAM_EXT_ASK_STATUS',        // Emitted by Extension to ask for status
        CORE_STATUS_RESPONSE: 'SAM_CORE_STATUS_RESPONSE', // Emitted by Core in response to status ask
        EXT_COMMIT_STATE: 'SAM_EXT_COMMIT_STATE',       // Emitted by Extension to save a full state object
        CORE_IDLE: 'SAM_CORE_IDLE', // Emitted by core in response to an ask
        INV:'SAM_INV' // data invalid. must re-fetch data.
    };

    var { eventSource, eventTypes, extensionSettings, saveSettingsDebounced, generateQuietPrompt, getTokenCountAsync,substituteParamsExtended} = SillyTavern.getContext();
    var _ = require('lodash');

    
    const STATES = { IDLE: "IDLE", AWAIT_GENERATION: "AWAIT_GENERATION", PROCESSING: "PROCESSING" };

    var currStatus = STATES.IDLE;
    var shouterName = "";

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
    const executionLog = [];

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

    // Cohee this is your fault
    // Time-complexity wise what even is the difference between selecting with index and selecting with a hashmap
    function formatArrayDict(dictarrayinput){

        let result = [];
        let keys = Object.keys(dictarrayinput);
        for (let key of  keys){
            result.push(dictarrayinput[key])
        }
        return result;
    }

    async function checkWorldInfoActivation() {
        try {
            var wi;
            try{
             wi = await getCurrentWorldbookName();
            }catch (e){
                logger.info(`[SAM util] WI not found. Presumably no character is loaded.`);
                return;
            }

            if (!wi){
                logger.info(`[SAM util] WI not found. Presumably no character is loaded.`)
                return;
            }

            let wi_entry_arr = formatArrayDict(wi.entries);

            let verified_go_flag = false;

            for (let item of wi_entry_arr){
                if (item.comment === SAM_ACTIVATION_KEY){
                    logger.info(`[SAM util] Activation Key "${SAM_ACTIVATION_KEY}" ${go_flag ? 'FOUND' : 'MISSING'}. Script is ${go_flag ? 'ACTIVE' : 'DORMANT'}.`);
                    verified_go_flag = true;
                    break;
                }
            }


            if (!verified_go_flag){
                logger.info(`[SAM util] Did not find activation key in card`);
                let found_entries = [];
                for (let item of wi_entry_arr){
                    found_entries.push(item.comment);
                }
                logger.info(`[SAM util] found ${JSON.stringify(found_entries)}`)
            }
            go_flag = verified_go_flag;

            

        } catch (e) {
            logger.error("[SAM util] Error checking world info activation:", e);
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
    // very inelegant. since there is no distinct frontend or backend, just let UI get it.
    // UI will now listen to the other things.
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

    async function hearStatus(obj){

            currStatus = obj.state;
            shouterName = obj.name;
            console.log(JSON.stringify(obj));
            logger.info(`[SAM] got status ${JSON.stringify(currStatus)} broadcasted by ${JSON.stringify(shouterName)}`);
        
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


    async function findLastAiMessageAndIndex(beforeIndex = -1) {
        const chat = SillyTavern.getContext().chat;
        const searchUntil = (beforeIndex === -1) ? chat.length : beforeIndex;
        for (let i = searchUntil - 1; i >= 0; i--) {
            if (chat[i] && chat[i].is_user === false) return i;
        }
        return -1;
    }

    
    // event listeners.
    const handlers = {

        handleShout: async(state, name) => {
            await hearStatus(state, name);
        },
        handleGenerationEnded: async() => {
            
            let settings = sam_get_settings();
            if (SillyTavern.getContext().chat.length % settings.summary_frequency === 0
        && SillyTavern.getContext().chat.length > 1){
                logger.info("[SAM] Triggered summary naturally")
                await summary();
            }

        }
    };





    
    // ============================================================================
    // == EXPOSED API FOR EXTERNAL SCRIPTS
    // ============================================================================
    

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
        }
    };

    async function sam_enable(){
        sam_settings.enabled = true;
        toastr.success("[SAM utils] summary has been enabled.");
        await saveSamSettings();
    }

    async function sam_disable(){
        sam_settings.enabled = false;
        toastr.success("[SAM utils] summary has been disabled.");
        await saveSamSettings();
    }

    async function summary() {
        try {
            logger.info("[SAM] Starting summary generation...");
            const settings = loadSamSettings();
            const context = SillyTavern.getContext();
            const chat = context.chat;
    
            if (chat.length === 0) {
                logger.info("[SAM] No chat messages to summarize.");
                return;
            }
    
            // 1. Get previous data and messages to summarize
            let current_data = await getVariables();
            const previousSummary = Array.isArray(current_data.responseSummary) && current_data.responseSummary.length > 0
                ? current_data.responseSummary[current_data.responseSummary.length - 1]
                : "";
    
            const messagesToSummarize = chat.slice(-settings.summary_frequency);
            const messageText = messagesToSummarize
                .map(msg => `${msg.name}: ${msg.mes.replace(STATE_BLOCK_REMOVE_REGEX, '').trim()}`)
                .join('\n');
    
            // 2. Construct the text for the AI
            let textForSummarization = messageText;
            if (previousSummary) {
                textForSummarization = `PREVIOUS SUMMARY:\n${previousSummary}\n\nNEW MESSAGES TO ADD:\n${messageText}`;
            }
    
            const promptTemplate = substituteParamsExtended(settings.summary_prompt, { words: settings.summary_words });
            let fullPromptForAI = `${textForSummarization}\n\nINSTRUCTIONS:\n${promptTemplate}`;
            /** @type {import('../../../../../script.js').GenerateQuietPromptParams} */
            const params = {
                            quietPrompt: fullPromptForAI,
                            skipWIAN: true,
                            responseLength: extensionSettings.memory.overrideResponseLength,
                        };
            // 3. Check and handle token limits
            const maxContextTokens = 100000;
            const promptBudget = maxContextTokens - (settings.summary_words * 1.5); // Buffer for response
    
            let tokenCount = await getTokenCountAsync(fullPromptForAI);
    
            if (tokenCount > promptBudget) {
                logger.warn(`[SAM] Prompt is too long (${tokenCount} tokens), truncating...`);
                const lines = textForSummarization.split('\n');
                while (tokenCount > promptBudget && lines.length > 1) {
                    lines.shift(); // Remove oldest lines first
                    textForSummarization = lines.join('\n');
                    fullPromptForAI = `${textForSummarization}\n\nINSTRUCTIONS:\n${promptTemplate}`;
                    tokenCount = await getTokenCountAsync(fullPromptForAI);
                }
            }
            
            if (tokenCount > promptBudget) {
                logger.error(`[SAM] Prompt is still too long after truncation (${tokenCount} tokens). Aborting summary.`);
                return;
            }
    
            // 4. Call the AI to get the summary
            logger.info("[SAM] Sending request to AI for summarization.");
            const summary_result = await generateQuietPrompt(params);
    
            if (!summary_result || summary_result.trim().length === 0) {
                logger.warn("[SAM utils] Summary generation returned an empty result.");
                toastr.error("[SAM utils] Summary generation returned empty result. Is your API ready?");
                return;
            }
    
            logger.info("[SAM] Received summary from AI.");
            
            // 5. Update the state with the new summary
            let updated_data = await getVariables();
            updated_data = goodCopy(updated_data);
    
            if (!Array.isArray(updated_data.responseSummary)) {
                updated_data.responseSummary = [];
            }
            updated_data.responseSummary.push(summary_result.trim());
    
            if (currStatus !== STATES.IDLE) {
                logger.info("[SAM] Core is busy. Waiting for IDLE state before saving summary checkpoint.");
                const maxWaitTime = 150000; // 150 seconds timeout
                const checkInterval = 5000; // Check every 5 seconds
                const startTime = Date.now();

                while (currStatus !== STATES.IDLE) {
                    if (Date.now() - startTime > maxWaitTime) {
                        logger.error("[SAM] Timed out waiting for IDLE state. Summary will be saved on next successful operation.");
                        toastr.error("Timed out waiting for core to be idle. Summary not saved as checkpoint.");
                        return; // Exit the function to prevent saving while busy
                    }
                    
                    logger.info(`[SAM] Current status is ${currStatus}. Requesting status update.`);
                    await eventSource.emit(SAM_EVENTS.EXT_ASK_STATUS);

                    // Wait for a bit before checking again
                    await new Promise(resolve => setTimeout(resolve, checkInterval));
                }
                logger.info("[SAM] Core is now IDLE. Proceeding to save summary.");
            }
    
            logger.info("[SAM] Saving new summary as a checkpoint.");
            await sam_set_data(updated_data);
            toastr.success("[SAM util] Chat summary updated.");
    
        } catch (error) {
            logger.error("[SAM] An error occurred during the summary process.", error);
            toastr.error("[SAM util] Failed to generate chat summary.");
        }
    }

    async function sam_summary(){
        logger.info("[SAM utils] triggered summary manually");
        await summary();
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

    function sam_get_status(){
        return currStatus;
    }
    module.exports = {
        sam_get_data,
        sam_set_data,
        sam_enable,
        sam_disable,
        sam_is_in_use,
        sam_get_status,
        sam_set_setting,
        sam_get_settings,
        sam_summary
    };

    (() => {
        $(async () => {
            console.log("SAM: DOM content loaded. Initializing...");
            try {
                loadSamSettings();

                window[HANDLER_STORAGE_KEY] = handlers;

                eventSource.on(SAM_EVENTS.CORE_STATUS_RESPONSE, handlers.handleShout);
                eventSource.on(eventTypes.GENERATION_ENDED, handlers.handleGenerationEnded);
                
                logger.info(`V${SCRIPT_VERSION} Utility loaded.`);
                session_id = JSON.stringify(new Date());
                sessionStorage.setItem(SESSION_STORAGE_KEY, session_id);

            } catch (error) {
                console.error("SAM: A fatal error occurred during initialization.", error);
            }
        });
    })();

})();
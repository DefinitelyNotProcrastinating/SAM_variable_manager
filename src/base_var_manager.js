// ============================================================================
// == Situational Awareness Manager (UI EXTENSION BACKEND)
// == Version: 4.1.0 "Quark"
// ==
// == This script is the backend for the SAM UI extension. It communicates
// == with the SAM Core Engine script (core.js) via a dedicated event protocol.
// ==
// == Responsibilities:
// == - Provides an API for the React frontend (App.js).
// == - Manages automatic response summarization based on user settings.
// == - Handles safe, asynchronous committing of state changes to the core engine.
// == - Listens for updates from the core engine to keep the UI in sync.
// ============================================================================

import {
    getContext,
    extension_settings,
    saveSettingsDebounced,
    generateQuietPrompt,
    substituteParamsExtended,
    eventSource,
    event_types,
} from '../../../../script.js';

// --- Configuration & Constants ---
const MODULE_NAME = 'sam_ui_extension';
const SCRIPT_VERSION = "4.1.0";
const logger = {
    info: (...args) => console.log(`[SAM Extension ${SCRIPT_VERSION}]`, ...args),
    warn: (...args) => console.warn(`[SAM Extension ${SCRIPT_VERSION}]`, ...args),
    error: (...args) => console.error(`[SAM Extension ${SCRIPT_VERSION}]`, ...args),
};


// Event protocol to communicate with core.js
const SAM_EVENTS = {
    CORE_UPDATED: 'SAM_CORE_UPDATED',
    EXT_ASK_STATUS: 'SAM_EXT_ASK_STATUS',
    CORE_STATUS_RESPONSE: 'SAM_CORE_STATUS_RESPONSE',
    EXT_COMMIT_STATE: 'SAM_EXT_COMMIT_STATE',
};

const DEFAULT_SETTINGS = Object.freeze({
    summary_enabled: true,
    summary_frequency: 10, // Run summary every 10 AI messages
    summary_words: 150,
    summary_prompt: 'You are a story summarization engine. Your task is to analyze the following conversation snippet and provide a concise summary of the key events, character actions, and important new information. Integrate these new points with the provided "Existing Summary". Respond ONLY with the new, updated summary.\n\nExisting Summary:\n{{existingSummary}}\n\nConversation to Summarize:\n{{text}}',
});

// --- State Management ---
let isSummarizing = false;
let uiUpdateCallback = null; // Callback for the React UI

function loadSettings() {
    if (Object.keys(extension_settings[MODULE_NAME] ?? {}).length === 0) {
        extension_settings[MODULE_NAME] = { ...DEFAULT_SETTINGS };
    }
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (extension_settings[MODULE_NAME][key] === undefined) {
            extension_settings[MODULE_NAME][key] = DEFAULT_SETTINGS[key];
        }
    }
}

// --- Core Communication ---

/**
 * Safely asks the core engine if it's idle and ready for a commit.
 * @returns {Promise<boolean>} A promise that resolves to true if the core is idle.
 */
function isCoreIdle() {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            logger.warn("Core status request timed out. Assuming not idle.");
            resolve(false);
        }, 2000);

        const handleResponse = (event) => {
            clearTimeout(timeout);
            window.removeEventListener(SAM_EVENTS.CORE_STATUS_RESPONSE, handleResponse);
            resolve(event.detail.isIdle);
        };

        window.addEventListener(SAM_EVENTS.CORE_STATUS_RESPONSE, handleResponse, { once: true });
        dispatchEvent(new CustomEvent(SAM_EVENTS.EXT_ASK_STATUS));
    });
}


// ============================================================================
// == API FOR REACT FRONTEND (App.js)
// ============================================================================

function sam_register_update_callback(callback) {
    if (typeof callback === 'function') {
        uiUpdateCallback = callback;
        logger.info("UI Update Callback registered.");
    } else {
        logger.warn("Attempted to register an invalid UI callback.");
    }
}

async function sam_get_data() {
    try {
        const context = getContext();
        if (!context.variables.local.get("SAM_data")) {
             context.variables.local.set("SAM_data", { static: {}, time: "", volatile: [], responseSummary: [], func: [], events: [], event_counter: 0 });
        }
        return context.variables.local.get("SAM_data");
    } catch (error) {
        logger.error("[API] Failed to get SAM_data from variables.", error);
        return null;
    }
}

async function sam_set_data(newData) {
    if (typeof newData !== 'object' || newData === null) {
        logger.error("sam_set_data requires a valid object.");
        throw new Error("Invalid data provided to sam_set_data.");
    }

    logger.info("Attempting to commit new state to core...");
    const isIdle = await isCoreIdle();

    if (!isIdle) {
        logger.warn("Commit rejected: Core engine is busy.");
        toastr.warning("SAM Core is busy processing. Please try saving again in a moment.");
        throw new Error("Core engine is busy.");
    }

    dispatchEvent(new CustomEvent(SAM_EVENTS.EXT_COMMIT_STATE, { detail: newData }));
    logger.info("Commit request sent to core engine.");
}

function sam_get_settings() {
    loadSettings();
    return extension_settings[MODULE_NAME];
}

async function sam_set_setting(key, value) {
    try {
        extension_settings[MODULE_NAME][key] = value;
        saveSettingsDebounced();
    } catch (error) {
        logger.error(`Failed to save setting ${key}:`, error);
        toastr.error(`Failed to save setting: ${key}`);
    }
}

// ============================================================================
// == AUTOMATIC SUMMARIZATION LOGIC
// ============================================================================

function countMessagesSinceLastSummary(chat) {
    let lastSummaryTurn = -1;
    for (let i = chat.length - 1; i >= 0; i--) {
        const msg = chat[i];
        if (!msg.is_user && msg.extra?.sam_summary_applied) {
            lastSummaryTurn = i;
            break;
        }
    }
    if (lastSummaryTurn === -1) {
        return chat.filter(m => !m.is_system).length;
    }
    return chat.slice(lastSummaryTurn + 1).filter(m => !m.is_system).length;
}

async function generateAndSaveSummary() {
    if (isSummarizing) {
        logger.info("Summarization skipped: a summary is already in progress.");
        return;
    }
    const coreIsIdle = await isCoreIdle();
    if (!coreIsIdle) {
        logger.info("Summarization skipped: core engine is busy.");
        toastr.info("Cannot summarize right now, SAM Core is busy.", "SAM");
        return;
    }

    isSummarizing = true;
    try {
        logger.info("Initiating summary generation...");
        const context = getContext();
        const samData = await sam_get_data();
        const settings = sam_get_settings();

        let lastSummaryIndex = -1;
        for (let i = context.chat.length - 1; i >= 0; i--) {
            if (context.chat[i].extra?.sam_summary_applied) {
                lastSummaryIndex = i;
                break;
            }
        }
        const messagesToSummarize = context.chat
            .slice(lastSummaryIndex + 1)
            .filter(m => !m.is_system && m.mes?.trim() !== '');

        if (messagesToSummarize.length === 0) {
             logger.info("No new messages to summarize.");
             toastr.info("No new messages to summarize.", "SAM");
             return;
        }

        const conversationText = messagesToSummarize.map(m => `${m.name}: ${m.mes}`).join('\n');
        const existingSummary = (samData.responseSummary || []).join('\n');
        const prompt = substituteParamsExtended(settings.summary_prompt, {
            existingSummary: existingSummary || "None.",
            text: conversationText,
            words: settings.summary_words,
        });

        const toast = toastr.info("Generating new summary...", "SAM", { timeOut: 0, extendedTimeOut: 0 });
        const result = await generateQuietPrompt(prompt, true);
        toastr.clear(toast);

        if (!result) {
            toastr.warning("Summary generation returned an empty result.", "SAM");
            return;
        }

        const latestSamData = await sam_get_data();
        const newSummaries = result.split('\n').filter(line => line.trim() !== "");
        latestSamData.responseSummary = newSummaries;

        const lastMessageIndex = context.chat.length - 1;
        if (context.chat[lastMessageIndex]) {
             if (!context.chat[lastMessageIndex].extra) context.chat[lastMessageIndex].extra = {};
             context.chat[lastMessageIndex].extra.sam_summary_applied = true;
        }

        await sam_set_data(latestSamData);
        toastr.success("Story summary updated.", "SAM");

    } catch (error) {
        logger.error("An error occurred during summarization:", error);
        toastr.error("Failed to generate summary. Check console.", "SAM");
    } finally {
        isSummarizing = false;
    }
}

async function onMessageRendered() {
    const settings = sam_get_settings();
    if (!settings.summary_enabled || settings.summary_frequency <= 0) {
        return;
    }

    const context = getContext();
    const messagesSince = countMessagesSinceLastSummary(context.chat);

    if (messagesSince >= settings.summary_frequency) {
        logger.info(`Summary trigger condition met: ${messagesSince} messages since last summary (threshold: ${settings.summary_frequency}).`);
        await generateAndSaveSummary();
    }
}

// ============================================================================
// == INITIALIZATION
// ============================================================================

jQuery(async function () {
    loadSettings();

    window.addEventListener(SAM_EVENTS.CORE_UPDATED, (e) => {
        logger.info("Received CORE_UPDATED event. Notifying UI.", e.detail);
        if (uiUpdateCallback) {
            setTimeout(() => uiUpdateCallback(), 0);
        }
    });

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageRendered);

    window.SituationalAwarenessManagerUI = {
        sam_get_data,
        sam_set_data,
        sam_get_settings,
        sam_set_setting,
        sam_register_update_callback,
        forceSummary: generateAndSaveSummary,
    };

    logger.info("UI Extension Backend initialized.");
});
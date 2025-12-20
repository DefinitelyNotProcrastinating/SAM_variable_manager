import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import Draggable from 'react-draggable';
import JSONEditor from 'react-json-editor-ajrm';
import locale from 'react-json-editor-ajrm/locale/en';
import {
    sam_get_data,
    sam_set_data,
    sam_get_settings,
    sam_set_setting,
    sam_is_in_use,
    sam_summary
} from './backend.js';
import './App.css';

// Access SillyTavern Context and Global Helper
var { eventSource, eventTypes } = SillyTavern.getContext();
var _ = require('lodash');

const SAM_EVENTS = {
    CORE_UPDATED: 'SAM_CORE_UPDATED',
    EXT_ASK_STATUS: 'SAM_EXT_ASK_STATUS',
    CORE_STATUS_RESPONSE: 'SAM_CORE_STATUS_RESPONSE',
    EXT_COMMIT_STATE: 'SAM_EXT_COMMIT_STATE',
    CORE_IDLE: 'SAM_CORE_IDLE',
    INV: 'SAM_INV' 
};

// directly store it under identifier. (since we cannot do anything about it)
const SAM_FUNCTIONLIB_ID = "__SAM_IDENTIFIER__";

// --- Helper Components ---

const ToggleSwitch = ({ label, value, onChange }) => (
    <div className="sam_form_row">
        <label className="sam_label">{label}</label>
        <div className="sam_toggle" onClick={() => onChange(!value)}>
            <div className={`sam_toggle_track ${value ? 'on' : 'off'}`}>
                <div className="sam_toggle_thumb" />
            </div>
        </div>
    </div>
);

const InputRow = ({ label, type = "text", value, onChange, placeholder }) => (
    <div className="sam_form_row">
        <label className="sam_label">{label}</label>
        <input
            type={type}
            className="sam_input"
            value={value}
            onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
            placeholder={placeholder}
        />
    </div>
);

// --- Sub-Panels ---

const SettingsPanel = ({ settings, setSettings }) => {
    const handleChange = (key, val) => {
        setSettings(prev => ({ ...prev, [key]: val }));
    };

    const handleSaveSettings = async () => {
        try {
            const generalSettings = { ...settings };
            delete generalSettings.summary_frequency;
            delete generalSettings.summary_prompt;
            delete generalSettings.summary_words;

            for (const key of Object.keys(generalSettings)) {
                await sam_set_setting(key, generalSettings[key]);
            }
            toastr.success("General settings saved successfully.");
        } catch (e) {
            console.error(e);
            toastr.error("Error saving general settings: " + e.message);
        }
    };

    return (
        <div className="sam_panel_content">
            <h3 className="sam_section_title">General Configuration</h3>
            <ToggleSwitch
                label="Enable SAM"
                value={settings.enabled}
                onChange={(v) => handleChange('enabled', v)}
            />
            <ToggleSwitch
                label="Disable Data Type Mutation"
                value={settings.disable_dtype_mutation}
                onChange={(v) => handleChange('disable_dtype_mutation', v)}
            />
            <ToggleSwitch
                label="Uniquely Identified Paths"
                value={settings.uniquely_identified}
                onChange={(v) => handleChange('uniquely_identified', v)}
            />

            <h3 className="sam_section_title">Checkpointing</h3>
            <ToggleSwitch
                label="Auto Checkpoint"
                value={settings.enable_auto_checkpoint}
                onChange={(v) => handleChange('enable_auto_checkpoint', v)}
            />
            {settings.enable_auto_checkpoint && (
                <InputRow
                    label="Checkpoint Frequency (Rounds)"
                    type="number"
                    value={settings.checkpoint_frequency}
                    onChange={(v) => handleChange('checkpoint_frequency', v)}
                />
            )}
            <div className="sam_actions" style={{ marginTop: '20px' }}>
                <button onClick={handleSaveSettings} className="sam_btn sam_btn_primary">Save General Settings</button>
            </div>
        </div>
    );
};

const FunctionEditor = ({ functions, setFunctions, onCommit }) => {
    const [selectedIndex, setSelectedIndex] = useState(-1);

    const handleAdd = () => {
        const newFunc = {
            func_name: "new_function",
            func_params: [],
            func_body: "// write code here\n// args: state, _, fetch, XMLHttpRequest\nreturn true;",
            timeout: 2000,
            periodic: false,
            network_access: false,
            order: "normal"
        };
        setFunctions([...functions, newFunc]);
        setSelectedIndex(functions.length);
    };

    const handleDelete = (index) => {
        if (!window.confirm("Delete this function?")) return;
        const newFuncs = [...functions];
        newFuncs.splice(index, 1);
        setFunctions(newFuncs);
        setSelectedIndex(-1);
    };

    const updateFunc = (index, field, value) => {
        const newFuncs = [...functions];
        newFuncs[index] = { ...newFuncs[index], [field]: value };
        setFunctions(newFuncs);
    };

    const selectedFunc = functions[selectedIndex];

    return (
        <div className="sam_panel_split">
            <div className="sam_sidebar_list">
                <div className="sam_list_header">
                    <span>Functions (WI)</span>
                    <button className="sam_btn_small" onClick={handleAdd}>+</button>
                </div>
                <ul>
                    {functions.map((f, i) => (
                        <li
                            key={i}
                            className={i === selectedIndex ? 'active' : ''}
                            onClick={() => setSelectedIndex(i)}
                        >
                            {f.func_name}
                            <span className="sam_delete_icon" onClick={(e) => { e.stopPropagation(); handleDelete(i); }}>×</span>
                        </li>
                    ))}
                </ul>
                <div style={{padding: '10px'}}>
                    <button className="sam_btn sam_btn_primary full_width" onClick={onCommit}>
                        Save to World Info
                    </button>
                </div>
            </div>
            <div className="sam_detail_view">
                {selectedFunc ? (
                    <div className="sam_scrollable_form">
                        <InputRow
                            label="Function Name"
                            value={selectedFunc.func_name}
                            onChange={(v) => updateFunc(selectedIndex, 'func_name', v)}
                        />
                        <div className="sam_form_row">
                            <label className="sam_label">Params (comma separated)</label>
                            <input
                                className="sam_input"
                                value={(selectedFunc.func_params || []).join(', ')}
                                onChange={(e) => updateFunc(selectedIndex, 'func_params', e.target.value.split(',').map(s => s.trim()))}
                            />
                        </div>
                        <div className="sam_form_column">
                            <label className="sam_label">Function Body (JS)</label>
                            <textarea
                                className="sam_code_editor"
                                value={selectedFunc.func_body}
                                onChange={(e) => updateFunc(selectedIndex, 'func_body', e.target.value)}
                            />
                        </div>
                        <div className="sam_form_grid">
                            <InputRow
                                label="Timeout (ms)"
                                type="number"
                                value={selectedFunc.timeout}
                                onChange={(v) => updateFunc(selectedIndex, 'timeout', v)}
                            />
                             <div className="sam_form_row">
                                <label className="sam_label">Exec Order</label>
                                <select
                                    className="sam_select"
                                    value={selectedFunc.order || 'normal'}
                                    onChange={(e) => updateFunc(selectedIndex, 'order', e.target.value)}
                                >
                                    <option value="first">First</option>
                                    <option value="normal">Normal</option>
                                    <option value="last">Last</option>
                                </select>
                            </div>
                        </div>
                         <div className="sam_form_grid">
                            <ToggleSwitch
                                label="Periodic Eval"
                                value={selectedFunc.periodic}
                                onChange={(v) => updateFunc(selectedIndex, 'periodic', v)}
                            />
                            <ToggleSwitch
                                label="Network Access"
                                value={selectedFunc.network_access}
                                onChange={(v) => updateFunc(selectedIndex, 'network_access', v)}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="sam_empty_state">Select a function to edit</div>
                )}
            </div>
        </div>
    );
};


// --- Main App Component ---

function App() {
    const [showInterface, setShowInterface] = useState(false);
    const [activeTab, setActiveTab] = useState('DATA');
    
    const [draftSamData, setDraftSamData] = useState({});
    const [draftSamSettings, setDraftSamSettings] = useState({});
    const [draftFunctions, setDraftFunctions] = useState([]);
    
    const [summaries, setSummaries] = useState("");
    const [isDataReady, setIsDataReady] = useState(false);
    const [isBusy, setIsBusy] = useState(false);
    const [samStatusText, setSamStatusText] = useState("IDLE");
    
    const [portalContainer, setPortalContainer] = useState(null);
    const nodeRef = useRef(null);

    // --- Helpers for World Info Functions ---
    const getFunctionsFromWI = async () => {
        try {
            const context = SillyTavern.getContext();
            const charId = context.characterId;
            if (!context.characters[charId]) return [];

            const worldInfoName = context.characters[charId].data.extensions.world;
            if (!worldInfoName) return [];

            const wiData = await context.loadWorldInfo(worldInfoName);
            if (!wiData || !wiData.entries) return [];

            // Find the function library entry using lodash find on the entries object values
            const funcEntry = _.find(wiData.entries, (entry) => 
                entry.comment === SAM_FUNCTIONLIB_ID || entry.uid === SAM_FUNCTIONLIB_ID
            );
            
            if (funcEntry && funcEntry.content) {
                try {
                    const parsed = JSON.parse(funcEntry.content);
                    return Array.isArray(parsed) ? parsed : [];
                } catch (e) {
                    console.error("SAM: Failed to parse Function Lib from WI", e);
                    return [];
                }
            }
            return [];
        } catch (e) {
            console.error("SAM: Error fetching functions from WI", e);
            return [];
        }
    };

    const saveFunctionsToWI = async (functions) => {
        const context = SillyTavern.getContext();
        const charId = context.characterId;
        const character = context.characters[charId];
        const worldInfoName = character.data.extensions.world;

        if (!worldInfoName) {
            toastr.error("No World Info file associated with this character. Please create one first.");
            return;
        }

        const funcString = JSON.stringify(functions, null, 2);

        try {
            // Using TavernHelper.updateWorldbookWith to safely update the specific entry
            await TavernHelper.updateWorldbookWith(worldInfoName, (worldbook) => {
                const entries = worldbook.entries;
                
                // Locate the key of the existing entry
                const entryKey = _.findKey(entries, (entry) => 
                    entry.name === SAM_FUNCTIONLIB_ID
                );

                const entryData = {
                    content: funcString,
                    name: SAM_FUNCTIONLIB_ID,
                    enabled: false,
                    constant: false,
                };

                if (entryKey) {
                    // Update existing entry using lodash merge to preserve ID/uid if present, 
                    // but overwrite content/keys/etc.
                    _.merge(entries[entryKey], entryData);
                } else {
                    // Create new entry
                    // Find a free numeric index
                    let newIndex = 0;
                    while (entries[String(newIndex)]) newIndex++;
                    
                    entries[String(newIndex)] = { 
                        ...entryData, 
                        id: newIndex, 
                        uid: newIndex // Ensuring compatibility
                    };
                }
                console.log(`Function string: ${funcString}`);
                console.log(`new WI: ${JSON.stringify(worldbook)}`)

                return worldbook;
            });

            toastr.success("Functions saved to World Info Library.");
        } catch (e) {
            console.error(e);
            toastr.error("Failed to save functions to WI.");
        }
    };

    // --- Data Loading & refreshing ---

    const refreshData = useCallback(async () => {
        if (!await sam_is_in_use()) {
            return;
        }

        try {
            const rawData = await sam_get_data();
            const settings = await sam_get_settings();
            const funcs = await getFunctionsFromWI();

            if (rawData) {
                if (!rawData.static) rawData.static = {};
                
                if (!showInterface) {
                    setDraftSamData(rawData);
                    setSummaries((rawData.responseSummary || []).join('\n'));
                }
            }
            
            if (settings) setDraftSamSettings(settings);
            if (funcs) setDraftFunctions(funcs);

            if (!isDataReady) setIsDataReady(true);
            console.log("SAM UI: Data refreshed via INV event.");
        } catch (e) {
            console.error("SAM UI Refresh Error:", e);
        }
    }, [showInterface, isDataReady]);

    // --- Event Listeners ---

    useEffect(() => {
        const onInvalidate = () => {
            refreshData();
        };

        const onStatusResponse = (data) => {
            if (data && data.state) {
                setSamStatusText(data.state);
                const busyStates = ["AWAIT_GENERATION", "PROCESSING"];
                setIsBusy(busyStates.includes(data.state));
            }
        };

        eventSource.on(SAM_EVENTS.INV, onInvalidate);
        eventSource.on(SAM_EVENTS.CORE_STATUS_RESPONSE, onStatusResponse);

        refreshData();

        const container = document.createElement('div');
        container.id = 'sam-portal-root';
        document.body.appendChild(container);
        setPortalContainer(container);

        return () => {
            //eventSource.off(SAM_EVENTS.INV, onInvalidate);
            //eventSource.off(SAM_EVENTS.CORE_STATUS_RESPONSE, onStatusResponse);
            if (container.parentNode) container.parentNode.removeChild(container);
        };
    }, [refreshData]);

    // --- Heartbeat for Status ---
    useEffect(() => {
        if (!showInterface) return;
        
        const interval = setInterval(() => {
            eventSource.emit(SAM_EVENTS.EXT_ASK_STATUS);
        }, 1000);

        return () => clearInterval(interval);
    }, [showInterface]);


    // --- Handlers ---

    const handleManualRefresh = () => {
        if (window.confirm("Refresh data? Unsaved changes will be lost.")) {
            refreshData();
            toastr.info("UI Refreshed.");
        }
    };

    const handleCommitData = async () => {
        try {
            const cleanData = { ...draftSamData };
            cleanData.responseSummary = summaries.split('\n').filter(l => l.trim() !== "");
            
            await sam_set_data(cleanData);
            toastr.success("Data committed to State.");
        } catch (e) {
            console.error(e);
            toastr.error("Error committing data: " + e.message);
        }
    };

    const handleCommitFunctions = async () => {
        if (window.confirm("This will overwrite the Function Library in World Info. Continue?")) {
            await saveFunctionsToWI(draftFunctions);
        }
    };

    const handleSummaryChange = (e) => {
        setSummaries(e.target.value);
    };

    const handleSaveSummarySettings = async () => {
        try {
            await sam_set_setting('summary_frequency', draftSamSettings.summary_frequency);
            await sam_set_setting('summary_prompt', draftSamSettings.summary_prompt);
            await sam_set_setting('summary_words', draftSamSettings.summary_words);
            toastr.success("Summary settings saved.");
        } catch (e) {
            console.error(e);
            toastr.error("Error saving summary settings.");
        }
    };

    const handleTriggerSummary = async () => {
        if (isBusy) {
            toastr.warning("Core is busy. Cannot run summary now.");
            return;
        }
        toastr.info("Triggering manual summary...");
        await sam_summary();
    };

    const handleJsonChange = (content) => {
        if (content.jsObject) {
            setDraftSamData(content.jsObject);
        }
    };

    // --- Render ---

    const modalContent = (
        <div className="sam_modal_overlay">
            <Draggable handle=".sam_modal_header" nodeRef={nodeRef}>
                <div className="sam_app_window" ref={nodeRef} style={activeTab === 'SUMMARY' ? { height: '100vh' } : {}}>
                    <div className="sam_modal_header">
                        <div className="sam_header_title">
                            <span className="sam_brand">SAM</span> MANAGER
                            <span className="sam_version"> v4.0.5</span>
                        </div>
                        <button onClick={() => setShowInterface(false)} className="sam_close_icon">✕</button>
                    </div>

                    <div className="sam_tabs">
                        <button className={`sam_tab ${activeTab === 'DATA' ? 'active' : ''}`} onClick={() => setActiveTab('DATA')}>
                            Data
                        </button>
                        <button className={`sam_tab ${activeTab === 'SUMMARY' ? 'active' : ''}`} onClick={() => setActiveTab('SUMMARY')}>
                            Summary
                        </button>
                        <button className={`sam_tab ${activeTab === 'FUNCS' ? 'active' : ''}`} onClick={() => setActiveTab('FUNCS')}>
                            Functions
                        </button>
                        <button className={`sam_tab ${activeTab === 'SETTINGS' ? 'active' : ''}`} onClick={() => setActiveTab('SETTINGS')}>
                            Settings
                        </button>
                    </div>

                    <div className="sam_content_area">
                        {activeTab === 'DATA' && (
                            <div className={`sam_panel_content ${isBusy ? 'disabled' : ''}`}>
                                <h4 className="sam_panel_label">
                                    Raw JSON State {isBusy ? "(Locked - Core Busy)" : ""}
                                </h4>
                                <div className="sam_json_wrapper">
                                    {isDataReady ? (
                                        <JSONEditor
                                            id="sam_json_edit"
                                            placeholder={draftSamData}
                                            onChange={handleJsonChange}
                                            locale={locale}
                                            theme="dark_vscode_tribute"
                                            height="100%"
                                            width="100%"
                                            colors={{ background: 'transparent' }}
                                            viewOnly={isBusy}
                                        />
                                    ) : (
                                        <div className="sam_empty_state">Loading data...</div>
                                    )}
                                </div>
                                <div className="sam_actions" style={{marginTop: '10px'}}>
                                    <button 
                                        onClick={handleCommitData} 
                                        className="sam_btn sam_btn_primary"
                                        disabled={isBusy}
                                    >
                                        Commit Data Changes
                                    </button>
                                </div>
                            </div>
                        )}

                        {activeTab === 'SUMMARY' && (
                            <div className="sam_panel_content full_height layout_column">
                                <div className="sam_summary_settings_section">
                                    <h3 className="sam_section_title">Summary Configuration</h3>
                                    <div className="sam_form_grid">
                                        <div className="sam_form_row sam_inline_input">
                                            <label className="sam_label">Frequency (responses)</label>
                                            <input
                                                type="number"
                                                className="sam_input small_input"
                                                value={draftSamSettings.summary_frequency || ''}
                                                onChange={(e) => setDraftSamSettings(p => ({...p, summary_frequency: Number(e.target.value)}))}
                                                placeholder="30"
                                            />
                                        </div>
                                        <div className="sam_form_row sam_inline_input">
                                            <label className="sam_label">Max Words</label>
                                            <input
                                                type="number"
                                                className="sam_input small_input"
                                                value={draftSamSettings.summary_words || ''}
                                                onChange={(e) => setDraftSamSettings(p => ({...p, summary_words: Number(e.target.value)}))}
                                                placeholder="150"
                                            />
                                        </div>
                                    </div>
                                     <div className="sam_form_column">
                                        <label className="sam_label">Summary Prompt</label>
                                        <textarea
                                            className="sam_textarea_medium"
                                            value={draftSamSettings.summary_prompt || ''}
                                            onChange={(e) => setDraftSamSettings(p => ({...p, summary_prompt: e.target.value}))}
                                            placeholder="Enter the prompt for generating summaries..."
                                        />
                                    </div>
                                    <div className="sam_actions">
                                        <button onClick={handleSaveSummarySettings} className="sam_btn sam_btn_primary">Save Config</button>
                                        <button onClick={handleTriggerSummary} className="sam_btn sam_btn_secondary" disabled={isBusy}>
                                            Generate Summary Now
                                        </button>
                                    </div>
                                </div>
                                <hr className="sam_divider" />
                                 <h4 className="sam_panel_label">Saved Response Summaries</h4>
                                <textarea
                                    className="sam_textarea_full"
                                    value={summaries}
                                    onChange={handleSummaryChange}
                                    placeholder="One summary per line..."
                                />
                                <div className="sam_actions" style={{marginTop:'5px'}}>
                                     <button onClick={handleCommitData} className="sam_btn sam_btn_primary" disabled={isBusy}>
                                        Save Summaries (Commit Data)
                                    </button>
                                </div>
                            </div>
                        )}

                        {activeTab === 'FUNCS' && (
                            <FunctionEditor
                                functions={draftFunctions}
                                setFunctions={setDraftFunctions}
                                onCommit={handleCommitFunctions}
                            />
                        )}

                        {activeTab === 'SETTINGS' && (
                            <SettingsPanel
                                settings={draftSamSettings}
                                setSettings={setDraftSamSettings}
                            />
                        )}
                    </div>

                    <div className="sam_modal_footer">
                        <div className="sam_status_bar">
                            Status: {draftSamSettings.enabled ? "Active" : "Disabled"} | Core State: <span className={isBusy ? 'busy' : 'idle'}>{samStatusText}</span>
                        </div>
                        <div className="sam_actions">
                            <button onClick={handleManualRefresh} className="sam_btn sam_btn_secondary">Refresh UI</button>
                            <button onClick={() => setShowInterface(false)} className="sam_btn sam_btn_secondary">Close</button>
                        </div>
                    </div>
                </div>
            </Draggable>
        </div>
    );

    return (
        <>
            <div className="sam_trigger_wrapper">
                <button onClick={() => setShowInterface(true)} className="sam_menu_button">
                    SAM 4.0 Config
                </button>
            </div>
            {showInterface && portalContainer && ReactDOM.createPortal(modalContent, portalContainer)}
        </>
    );
}

export default App;
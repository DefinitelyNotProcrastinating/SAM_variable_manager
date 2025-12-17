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
    sam_get_state,
} from './base_var_manager.js';
import './App.css';

// --- Helper Components (No changes needed here) ---
var { eventSource, event_types } = SillyTavern.getContext();

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
            // Filter out summary-specific settings, as they are saved elsewhere
            const generalSettings = { ...settings };
            delete generalSettings.summary_frequency;
            delete generalSettings.summary_prompt;

            for (const key of Object.keys(generalSettings)) {
                await sam_set_setting(key, generalSettings[key]);
            }
            alert("General settings saved successfully.");
        } catch (e) {
            console.error(e);
            alert("Error saving general settings: " + e.message);
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

const FunctionEditor = ({ functions, setFunctions }) => {
    const [selectedIndex, setSelectedIndex] = useState(-1);

    const handleAdd = () => {
        const newFunc = {
            func_name: "new_function",
            func_params: [],
            func_body: "// write code here\nreturn true;",
            timeout: 2000,
            periodic: false,
            network_access: false,
            order: "normal"
        };
        setFunctions([...functions, newFunc]);
        setSelectedIndex(functions.length);
    };

    const handleDelete = (index) => {
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
                    <span>Functions</span>
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
    const [liveSamData, setLiveSamData] = useState({});
    const [summaries, setSummaries] = useState("");
    const [isDataReady, setIsDataReady] = useState(false);
    const [isBusy, setIsBusy] = useState(false);
    const [samStatusText, setSamStatusText] = useState("IDLE");
    const [portalContainer, setPortalContainer] = useState(null);
    const nodeRef = useRef(null);

    const refreshDataAndSummary = useCallback(async () => {
        const rawData = await sam_get_data();
        if (rawData) {
            if (!rawData.static) rawData.static = {};
            if (!rawData.func) rawData.func = [];
            if (!rawData.responseSummary) rawData.responseSummary = [];
            setLiveSamData(rawData);
            setDraftSamData(rawData);
            setSummaries(rawData.responseSummary.join('\n'));
        }
    }, []);

    // Effect to listen for prompt-ready event and refresh data
    useEffect(() => {
        const handlePromptReady = () => {
            console.log("ATTEMPTING TO REFRESH due to SAM CARD SWITCH ");
            if (sam_is_in_use()) {
                refreshDataAndSummary();
            }
            console.log("REFRESH COMPLETED");
        };
        eventSource = SillyTavern.getContext().eventSource;
        event_types = SillyTavern.getContext().eventTypes;


        if (eventSource && event_types) {
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, handlePromptReady);
        }

        return () => {
            if (eventSource && event_types && (!sam_is_in_use())) {
                eventSource.off(event_types.CHAT_COMPLETION_PROMPT_READY, handlePromptReady);
            }
        };
    }, [refreshDataAndSummary]);


    useEffect(() => {
        const container = document.createElement('div');
        container.id = 'sam-portal-root';
        document.body.appendChild(container);
        setPortalContainer(container);

        return () => {
            if (container.parentNode) {
                container.parentNode.removeChild(container);
            }
        };
    }, []);

    const loadInitialData = useCallback(async (showAlerts = false) => {
        try {
            await refreshDataAndSummary();
            const settings = await sam_get_settings();
            setDraftSamSettings(settings || {});

            if (!isDataReady) setIsDataReady(true);
        } catch (e) {
            console.error("SAM UI Error during initial load:", e);
            if (showAlerts) alert("Failed to load SAM data/settings.");
        }
    }, [isDataReady, refreshDataAndSummary]);

    const handleRefresh = () => {
        if (window.confirm("Are you sure you want to refresh? This will discard any unsaved changes.")) {
             setDraftSamData(liveSamData);
             setSummaries(liveSamData.responseSummary.join('\n'));
             sam_get_settings().then(setDraftSamSettings);
             alert("UI has been refreshed with the latest saved data.");
        }
    };

    useEffect(() => {
        if (showInterface) {
            loadInitialData(true);
        } else {
            setIsDataReady(false);
            setIsBusy(false);
        }
    }, [showInterface, loadInitialData]);

    useEffect(() => {
        if (!showInterface || !isDataReady) return;

        const intervalId = setInterval(async () => {
            try {
                const currentState = await sam_get_state();
                const busyStates = ["AWAIT_GENERATION", "PROCESSING"];
                const isCurrentlyBusy = busyStates.includes(currentState);

                setIsBusy(isCurrentlyBusy);
                setSamStatusText(currentState);

                if (!isCurrentlyBusy) {
                    const rawData = await sam_get_data();
                    if(rawData) setLiveSamData(rawData);
                }
            } catch (e) {
                console.error("SAM UI periodic refresh failed:", e);
                clearInterval(intervalId);
            }
        }, 2000);

        return () => clearInterval(intervalId);
    }, [showInterface, isDataReady]);

    const handleSummaryChange = (e) => {
        const val = e.target.value;
        setSummaries(val);
        const arr = val.split('\n').filter(line => line.trim() !== "");
        setDraftSamData(prev => ({ ...prev, responseSummary: arr }));
    };
    
    const handleSettingsChange = (key, val) => {
        setDraftSamSettings(prev => ({...prev, [key]: val}));
    };

    const handleJsonChange = (content) => {
        if (content.jsObject) {
            setDraftSamData(content.jsObject);
        }
    };
    
    const handleSaveSummarySettings = async () => {
        try {
            await sam_set_setting('summary_frequency', draftSamSettings.summary_frequency);
            await sam_set_setting('summary_prompt', draftSamSettings.summary_prompt);
            alert("Summary settings saved successfully.");
        } catch (e) {
             console.error(e);
            alert("Error saving summary settings: " + e.message);
        }
    };

    const handleCommitData = async () => {
        try {
            await sam_set_data(draftSamData);
            alert("SAM data and summaries saved successfully.");
            setLiveSamData(draftSamData);
            setShowInterface(false);
        } catch (e) {
            console.error(e);
            alert("Error saving data: " + e.message);
        }
    };

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
                                <h4 className="sam_panel_label">Raw JSON State {isBusy ? "(Locked during generation)" : ""}</h4>
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
                            </div>
                        )}
                        {activeTab === 'SUMMARY' && (
                            <div className="sam_panel_content full_height layout_column">
                                <div className="sam_summary_settings_section">
                                    <h3 className="sam_section_title">Summary Generation Settings</h3>
                                    <div className="sam_form_row sam_inline_input">
                                         <label className="sam_label">Summary Frequency: once per</label>
                                         <input
                                            type="number"
                                            className="sam_input small_input"
                                            value={draftSamSettings.summary_frequency || ''}
                                            onChange={(e) => handleSettingsChange('summary_frequency', Number(e.target.value))}
                                            placeholder="5"
                                        />
                                        <label className="sam_label">responses</label>
                                    </div>
                                     <div className="sam_form_column">
                                        <label className="sam_label">Summary Prompt</label>
                                        <textarea
                                            className="sam_textarea_medium"
                                            value={draftSamSettings.summary_prompt || ''}
                                            onChange={(e) => handleSettingsChange('summary_prompt', e.target.value)}
                                            placeholder="Enter the prompt for generating summaries..."
                                        />
                                    </div>
                                    <div className="sam_actions">
                                        <button onClick={handleSaveSummarySettings} className="sam_btn sam_btn_primary">Save Summary Settings</button>
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
                            </div>
                        )}
                        {activeTab === 'FUNCS' && (
                            <FunctionEditor
                                functions={draftSamData.func || []}
                                setFunctions={(newFuncs) => setDraftSamData(prev => ({ ...prev, func: newFuncs }))}
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
                            Status: {draftSamSettings.enabled ? "Active" : "Disabled"} | State: <span className={isBusy ? 'busy' : 'idle'}>{samStatusText}</span>
                        </div>
                        <div className="sam_actions">
                            <button onClick={handleRefresh} className="sam_btn sam_btn_secondary">Refresh UI</button>
                            <button onClick={() => setShowInterface(false)} className="sam_btn sam_btn_secondary">Cancel</button>
                            <button onClick={handleCommitData} className="sam_btn sam_btn_primary">Commit Data Changes</button>
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
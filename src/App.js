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
    sam_is_in_use
} from './backend.js';
import './App.css';
var { eventSource, eventTypes, extensionSettings,saveSettingsDebounced } = SillyTavern.getContext();

    const SAM_EVENTS = {
        CORE_UPDATED: 'SAM_CORE_UPDATED',            // Emitted by Core when state is updated
        EXT_ASK_STATUS: 'SAM_EXT_ASK_STATUS',        // Emitted by Extension to ask for status
        CORE_STATUS_RESPONSE: 'SAM_CORE_STATUS_RESPONSE', // Emitted by Core in response to status ask
        EXT_COMMIT_STATE: 'SAM_EXT_COMMIT_STATE',       // Emitted by Extension to save a full state object
        CORE_IDLE: 'SAM_CORE_IDLE', // Emitted by core in response to an ask
        INV:'SAM_INV' // data invalid. must re-fetch data.
    };
// use eventSource.on to make this automatically update. Frontend now listens to events as well
// this avoids communication

// --- Helper Components (No changes needed here) ---
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
        if (! await sam_is_in_use()) {
            console.log("SAM UI: Refresh skipped, SAM is not active.");
            return;
        }

        const rawData = await sam_get_data();
        if (rawData) {
            if (!rawData.static) rawData.static = {};
            if (!rawData.func) rawData.func = [];
            if (!rawData.responseSummary) rawData.responseSummary = [];
            
            setLiveSamData(rawData);
            setSummaries(rawData.responseSummary.join('\n'));
            
            // Sync draft data only if the UI is not open to avoid overwriting user edits.
            if (!showInterface) {
                setDraftSamData(rawData);
            }
            console.log("SAM UI: Data refreshed from backend.");
        }
    }, [showInterface]); // Dependency on showInterface is important here

    // [MODIFIED] Use the registration callback instead of eventSource directly
    useEffect(() => {
        // Define the handler that the backend will call
        const handleBackendUpdate = () => {
            console.log("SAM UI: Received update signal from backend.");
            refreshDataAndSummary();
        };

        // Register it
        sam_register_update_callback(handleBackendUpdate);

        // No cleanup is strictly needed as it's a singleton pattern in the backend,
        // but it's good practice in React to return a cleanup function.
        return () => {
            // Unregister if an unregister function is ever added to the backend
            // sam_unregister_update_callback(handleBackendUpdate);
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
            const rawData = await sam_get_data();
            const settings = await sam_get_settings();
            
            if (rawData) {
                setDraftSamData(rawData);
                setLiveSamData(rawData);
                setSummaries((rawData.responseSummary || []).join('\n'));
            }
            setDraftSamSettings(settings || {});
            
            if (!isDataReady) setIsDataReady(true);
        } catch (e) {
            console.error("SAM UI Error during initial load:", e);
            if (showAlerts) alert("Failed to load SAM data/settings.");
        }
    }, [isDataReady]);

    const handleRefresh = () => {
        if (window.confirm("Are you sure you want to refresh? This will discard any unsaved changes.")) {
             sam_get_data().then(data => {
                if(data) {
                    setDraftSamData(data);
                    setLiveSamData(data);
                    setSummaries((data.responseSummary || []).join('\n'));
                }
             });
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

    // at the present, we still wait for TavernHelper.
    // will update this later
    // requires one new button on the function tab.
    const commitFunctions = async () => {

        // save the functions: we will modify a WI to do this.
        await TavernHelper.updateWorldbookWith(
            // update function here
        );
    }

    const commitData = async () => {
        // commit the data
    }

    const commitBaseSettings = async() => {
        // commit base settings
    } 

    const handlers = {

        handleInvalidate : async()=> {
            // somebody invalidated the data (swipe / edit... )
            // must refresh. This means we get variables again

            let correct_sam_data = await sam_get_data();

            // this forces the update UI function to be later than the load.
        },
        handleChatChanged : async() => {
            // somebody changed the chat...
            // must refresh.

            // previously we can parse from chat, but when ISA changes it doesn't matter
            // therefore we must get some IPC going!

            // INV already handles this as core broadcasts INV
            // when this listens to INV it knows that it must rewrite the data of character
            
            // first, see if it has it enabled
            let enabled = await sam_is_in_use();

            // if not enabled, then we will be removing the displayed data and make the commit data button invalid.
            // commit setting button is still valid.

            // if enabled, the commit data button will be set to valid.



        }



    }

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
            <script>
                {
                    (() => {
                        eventSource.on(eventTypes.CHAT_CHANGED, handlers.handleChatChanged);
                        eventSource.on(SAM_EVENTS.INV, handlers.handleInvalidate );
                    })()
                }
            </script>
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

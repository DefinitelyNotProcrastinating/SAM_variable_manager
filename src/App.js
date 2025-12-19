import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import Draggable from 'react-draggable';
import JSONEditor from 'react-json-editor-ajrm';
import locale from 'react-json-editor-ajrm/locale/en';
import './App.css';

// Import API from the window object where the backend places it
const {
    sam_get_data,
    sam_set_data,
    sam_get_settings,
    sam_set_setting,
    sam_register_update_callback,
    forceSummary,
} = window.SituationalAwarenessManagerUI;


// --- Helper Components (Unchanged) ---
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

// --- Main App Component ---
function App() {
    const [showInterface, setShowInterface] = useState(false);
    const [activeTab, setActiveTab] = useState('DATA');
    const [draftSamData, setDraftSamData] = useState({ static: {}, func: [], responseSummary: [] });
    const [draftSamSettings, setDraftSamSettings] = useState({});
    const [summaries, setSummaries] = useState("");
    const [isDataReady, setIsDataReady] = useState(false);
    const [portalContainer, setPortalContainer] = useState(null);
    const nodeRef = useRef(null);

    const refreshDataAndSummary = useCallback(async () => {
        const rawData = await sam_get_data();
        if (rawData) {
            if (!rawData.static) rawData.static = {};
            if (!rawData.func) rawData.func = [];
            if (!rawData.responseSummary) rawData.responseSummary = [];

            setSummaries(rawData.responseSummary.join('\n'));
            if (!showInterface) {
                setDraftSamData(rawData);
            }
        }
    }, [showInterface]);

    useEffect(() => {
        sam_register_update_callback(refreshDataAndSummary);
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

            setDraftSamData(rawData || { static: {}, func: [], responseSummary: [] });
            setSummaries((rawData?.responseSummary || []).join('\n'));
            setDraftSamSettings(settings || {});
            setIsDataReady(true);
        } catch (e) {
            console.error("SAM UI Error during initial load:", e);
            if (showAlerts) alert("Failed to load SAM data/settings.");
        }
    }, []);

    const handleRefresh = () => {
        if (window.confirm("Are you sure? This will discard unsaved changes in the UI.")) {
             loadInitialData(true);
             alert("UI has been refreshed with the latest saved data.");
        }
    };

    useEffect(() => {
        if (showInterface) {
            loadInitialData(true);
        } else {
            setIsDataReady(false);
        }
    }, [showInterface, loadInitialData]);

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

    // [NEW] Handler to save only summary-related settings
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

    // [NEW] Handler for the manual summary button
    const handleForceSummary = async () => {
        if (window.confirm("This will generate a new summary using the current chat history. This may take a moment. Proceed?")) {
            try {
                await forceSummary();
                // The backend will show a success toast. The UI will auto-refresh via the CORE_UPDATED event.
            } catch (e) {
                console.error("Error during manual summary:", e);
                alert("Manual summary failed. See console for details.");
            }
        }
    };

    const handleCommitData = async () => {
        try {
            await sam_set_data(draftSamData);
            alert("SAM data and summaries committed to core engine.");
            setShowInterface(false);
        } catch (e) {
            console.error(e);
            alert("Error saving data: " + e.message);
        }
    };

    const modalContent = (
        <div className="sam_modal_overlay">
            <Draggable handle=".sam_modal_header" nodeRef={nodeRef}>
                <div className="sam_app_window" ref={nodeRef}>
                    <div className="sam_modal_header">
                        <div className="sam_header_title">
                            <span className="sam_brand">SAM</span> MANAGER
                            <span className="sam_version"> v4.1.0</span>
                        </div>
                        <button onClick={() => setShowInterface(false)} className="sam_close_icon">✕</button>
                    </div>

                    <div className="sam_tabs">
                        <button className={`sam_tab ${activeTab === 'DATA' ? 'active' : ''}`} onClick={() => setActiveTab('DATA')}>Data</button>
                        <button className={`sam_tab ${activeTab === 'SUMMARY' ? 'active' : ''}`} onClick={() => setActiveTab('SUMMARY')}>Summary</button>
                        <button className={`sam_tab ${activeTab === 'FUNCS' ? 'active' : ''}`} onClick={() => setActiveTab('FUNCS')}>Functions</button>
                    </div>

                    <div className="sam_content_area">
                        {activeTab === 'DATA' && (
                            <div className="sam_panel_content">
                                <h4 className="sam_panel_label">Raw JSON State</h4>
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
                                        />
                                    ) : ( <div className="sam_empty_state">Loading data...</div> )}
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
                                            placeholder="10"
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
                                        <button onClick={handleSaveSummarySettings} className="sam_btn sam_btn_secondary">Save Summary Settings</button>
                                    </div>
                                </div>
                                <hr className="sam_divider" />
                                <div className="sam_summary_header">
                                    <h4 className="sam_panel_label">Saved Response Summaries</h4>
                                    <button onClick={handleForceSummary} className="sam_btn sam_btn_primary">Force Summary Now</button>
                                </div>
                                <textarea
                                    className="sam_textarea_full"
                                    value={summaries}
                                    onChange={handleSummaryChange}
                                    placeholder="One summary per line... Edit here and click 'Commit Data' to save manually."
                                />
                            </div>
                        )}
                        {activeTab === 'FUNCS' && (
                           <div className="sam_empty_state">Function editor is under development.</div>
                        )}
                    </div>

                    <div className="sam_modal_footer">
                        <div className="sam_actions">
                            <button onClick={handleRefresh} className="sam_btn sam_btn_secondary">Refresh UI</button>
                            <button onClick={() => setShowInterface(false)} className="sam_btn sam_btn_secondary">Cancel</button>
                            <button onClick={handleCommitData} className="sam_btn sam_btn_primary">Commit All Data Changes</button>
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
                    SAM 4.1 Config
                </button>
            </div>
            {showInterface && portalContainer && ReactDOM.createPortal(modalContent, portalContainer)}
        </>
    );
}

export default App;
import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import Draggable from 'react-draggable';
import JSONEditor from 'react-json-editor-ajrm';
import locale from 'react-json-editor-ajrm/locale/en';
import backend, {
    sam_get_data,
    sam_set_data,
    sam_get_settings,
    sam_set_setting,
    sam_is_in_use,
    sam_summary,
    sam_get_status,
    checkWorldInfoActivation,
    // NEWLY IMPORTED FUNCTIONS
    sam_save_api_preset,
    sam_delete_api_preset,
    sam_get_all_api_presets,
    sam_set_active_preset,
    sam_export_all_settings,
    sam_set_all_settings
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

const SAM_FUNCTIONLIB_ID = "__SAM_IDENTIFIER__";
const SCRIPT_VERSION = "5.7.0"; // Match backend version

// --- Constants for API Sources ---
// Matches APIManager.js and SillyTavern's constants.js
const API_SOURCE_OPTIONS = [
    { value: 'custom', label: 'Custom / OpenAI Compatible' },
    { value: 'makersuite', label: 'Google Makersuite (Gemini)' },
    { value: 'claude', label: 'Anthropic Claude' },
    { value: 'mistralai', label: 'Mistral AI' },
    { value: 'openrouter', label: 'OpenRouter' },
    { value: 'cohere', label: 'Cohere' },
    { value: 'perplexity', label: 'Perplexity' },
    { value: 'groq', label: 'Groq' },
    { value: 'deepseek', label: 'DeepSeek' },
    { value: '01ai', label: '01.AI' },
    { value: 'nanogpt', label: 'NanoGPT' },
    { value: 'aimlapi', label: 'AI/ML API' },
    { value: 'xai', label: 'xAI (Grok)' },
    { value: 'pollinations', label: 'Pollinations' },
    { value: 'vertexai', label: 'Google Vertex AI' },
    { value: 'ai21', label: 'AI21' },
];

// --- Helper Components ---

const ToggleSwitch = ({ label, value, onChange, disabled }) => (
    <div className={`sam_form_row ${disabled ? 'sam_disabled' : ''}`}>
        <label className="sam_label">{label}</label>
        <div className={`sam_toggle ${disabled ? 'disabled' : ''}`} onClick={() => !disabled && onChange(!value)}>
            <div className={`sam_toggle_track ${value ? 'on' : 'off'}`}>
                <div className="sam_toggle_thumb" />
            </div>
        </div>
    </div>
);

const InputRow = ({ label, type = "text", value, onChange, placeholder, disabled, tooltip }) => (
    <div className={`sam_form_row ${disabled ? 'sam_disabled' : ''}`} title={tooltip}>
        <label className="sam_label">{label}</label>
        <input
            type={type}
            className="sam_input"
            value={value}
            onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
        />
    </div>
);


// --- Sub-Panels ---

const SettingsPanel = ({ settings, setSettings, data, setData, onCommitData, disabled, onImport, onExport, dataLocked }) => {
    const fileInputRef = useRef(null);

    const handleSettingChange = (key, val) => {
        if(disabled) return;
        setSettings(prev => ({ ...prev, [key]: val }));
    };

    const handleDataChange = (key, val) => {
        if(disabled || dataLocked) return;
        setData(prev => ({ ...prev, [key]: val }));
    };

    const handleSaveAll = async () => {
        if (disabled) return;
        try {
            // Save general plugin settings
            // MODIFIED: Save 'data_enable' instead of 'enabled'
            await sam_set_setting('data_enable', settings.data_enable);
            await sam_set_setting('enable_auto_checkpoint', settings.enable_auto_checkpoint);
            await sam_set_setting('auto_checkpoint_frequency', settings.auto_checkpoint_frequency);
            await sam_set_setting('skipWIAN_When_summarizing', settings.skipWIAN_When_summarizing);

            // Save state-specific data only if it's not locked
            if (!dataLocked) {
                await onCommitData();
                toastr.success("Settings and Data configuration saved successfully.");
            } else {
                toastr.success("Global settings saved. Data configuration is locked because SAM identifier is missing.");
            }

        } catch (e) {
            console.error(e);
            toastr.error("Error saving settings: " + e.message);
        }
    };

    const handleFileImportClick = () => {
        fileInputRef.current.click();
    };

    const handleFileSelected = (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const content = JSON.parse(e.target.result);
                    onImport(content);
                } catch (err) {
                    toastr.error("Failed to parse JSON file.");
                    console.error(err);
                }
            };
            reader.readAsText(file);
        }
        // Reset file input value to allow re-selection of the same file
        event.target.value = null;
    };

    return (
        <div className="sam_panel_content">
            <h3 className="sam_section_title">Plugin Configuration</h3>
            <p className="sam_help_text">These settings apply globally to the extension.</p>
            {/* MODIFIED: Changed label, value, and onChange handler for the main toggle */}
            <ToggleSwitch label="Enable Data/Summary Functions" value={settings.data_enable} onChange={(v) => handleSettingChange('data_enable', v)} disabled={disabled} />
            <ToggleSwitch label="Auto Checkpoint" value={settings.enable_auto_checkpoint} onChange={(v) => handleSettingChange('enable_auto_checkpoint', v)} disabled={disabled} />
            <InputRow label="Checkpoint Frequency" type="number" value={settings.auto_checkpoint_frequency} onChange={(v) => handleSettingChange('auto_checkpoint_frequency', v)} disabled={disabled || !settings.enable_auto_checkpoint} tooltip="Save the current state every X messages if no summary has occurred." />
            <ToggleSwitch label="Skip WI/AN during Summary" value={settings.skipWIAN_When_summarizing} onChange={(v) => handleSettingChange('skipWIAN_When_summarizing', v)} disabled={disabled} />

            <h3 className="sam_section_title">Data & State Configuration</h3>
            <p className="sam_help_text">These settings are saved to the current story state (SAM_data). Access is locked if the SAM identifier is not detected.</p>
            <ToggleSwitch label="Disable Data Type Mutation" value={!!data.disable_dtype_mutation} onChange={(v) => handleDataChange('disable_dtype_mutation', v)} disabled={disabled || dataLocked} />
            <ToggleSwitch label="Uniquely Identified Paths" value={!!data.uniquely_identified} onChange={(v) => handleDataChange('uniquely_identified', v)} disabled={disabled || dataLocked} />

            <div className="sam_actions" style={{ marginTop: '20px' }}>
                <button onClick={handleSaveAll} className="sam_btn sam_btn_primary" disabled={disabled}>Save All Settings</button>
            </div>

            {/* [NEW] Import/Export Section */}
            <h3 className="sam_section_title" style={{marginTop: '30px'}}>Import / Export</h3>
            <p className="sam_help_text">Save or load your extension settings. API connection presets are NOT included in exports for security.</p>
            <div className="sam_actions">
                <button onClick={onExport} className="sam_btn sam_btn_secondary" disabled={disabled}>Export Settings (JSON)</button>
                <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".json" onChange={handleFileSelected} />
                <button onClick={handleFileImportClick} className="sam_btn sam_btn_secondary" disabled={disabled}>Import Settings (JSON)</button>
            </div>
        </div>
    );
};

const FunctionEditor = ({ functions, setFunctions, onCommit, disabled, commitDisabled }) => {
    const [selectedIndex, setSelectedIndex] = useState(-1);

    const handleAdd = () => {
        if(disabled) return;
        const newFunc = { func_name: "new_function", func_params: [], func_body: "// ...", timeout: 2000, periodic: false, network_access: false, order: "normal" };
        setFunctions([...functions, newFunc]);
        setSelectedIndex(functions.length);
    };

    const handleDelete = (index) => {
        if(disabled) return;
        if (!window.confirm("Delete this function?")) return;
        const newFuncs = [...functions];
        newFuncs.splice(index, 1);
        setFunctions(newFuncs);
        setSelectedIndex(-1);
    };

    const updateFunc = (index, field, value) => {
        if(disabled) return;
        const newFuncs = [...functions];
        newFuncs[index] = { ...newFuncs[index], [field]: value };
        setFunctions(newFuncs);
    };

    const selectedFunc = functions[selectedIndex];

    return (
        <div className={`sam_panel_split ${disabled ? 'sam_disabled_area' : ''}`}>
            <div className="sam_sidebar_list">
                <div className="sam_list_header"><span>Functions (WI)</span><button className="sam_btn_small" onClick={handleAdd} disabled={disabled}>+</button></div>
                <ul>
                    {functions.map((f, i) => (<li key={i} className={i === selectedIndex ? 'active' : ''} onClick={() => setSelectedIndex(i)}>{f.func_name}<span className="sam_delete_icon" onClick={(e) => { e.stopPropagation(); if(!disabled) handleDelete(i); }}>×</span></li>))}
                </ul>
                <div style={{padding: '10px'}}><button className="sam_btn sam_btn_primary full_width" onClick={onCommit} disabled={disabled || commitDisabled}>Save to World Info</button></div>
            </div>
            <div className="sam_detail_view">
                {selectedFunc ? (<div className="sam_scrollable_form">
                    <InputRow label="Function Name" value={selectedFunc.func_name} onChange={(v) => updateFunc(selectedIndex, 'func_name', v)} disabled={disabled} />
                    <div className="sam_form_row"><label className="sam_label">Params (comma separated)</label><input className="sam_input" value={(selectedFunc.func_params || []).join(', ')} onChange={(e) => updateFunc(selectedIndex, 'func_params', e.target.value.split(',').map(s => s.trim()))} disabled={disabled} /></div>
                    <div className="sam_form_column"><label className="sam_label">Function Body (JS)</label><textarea className="sam_code_editor" value={selectedFunc.func_body} onChange={(e) => updateFunc(selectedIndex, 'func_body', e.target.value)} disabled={disabled} /></div>
                    <div className="sam_form_grid"><InputRow label="Timeout (ms)" type="number" value={selectedFunc.timeout} onChange={(v) => updateFunc(selectedIndex, 'timeout', v)} disabled={disabled} /><div className="sam_form_row"><label className="sam_label">Exec Order</label><select className="sam_select" value={selectedFunc.order || 'normal'} onChange={(e) => updateFunc(selectedIndex, 'order', e.target.value)} disabled={disabled}><option value="first">First</option><option value="normal">Normal</option><option value="last">Last</option></select></div></div>
                    <div className="sam_form_grid"><ToggleSwitch label="Periodic Eval" value={selectedFunc.periodic} onChange={(v) => updateFunc(selectedIndex, 'periodic', v)} disabled={disabled} /><ToggleSwitch label="Network Access" value={selectedFunc.network_access} onChange={(v) => updateFunc(selectedIndex, 'network_access', v)} disabled={disabled} /></div>
                </div>) : (<div className="sam_empty_state">Select a function to edit</div>)}
            </div>
        </div>
    );
};

const RegexPanel = ({ regexes = [], setRegexes, onSave, disabled }) => {
    const [selectedIndex, setSelectedIndex] = useState(-1);

    const handleAdd = () => {
        if (disabled) return;
        const newRegex = { name: "New Regex", enabled: true, regex_body: "" };
        setRegexes([...regexes, newRegex]);
        setSelectedIndex(regexes.length);
    };

    const handleDelete = (index) => {
        if (disabled) return;
        if (!window.confirm("Delete this regex?")) return;
        const newArr = [...regexes];
        newArr.splice(index, 1);
        setRegexes(newArr);
        setSelectedIndex(-1);
    };

    const updateRegex = (index, field, value) => {
        if (disabled) return;
        const newArr = [...regexes];
        newArr[index] = { ...newArr[index], [field]: value };
        setRegexes(newArr);
    };

    const toggleEnabled = (e, index) => {
        e.stopPropagation(); // Prevent selection when toggling
        if (disabled) return;
        const newArr = [...regexes];
        newArr[index] = { ...newArr[index], enabled: !newArr[index].enabled };
        setRegexes(newArr);
    };

    const selectedRegex = regexes[selectedIndex];

    return (
        <div className={`sam_panel_split ${disabled ? 'sam_disabled_area' : ''}`}>
            <div className="sam_sidebar_list">
                <div className="sam_list_header">
                    <span>Regex Filters</span>
                    <button className="sam_btn_small" onClick={handleAdd} disabled={disabled}>+</button>
                </div>
                <ul>
                    {regexes.map((r, i) => (
                        <li key={i} className={i === selectedIndex ? 'active' : ''} onClick={() => setSelectedIndex(i)}>
                            <div className="sam_list_item_content">
                                <span className="sam_list_item_name">{r.name}</span>
                                <div className="sam_list_item_controls">
                                    <div className={`sam_toggle_micro ${r.enabled ? 'on' : 'off'}`} onClick={(e) => toggleEnabled(e, i)}>
                                        <div className="sam_toggle_thumb_micro" />
                                    </div>
                                    <span className="sam_delete_icon" onClick={(e) => { e.stopPropagation(); if (!disabled) handleDelete(i); }}>×</span>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
                <div style={{ padding: '10px' }}>
                    <button className="sam_btn sam_btn_primary full_width" onClick={onSave} disabled={disabled}>
                        Save All Regexes
                    </button>
                </div>
            </div>
            <div className="sam_detail_view">
                {selectedRegex ? (
                    <div className="sam_scrollable_form">
                        <InputRow label="Regex Name" value={selectedRegex.name} onChange={(v) => updateRegex(selectedIndex, 'name', v)} disabled={disabled} />
                        <div className={`sam_form_column ${disabled ? 'sam_disabled' : ''}`}>
                            <label className="sam_label">Regex Body (no slashes or flags)</label>
                            <textarea className="sam_code_editor" value={selectedRegex.regex_body} onChange={(e) => updateRegex(selectedIndex, 'regex_body', e.target.value)} disabled={disabled} />
                            <p className="sam_help_text_small">Example: `\n\*.*?\*` to remove italics. The 'g' (global) flag is added automatically.</p>
                        </div>
                        <ToggleSwitch label="Enabled" value={selectedRegex.enabled} onChange={(v) => updateRegex(selectedIndex, 'enabled', v)} disabled={disabled} />
                    </div>
                ) : (
                    <div className="sam_empty_state">Select a regex to edit</div>
                )}
            </div>
        </div>
    );
};

const ConnectionsPanel = ({ presets = [], activePreset, onSave, onDelete, onSetActive, disabled }) => {
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [draft, setDraft] = useState(null);

    // [MODIFIED] Added proxyPassword to the default preset
    const defaultPreset = {
        name: "New Preset",
        apiMode: 'custom', // 'custom' or 'tavern'
        apiConfig: {
            source: 'custom', // Default format/source
            url: '',
            apiKey: '',
            proxyPassword: '', // ADDED
            model: '',
            max_tokens: 4096,
            temperature: 0.9,
            top_p: 0.9
        }
    };

    useEffect(() => {
        if (selectedIndex >= 0 && presets[selectedIndex]) {
            // Ensure draft has a valid apiMode, default to 'custom' if missing.
            const presetData = _.cloneDeep(presets[selectedIndex]);
            if (!presetData.apiMode) {
                presetData.apiMode = 'custom';
            }
            // Ensure apiConfig exists
            if (!presetData.apiConfig) {
                presetData.apiConfig = { ...defaultPreset.apiConfig };
            }
            // Ensure source is set
            if (!presetData.apiConfig.source) {
                presetData.apiConfig.source = 'custom';
            }
            setDraft(presetData);
        } else {
            setDraft(null);
        }
    }, [selectedIndex, presets]);

    const handleAdd = async () => {
        if (disabled) return;
        const newName = `New Preset ${presets.length + 1}`;
        const newPreset = { ...defaultPreset, name: newName, apiConfig: {...defaultPreset.apiConfig} };
        await onSave(newPreset);
        setSelectedIndex(presets.length);
    };

    const handleDeleteClick = (index) => {
        if (disabled) return;
        const presetToDelete = presets[index];
        if (!window.confirm(`Delete the preset "${presetToDelete.name}"?`)) return;
        onDelete(presetToDelete.name);
        setSelectedIndex(-1);
    };

    const handleSaveClick = () => {
        if (disabled || !draft) return;
        onSave(draft);
    };

    const updateDraft = (path, value) => {
        setDraft(prev => _.set(_.cloneDeep(prev), path, value));
    };

    return (
        <div className={`sam_panel_split ${disabled ? 'sam_disabled_area' : ''}`}>
            <div className="sam_sidebar_list">
                <div className="sam_list_header"><span>API Presets</span><button className="sam_btn_small" onClick={handleAdd} disabled={disabled}>+</button></div>
                <ul>
                    {presets.map((p, i) => (
                        <li key={p.name + i} className={i === selectedIndex ? 'active' : ''} onClick={() => setSelectedIndex(i)}>
                            <div className="sam_list_item_content">
                                <span className="sam_list_item_name" title={p.name}>{p.name}{p.name === activePreset && ' (Active)'}</span>
                                <div className="sam_list_item_controls">
                                    <span className="sam_delete_icon" onClick={(e) => { e.stopPropagation(); handleDeleteClick(i); }}>×</span>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
            <div className="sam_detail_view">
                {draft ? (<div className="sam_scrollable_form">
                    <InputRow label="Preset Name" value={draft.name} onChange={(v) => updateDraft('name', v)} disabled={disabled} />
                    
                    <div className="sam_form_row">
                        <label className="sam_label">API Mode</label>
                        <select 
                            className="sam_select" 
                            value={draft.apiMode || 'custom'} 
                            onChange={(e) => updateDraft('apiMode', e.target.value)} 
                            disabled={disabled}
                        >
                            <option value="custom">Custom Connection</option>
                            <option value="tavern">Tavern Main API</option>
                        </select>
                    </div>

                    {draft.apiMode === 'custom' ? (
                    <>
                        <p className="sam_help_text_small" style={{marginBottom:'10px'}}>
                            Use this mode to connect to a specific endpoint independent of SillyTavern's main settings.
                        </p>
                        
                        <div className="sam_form_row">
                            <label className="sam_label">API Type / Source</label>
                            <select
                                className="sam_select"
                                value={draft.apiConfig.source || 'custom'}
                                onChange={(e) => updateDraft('apiConfig.source', e.target.value)}
                                disabled={disabled}
                            >
                                {API_SOURCE_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                        <p className="sam_help_text_small">
                            Determines how the request body is formatted for the proxy (e.g., Gemini vs OpenAI).
                        </p>

                        <InputRow 
                            label="API URL" 
                            value={draft.apiConfig.url} 
                            onChange={(v) => updateDraft('apiConfig.url', v)} 
                            disabled={disabled} 
                            placeholder="e.g., http://127.0.0.1:5000/v1"
                        />
                        <InputRow 
                            label="API Key" 
                            type="password" 
                            value={draft.apiConfig.apiKey} 
                            onChange={(v) => updateDraft('apiConfig.apiKey', v)} 
                            disabled={disabled} 
                            placeholder="Optional"
                        />
                        {/* [MODIFIED] ADDED PROXY PASSWORD INPUT */}
                        <InputRow
                            label="Proxy Password"
                            type="password"
                            value={draft.apiConfig.proxyPassword || ''}
                            onChange={(v) => updateDraft('apiConfig.proxyPassword', v)}
                            disabled={disabled}
                            placeholder="Optional, for authenticating with proxy"
                        />
                        <InputRow 
                            label="Model Name" 
                            value={draft.apiConfig.model} 
                            onChange={(v) => updateDraft('apiConfig.model', v)} 
                            disabled={disabled} 
                            placeholder="e.g., gpt-4-turbo, gemini-pro, claude-3-opus"
                        />
                    </>
                    ) : (
                    <>
                        <p className="sam_help_text_small" style={{marginTop:'10px', color: '#888'}}>
                            This preset uses whichever API is currently selected and active in SillyTavern's main "AI Response Configuration" panel.
                            <br/><br/>
                            No additional configuration is required here.
                        </p>
                    </>
                    )}

                    <h4 className="sam_subsection_title" style={{marginTop: '20px'}}>Generation Parameters</h4>
                    <p className="sam_help_text_small">These parameters will be sent if the endpoint supports them.</p>
                    <InputRow label="Max Tokens" type="number" value={draft.apiConfig.max_tokens} onChange={(v) => updateDraft('apiConfig.max_tokens', v)} disabled={disabled} />
                    <InputRow label="Temperature" type="number" value={draft.apiConfig.temperature} onChange={(v) => updateDraft('apiConfig.temperature', v)} disabled={disabled} />
                    <InputRow label="Top P" type="number" value={draft.apiConfig.top_p} onChange={(v) => updateDraft('apiConfig.top_p', v)} disabled={disabled} />
                    
                    <div className="sam_actions" style={{marginTop: '20px'}}>
                        <button onClick={handleSaveClick} className="sam_btn sam_btn_primary" disabled={disabled}>Save Changes</button>
                        <button onClick={() => onSetActive(draft.name)} className="sam_btn sam_btn_secondary" disabled={disabled || draft.name === activePreset}>Set as Active for Summary</button>
                    </div>

                </div>) : (<div className="sam_empty_state">Select a preset to edit or add a new one.</div>)}
            </div>
        </div>
    );
};

const SummaryLevelPanel = ({ level, summaries, onEdit, onDelete, disabled }) => {
    return (
        <div className="sam_summary_level_container">
            <h4 className="sam_summary_level_title">{level} Summaries ({summaries.length})</h4>
            {summaries.length === 0 ? (
                <p className="sam_empty_state_small">No {level} summaries yet.</p>
            ) : (
                <div className="sam_summary_list">
                    {summaries.map((summary, index) => (
                        <div key={index} className="sam_summary_item">
                            <div className="sam_summary_item_header">
                                <span>Range: {summary.index_begin} - {summary.index_end}</span>
                                <button
                                    className="sam_delete_icon_small"
                                    onClick={() => onDelete(level, index)}
                                    disabled={disabled}
                                    title="Delete this summary"
                                >×</button>
                            </div>
                            <textarea
                                className="sam_summary_textarea"
                                value={summary.content}
                                onChange={(e) => onEdit(level, index, e.target.value)}
                                disabled={disabled}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const ExtensionDrawer = ({ children, title = "SAM Extension", warning }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (<div className="inline-drawer"><div className="inline-drawer-toggle inline-drawer-header" onClick={() => setIsOpen(!isOpen)}><b>{title}</b>{warning && <span style={{marginLeft:'10px', color:'orange', fontSize:'0.8em'}}>⚠ {warning}</span>}<div className="inline-drawer-icon fa-solid fa-circle-chevron-down down" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} /></div>{isOpen && (<div className="inline-drawer-content">{children}</div>)}</div>);
};

// --- Main App Component ---

function App() {
    const [showInterface, setShowInterface] = useState(false);
    const [activeTab, setActiveTab] = useState('SUMMARY');

    const [draftSamData, setDraftSamData] = useState({});
    const [draftSamSettings, setDraftSamSettings] = useState({});
    const [draftFunctions, setDraftFunctions] = useState([]);

    const [draftSummaries, setDraftSummaries] = useState({ L1: [], L2: [], L3: [] });

    const [isDataReady, setIsDataReady] = useState(false);
    const [isBusy, setIsBusy] = useState(false);
    const [samStatusText, setSamStatusText] = useState("IDLE");

    const [samDetected, setSamDetected] = useState(false);

    const [portalContainer, setPortalContainer] = useState(null);
    const [extensionsContainer, setExtensionsContainer] = useState(null);
    const nodeRef = useRef(null);

    // --- Helpers for World Info Functions & Identification ---

    const checkSamExistence = async () => {
        try {
            const context = SillyTavern.getContext();
            const charId = context.characterId;
            if (charId === null || !context.characters[charId]) return false;
            const worldInfoName = context.characters[charId].data.extensions.world;
            if (!worldInfoName) return false;
            const wiData = await context.loadWorldInfo(worldInfoName);
            if (!wiData || !wiData.entries) return false;
            return !!_.find(wiData.entries, (entry) => entry.comment === SAM_FUNCTIONLIB_ID);
        } catch (e) { console.error("Error checking for SAM ID", e); return false; }
    };

    const getFunctionsFromWI = async () => {
        try {
            const context = SillyTavern.getContext();
            const charId = context.characterId;
            if (charId === null || !context.characters[charId]) return [];
            const worldInfoName = context.characters[charId].data.extensions.world;
            if (!worldInfoName) return [];
            const wiData = await context.loadWorldInfo(worldInfoName);
            if (!wiData || !wiData.entries) return [];
            const funcEntry = _.find(wiData.entries, (entry) => entry.comment === SAM_FUNCTIONLIB_ID);
            if (funcEntry && funcEntry.content) {
                return JSON.parse(funcEntry.content);
            }
            return [];
        } catch (e) { console.error("[SAM frontend] Error fetching functions from WI", e); return []; }
    };

    const saveFunctionsToWI = async (functions) => {
        if (!samDetected) { toastr.error("Cannot save: SAM Identifier not detected in World Info."); return; }
        // This function requires TavernHelper, which may not be available.
        // For now, this is a placeholder for the user's specific implementation.
        console.warn("saveFunctionsToWI is not fully implemented in this test build.");
        toastr.info("Function saving is a placeholder. See console.");
    };

    // --- Data Loading & refreshing ---

    const refreshData = useCallback(async (forceUpdate = false) => {
        // MODIFIED: No longer checks sam_is_in_use() here, as the UI should always be available.
        // The function was changed in the backend to always return true anyway.
        try {
            const exists = await checkSamExistence();
            setSamDetected(exists);

            const rawData = await sam_get_data();
            const settings = await sam_get_settings();
            const funcs = await getFunctionsFromWI();

            if (rawData) {
                if (!showInterface || forceUpdate) {
                    setDraftSamData(rawData);
                    const responseSummary = rawData.responseSummary || { L1: [], L2: [], L3: [] };
                    setDraftSummaries(responseSummary);
                }
            }
            if (settings && (!showInterface || forceUpdate)) setDraftSamSettings(settings);
            if (funcs && (!showInterface || forceUpdate)) setDraftFunctions(funcs);
            if (!isDataReady) setIsDataReady(true);
        } catch (e) {
            console.error("[SAM frontend] Refresh Error:", e);
        }
    }, [showInterface, isDataReady]);

    // --- Event Listeners & Heartbeat ---

    useEffect(() => {
        const onInvalidate = () => refreshData(true);
        const onStatusResponse = (data) => {
            if (data && data.state) {
                setSamStatusText(data.state);
                setIsBusy(["AWAIT_GENERATION", "PROCESSING", "GENERATING"].includes(data.state));
            }
        };

        eventSource.on(SAM_EVENTS.INV, onInvalidate);
        eventSource.on(SAM_EVENTS.CORE_STATUS_RESPONSE, onStatusResponse);
        eventSource.on(eventTypes.CHAT_CHANGED, onInvalidate);

        refreshData();

        const pContainer = document.createElement('div');
        document.body.appendChild(pContainer);
        setPortalContainer(pContainer);

        const findExtContainer = setInterval(() => {
            const extSettings = document.getElementById('extensions_settings');
            if (extSettings) {
                setExtensionsContainer(extSettings);
                clearInterval(findExtContainer);
            }
        }, 500);

        return () => {
            if (pContainer.parentNode) pContainer.parentNode.removeChild(pContainer);
            clearInterval(findExtContainer);
        };
    }, [refreshData]);

    useEffect(() => {
        if (!showInterface) return;
        const interval = setInterval(() => {
            eventSource.emit(SAM_EVENTS.EXT_ASK_STATUS);
            checkWorldInfoActivation();
        }, 2500);
        return () => clearInterval(interval);
    }, [showInterface]);

    // --- Handlers ---

    const handleManualRefresh = () => {
        if (window.confirm("Refresh data? Unsaved changes will be lost.")) {
            refreshData(true);
            toastr.info("UI Refreshed.");
        }
    };

    const handleCommitData = async () => {
        if (!samDetected) { toastr.error("Locked: SAM Identifier missing."); return; }
        try {
            const cleanData = { ...draftSamData };
            cleanData.responseSummary = draftSummaries;
            await sam_set_data(cleanData);
            toastr.success("Data committed to State.");
        } catch (e) { console.error(e); toastr.error("Error committing data: " + e.message); }
    };

    const handleCommitFunctions = async () => {
        if (!samDetected) { toastr.error("Locked: SAM Identifier missing."); return; }
        if (window.confirm("This will overwrite the Function Library in World Info. Continue?")) {
            await saveFunctionsToWI(draftFunctions);
        }
    };

    const handleSummaryContentChange = (level, index, newContent) => {
        setDraftSummaries(prev => {
            const newSummaries = [...(prev[level] || [])];
            newSummaries[index] = { ...newSummaries[index], content: newContent };
            return { ...prev, [level]: newSummaries };
        });
    };

    const handleSummaryDelete = (level, index) => {
        if (!window.confirm(`Are you sure you want to delete this ${level} summary?`)) return;
        setDraftSummaries(prev => {
            const newSummaries = [...(prev[level] || [])];
            newSummaries.splice(index, 1);
            return { ...prev, [level]: newSummaries };
        });
    };

    const handleSaveSummarySettings = async () => {
        try {
            await sam_set_setting('summary_levels', draftSamSettings.summary_levels);
            await sam_set_setting('summary_prompt', draftSamSettings.summary_prompt);
            await sam_set_setting('summary_prompt_L3', draftSamSettings.summary_prompt_L3);
            toastr.success("Summary settings saved.");
        } catch (e) { console.error(e); toastr.error("Error saving summary settings: " + e.message); }
    };

    const handleSaveRegexSettings = async () => {
        try {
            await sam_set_setting('regexes', draftSamSettings.regexes);
            toastr.success("Regex settings saved.");
        } catch (e) {
            console.error(e);
            toastr.error("Error saving regex settings: " + e.message);
        }
    };

    const handleTriggerSummary = async () => {
        if (!samDetected) { toastr.error("Locked: SAM Identifier missing."); return; }
        if (isBusy) { toastr.warning("Core is busy. Cannot run summary now."); return; }
        toastr.info("Triggering manual summary...");
        await sam_summary();
    };

    const handleJsonChange = (content) => {
        if (!samDetected) return;
        if (content.jsObject) { setDraftSamData(content.jsObject); }
    };

    const handleSaveApiPreset = async (presetData) => {
        try {
            await sam_save_api_preset(presetData.name, presetData);
            toastr.success(`Preset "${presetData.name}" saved.`);
            refreshData(true);
        } catch (e) {
            console.error(e);
            toastr.error("Error saving preset: " + e.message);
        }
    };

    const handleDeleteApiPreset = async (presetName) => {
        try {
            await sam_delete_api_preset(presetName);
            toastr.info(`Preset "${presetName}" deleted.`);
            if (draftSamSettings.summary_api_preset === presetName) {
                await sam_set_active_preset(null);
            }
            refreshData(true);
        } catch (e) {
            console.error(e);
            toastr.error("Error deleting preset: " + e.message);
        }
    };

    const handleSetActivePreset = async (presetName) => {
        try {
            await sam_set_active_preset(presetName);
            toastr.success(`"${presetName}" is now the active preset for summaries.`);
            refreshData(true);
        } catch (e) {
            console.error(e);
            toastr.error("Error setting active preset: " + e.message);
        }
    };

    const handleExportSettings = async () => {
        try {
            const settings = await sam_export_all_settings();
            const jsonString = JSON.stringify(settings, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'sam_settings_export.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toastr.success("Settings exported.");
        } catch (e) {
            console.error(e);
            toastr.error("Failed to export settings.");
        }
    };

    const handleImportSettings = async (settingsObject) => {
        if (window.confirm("This will overwrite your current settings (except API presets). Are you sure?")) {
            await sam_set_all_settings(settingsObject);
            refreshData(true);
        }
    };

    // --- Render ---

    const drawerContent = (
        <ExtensionDrawer title={`SAM v${SCRIPT_VERSION}`} warning={!samDetected ? "Not Detected" : null}>
            <div className="sam_drawer_controls">
                {!samDetected && (<div className="sam_warning_box">SAM Identifier not found in World Info.</div>)}
                 <button onClick={() => setShowInterface(true)} className="sam_menu_button full_width">Open Configuration Manager</button>
                <div className="sam_status_micro">Status: <span className={isBusy ? 'busy' : 'idle'}>{samStatusText}</span></div>
            </div>
        </ExtensionDrawer>
    );

    const modalContent = (
        <div className="sam_modal_overlay">
            <Draggable handle=".sam_modal_header" nodeRef={nodeRef}>
                <div className="sam_app_window" ref={nodeRef} style={activeTab === 'SUMMARY' ? { height: '95vh', maxHeight: '1200px' } : {}}>
                    <div className="sam_modal_header">
                        <div className="sam_header_title"><span className="sam_brand">SAM</span> MANAGER<span className="sam_version"> v{SCRIPT_VERSION}</span></div>
                        <button onClick={() => setShowInterface(false)} className="sam_close_icon">✕</button>
                    </div>
                    {!samDetected && (<div className="sam_banner_error">SAM Identifier ({SAM_FUNCTIONLIB_ID}) not detected. Functionality that modifies character data is locked.</div>)}
                    <div className="sam_tabs">
                        <button className={`sam_tab ${activeTab === 'SUMMARY' ? 'active' : ''}`} onClick={() => setActiveTab('SUMMARY')}>Summary</button>
                        <button className={`sam_tab ${activeTab === 'CONNECTIONS' ? 'active' : ''}`} onClick={() => setActiveTab('CONNECTIONS')}>Connections</button>
                        <button className={`sam_tab ${activeTab === 'REGEX' ? 'active' : ''}`} onClick={() => setActiveTab('REGEX')}>Regex</button>
                        <button className={`sam_tab ${activeTab === 'DATA' ? 'active' : ''}`} onClick={() => setActiveTab('DATA')}>Data</button>
                        <button className={`sam_tab ${activeTab === 'FUNCS' ? 'active' : ''}`} onClick={() => setActiveTab('FUNCS')}>Functions</button>
                        <button className={`sam_tab ${activeTab === 'SETTINGS' ? 'active' : ''}`} onClick={() => setActiveTab('SETTINGS')}>Settings</button>
                    </div>
                    <div className="sam_content_area">
                        {activeTab === 'DATA' && (
                            <div className={`sam_panel_content ${isBusy ? 'disabled' : ''}`}>
                                <h4 className="sam_panel_label">Raw JSON State {isBusy ? "(Locked - Core Busy)" : ""}</h4>
                                <div className="sam_json_wrapper">
                                    {isDataReady ? (<JSONEditor id="sam_json_edit" placeholder={draftSamData} onChange={handleJsonChange} locale={locale} theme="dark_vscode_tribute" height="100%" width="100%" colors={{ background: 'transparent' }} viewOnly={isBusy || !samDetected} />) : (<div className="sam_empty_state">Loading data...</div>)}
                                </div>
                                <div className="sam_actions" style={{marginTop: '10px'}}><button onClick={handleCommitData} className="sam_btn sam_btn_primary" disabled={isBusy || !samDetected}>Commit Data Changes</button></div>
                            </div>
                        )}
                        {activeTab === 'SUMMARY' && (
                            <div className="sam_panel_content full_height layout_column">
                                <div className="sam_summary_settings_section">
                                    <h3 className="sam_section_title">Hierarchical Summary Configuration</h3>

                                    <div className="sam_form_row" style={{ padding: '0 0 10px 0', borderBottom: '1px solid #444', marginBottom: '15px' }}>
                                        <label className="sam_label" style={{ width: 'auto', marginRight: '10px' }}>Current Progress (Last Summarized Index):</label>
                                        <span style={{ fontFamily: 'monospace', fontSize: '1.1em', fontWeight: 'bold' }}>
                                            {draftSamData.summary_progress || 0}
                                        </span>
                                    </div>

                                    <div className="sam_form_grid_3">
                                        <InputRow label="L1 Freq" type="number" value={draftSamSettings.summary_levels?.L1?.frequency || ''} onChange={(v) => setDraftSamSettings(p => _.set({...p}, 'summary_levels.L1.frequency', v))} disabled={isBusy} />
                                        <InputRow label="L2 Freq" type="number" value={draftSamSettings.summary_levels?.L2?.frequency || ''} onChange={(v) => setDraftSamSettings(p => _.set({...p}, 'summary_levels.L2.frequency', v))} disabled={isBusy} />
                                        <InputRow label="L3 Freq" type="number" value={draftSamSettings.summary_levels?.L3?.frequency || ''} onChange={(v) => setDraftSamSettings(p => _.set({...p}, 'summary_levels.L3.frequency', v))} disabled={isBusy} />
                                    </div>
                                    <ToggleSwitch label="Enable L2 Summaries" value={draftSamSettings.summary_levels?.L2?.enabled ?? true} onChange={(v) => setDraftSamSettings(p => _.set({...p}, 'summary_levels.L2.enabled', v))} disabled={isBusy} />
                                    <ToggleSwitch label="Enable L3 Summaries" value={draftSamSettings.summary_levels?.L3?.enabled ?? true} onChange={(v) => setDraftSamSettings(p => _.set({...p}, 'summary_levels.L3.enabled', v))} disabled={isBusy} />

                                    <div className={`sam_form_column ${isBusy ? 'sam_disabled' : ''}`}><label className="sam_label">L2 Generation Prompt</label><textarea className="sam_textarea_medium" value={draftSamSettings.summary_prompt || ''} onChange={(e) => setDraftSamSettings(p => ({...p, summary_prompt: e.target.value}))} disabled={isBusy} /></div>
                                    <div className={`sam_form_column ${isBusy ? 'sam_disabled' : ''}`}><label className="sam_label">L3 Generation Prompt</label><textarea className="sam_textarea_medium" value={draftSamSettings.summary_prompt_L3 || ''} onChange={(e) => setDraftSamSettings(p => ({...p, summary_prompt_L3: e.target.value}))} disabled={isBusy} /></div>
                                    <div className="sam_actions"><button onClick={handleSaveSummarySettings} className="sam_btn sam_btn_primary" disabled={isBusy}>Save Config</button><button onClick={handleTriggerSummary} className="sam_btn sam_btn_secondary" disabled={isBusy || !samDetected}>Run Summarization Now</button></div>
                                </div>
                                <hr className="sam_divider" />
                                <div className="sam_summary_display_area">
                                    <SummaryLevelPanel level="L3" summaries={draftSummaries.L3 || []} onEdit={handleSummaryContentChange} onDelete={handleSummaryDelete} disabled={isBusy || !samDetected} />
                                    <SummaryLevelPanel level="L2" summaries={draftSummaries.L2 || []} onEdit={handleSummaryContentChange} onDelete={handleSummaryDelete} disabled={isBusy || !samDetected} />
                                    <SummaryLevelPanel level="L1" summaries={draftSummaries.L1 || []} onEdit={handleSummaryContentChange} onDelete={handleSummaryDelete} disabled={isBusy || !samDetected} />
                                </div>
                                <div className="sam_actions" style={{marginTop:'auto', paddingTop: '10px'}}><button onClick={handleCommitData} className="sam_btn sam_btn_primary" disabled={isBusy || !samDetected}>Save All Edited Summaries</button></div>
                            </div>
                        )}
                        {activeTab === 'REGEX' && (
                            <RegexPanel
                                regexes={draftSamSettings.regexes || []}
                                setRegexes={(newRegexes) => setDraftSamSettings(p => ({ ...p, regexes: newRegexes }))}
                                onSave={handleSaveRegexSettings}
                                disabled={isBusy}
                            />
                        )}
                        {activeTab === 'CONNECTIONS' && (
                            <ConnectionsPanel
                                presets={draftSamSettings.api_presets || []}
                                activePreset={draftSamSettings.summary_api_preset}
                                onSave={handleSaveApiPreset}
                                onDelete={handleDeleteApiPreset}
                                onSetActive={handleSetActivePreset}
                                disabled={isBusy}
                            />
                        )}
                        {activeTab === 'FUNCS' && (<FunctionEditor functions={draftFunctions} setFunctions={setDraftFunctions} onCommit={handleCommitFunctions} disabled={isBusy} commitDisabled={!samDetected} />)}
                        {activeTab === 'SETTINGS' && (
                             <SettingsPanel
                                settings={draftSamSettings}
                                setSettings={setDraftSamSettings}
                                data={draftSamData}
                                setData={setDraftSamData}
                                onCommitData={handleCommitData}
                                disabled={isBusy}
                                dataLocked={!samDetected}
                                onExport={handleExportSettings}
                                onImport={handleImportSettings}
                             />
                        )}
                    </div>
                    <div className="sam_modal_footer">
                        {/* MODIFIED: Updated status text to be more descriptive */}
                        <div className="sam_status_bar">Status: {samDetected ? (draftSamSettings.data_enable ? "Data Active" : "Data Disabled") : "MISSING ID"} | Core State: <span className={isBusy ? 'busy' : 'idle'}>{samStatusText}</span></div>
                        <div className="sam_actions"><button onClick={handleManualRefresh} className="sam_btn sam_btn_secondary">Refresh UI</button><button onClick={() => setShowInterface(false)} className="sam_btn sam_btn_secondary">Close</button></div>
                    </div>
                </div>
            </Draggable>
        </div>
    );

    return (
        <>
            {extensionsContainer && ReactDOM.createPortal(drawerContent, extensionsContainer)}
            {showInterface && portalContainer && ReactDOM.createPortal(modalContent, portalContainer)}
        </>
    );
}

export default App;
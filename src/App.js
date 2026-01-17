import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import Draggable from 'react-draggable';
import JSONEditor from 'react-json-editor-ajrm';
import locale from 'react-json-editor-ajrm/locale/en'; // 注意：JSON编辑器本身的地域化可能需要额外处理，这里保持'en'以确保功能正常
import backend, {
    sam_get_data,
    sam_set_data,
    sam_get_settings,
    sam_set_setting,
    sam_is_in_use,
    sam_summary,
    sam_get_status,
    checkWorldInfoActivation,
    // 新导入的函数
    sam_save_api_preset,
    sam_delete_api_preset,
    sam_get_all_api_presets,
    sam_set_active_preset,
    sam_export_all_settings,
    sam_set_all_settings
} from './backend.js';
import './App.css';

// 访问 SillyTavern 上下文和全局帮助程序
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
const SCRIPT_VERSION = "5.7.0"; // 匹配后端版本

// --- API源常量 ---
// 与 APIManager.js 和 SillyTavern 的 constants.js 匹配
const API_SOURCE_OPTIONS = [
    { value: 'custom', label: '自定义 / OpenAI 兼容' },
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

// --- 辅助组件 ---

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


// --- 子面板 ---

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
            // 保存通用插件设置
            // 已修改：保存 'data_enable' 而不是 'enabled'
            await sam_set_setting('data_enable', settings.data_enable);
            await sam_set_setting('enable_auto_checkpoint', settings.enable_auto_checkpoint);
            await sam_set_setting('auto_checkpoint_frequency', settings.auto_checkpoint_frequency);
            await sam_set_setting('skipWIAN_When_summarizing', settings.skipWIAN_When_summarizing);

            // 仅在未锁定时保存特定于状态的数据
            if (!dataLocked) {
                await onCommitData();
                toastr.success("设置和数据配置已成功保存。");
            } else {
                toastr.success("全局设置已保存。由于缺少SAM标识符，数据配置被锁定。");
            }

        } catch (e) {
            console.error(e);
            toastr.error("保存设置时出错: " + e.message);
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
                    toastr.error("解析JSON文件失败。");
                    console.error(err);
                }
            };
            reader.readAsText(file);
        }
        // 重置文件输入值以允许重新选择相同的文件
        event.target.value = null;
    };

    return (
        <div className="sam_panel_content">
            <h3 className="sam_section_title">插件配置</h3>
            <p className="sam_help_text">这些设置对扩展全局生效。</p>
            {/* 已修改：主开关的标签、值和onChange处理程序已更改 */}
            <ToggleSwitch label="启用数据/摘要功能" value={settings.data_enable} onChange={(v) => handleSettingChange('data_enable', v)} disabled={disabled} />
            <ToggleSwitch label="自动检查点" value={settings.enable_auto_checkpoint} onChange={(v) => handleSettingChange('enable_auto_checkpoint', v)} disabled={disabled} />
            <InputRow label="检查点频率" type="number" value={settings.auto_checkpoint_frequency} onChange={(v) => handleSettingChange('auto_checkpoint_frequency', v)} disabled={disabled || !settings.enable_auto_checkpoint} tooltip="如果没有发生摘要，则每X条消息保存一次当前状态。" />
            <ToggleSwitch label="摘要期间跳过世界信息/作者笔记" value={settings.skipWIAN_When_summarizing} onChange={(v) => handleSettingChange('skipWIAN_When_summarizing', v)} disabled={disabled} />

            <h3 className="sam_section_title">数据与状态配置</h3>
            <p className="sam_help_text">这些设置会保存到当前的故事状态(SAM_data)中。如果未检测到SAM标识符，则访问将被锁定。</p>
            <ToggleSwitch label="禁用数据类型突变" value={!!data.disable_dtype_mutation} onChange={(v) => handleDataChange('disable_dtype_mutation', v)} disabled={disabled || dataLocked} />
            <ToggleSwitch label="唯一标识路径" value={!!data.uniquely_identified} onChange={(v) => handleDataChange('uniquely_identified', v)} disabled={disabled || dataLocked} />

            <div className="sam_actions" style={{ marginTop: '20px' }}>
                <button onClick={handleSaveAll} className="sam_btn sam_btn_primary" disabled={disabled}>保存所有设置</button>
            </div>

            {/* [新增] 导入/导出部分 */}
            <h3 className="sam_section_title" style={{marginTop: '30px'}}>导入 / 导出</h3>
            <p className="sam_help_text">保存或加载您的扩展设置。为安全起见，API连接预设不包含在导出中。</p>
            <div className="sam_actions">
                <button onClick={onExport} className="sam_btn sam_btn_secondary" disabled={disabled}>导出设置 (JSON)</button>
                <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".json" onChange={handleFileSelected} />
                <button onClick={handleFileImportClick} className="sam_btn sam_btn_secondary" disabled={disabled}>导入设置 (JSON)</button>
            </div>
        </div>
    );
};

const FunctionEditor = ({ functions, setFunctions, onCommit, disabled, commitDisabled }) => {
    const [selectedIndex, setSelectedIndex] = useState(-1);

    const handleAdd = () => {
        if(disabled) return;
        const newFunc = { func_name: "新函数", func_params: [], func_body: "// ...", timeout: 2000, periodic: false, network_access: false, order: "normal" };
        setFunctions([...functions, newFunc]);
        setSelectedIndex(functions.length);
    };

    const handleDelete = (index) => {
        if(disabled) return;
        if (!window.confirm("确定要删除此函数吗？")) return;
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
                <div className="sam_list_header"><span>函数 (世界信息)</span><button className="sam_btn_small" onClick={handleAdd} disabled={disabled}>+</button></div>
                <ul>
                    {functions.map((f, i) => (<li key={i} className={i === selectedIndex ? 'active' : ''} onClick={() => setSelectedIndex(i)}>{f.func_name}<span className="sam_delete_icon" onClick={(e) => { e.stopPropagation(); if(!disabled) handleDelete(i); }}>×</span></li>))}
                </ul>
                <div style={{padding: '10px'}}><button className="sam_btn sam_btn_primary full_width" onClick={onCommit} disabled={disabled || commitDisabled}>保存到世界信息</button></div>
            </div>
            <div className="sam_detail_view">
                {selectedFunc ? (<div className="sam_scrollable_form">
                    <InputRow label="函数名称" value={selectedFunc.func_name} onChange={(v) => updateFunc(selectedIndex, 'func_name', v)} disabled={disabled} />
                    <div className="sam_form_row"><label className="sam_label">参数 (逗号分隔)</label><input className="sam_input" value={(selectedFunc.func_params || []).join(', ')} onChange={(e) => updateFunc(selectedIndex, 'func_params', e.target.value.split(',').map(s => s.trim()))} disabled={disabled} /></div>
                    <div className="sam_form_column"><label className="sam_label">函数体 (JS)</label><textarea className="sam_code_editor" value={selectedFunc.func_body} onChange={(e) => updateFunc(selectedIndex, 'func_body', e.target.value)} disabled={disabled} /></div>
                    <div className="sam_form_grid"><InputRow label="超时 (毫秒)" type="number" value={selectedFunc.timeout} onChange={(v) => updateFunc(selectedIndex, 'timeout', v)} disabled={disabled} /><div className="sam_form_row"><label className="sam_label">执行顺序</label><select className="sam_select" value={selectedFunc.order || 'normal'} onChange={(e) => updateFunc(selectedIndex, 'order', e.target.value)} disabled={disabled}><option value="first">最先</option><option value="normal">正常</option><option value="last">最后</option></select></div></div>
                    <div className="sam_form_grid"><ToggleSwitch label="周期性评估" value={selectedFunc.periodic} onChange={(v) => updateFunc(selectedIndex, 'periodic', v)} disabled={disabled} /><ToggleSwitch label="网络访问" value={selectedFunc.network_access} onChange={(v) => updateFunc(selectedIndex, 'network_access', v)} disabled={disabled} /></div>
                </div>) : (<div className="sam_empty_state">选择一个函数进行编辑</div>)}
            </div>
        </div>
    );
};

const RegexPanel = ({ regexes = [], setRegexes, onSave, disabled }) => {
    const [selectedIndex, setSelectedIndex] = useState(-1);

    const handleAdd = () => {
        if (disabled) return;
        const newRegex = { name: "新正则表达式", enabled: true, regex_body: "" };
        setRegexes([...regexes, newRegex]);
        setSelectedIndex(regexes.length);
    };

    const handleDelete = (index) => {
        if (disabled) return;
        if (!window.confirm("确定要删除此正则表达式吗？")) return;
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
        e.stopPropagation(); // 防止在切换时选择
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
                    <span>正则表达式过滤器</span>
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
                        保存所有正则表达式
                    </button>
                </div>
            </div>
            <div className="sam_detail_view">
                {selectedRegex ? (
                    <div className="sam_scrollable_form">
                        <InputRow label="正则名称" value={selectedRegex.name} onChange={(v) => updateRegex(selectedIndex, 'name', v)} disabled={disabled} />
                        <div className={`sam_form_column ${disabled ? 'sam_disabled' : ''}`}>
                            <label className="sam_label">正则表达式主体 (无斜杠或标志)</label>
                            <textarea className="sam_code_editor" value={selectedRegex.regex_body} onChange={(e) => updateRegex(selectedIndex, 'regex_body', e.target.value)} disabled={disabled} />
                            <p className="sam_help_text_small">例如: `\n\*.*?\*` 用于移除斜体。'g' (全局) 标志会自动添加。</p>
                        </div>
                        <ToggleSwitch label="已启用" value={selectedRegex.enabled} onChange={(v) => updateRegex(selectedIndex, 'enabled', v)} disabled={disabled} />
                    </div>
                ) : (
                    <div className="sam_empty_state">选择一个正则表达式进行编辑</div>
                )}
            </div>
        </div>
    );
};

const ConnectionsPanel = ({ presets = [], activePreset, onSave, onDelete, onSetActive, disabled }) => {
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [draft, setDraft] = useState(null);

    // [已修改] 将 proxyPassword 添加到默认预设中
    const defaultPreset = {
        name: "新预设",
        apiMode: 'custom', // 'custom' 或 'tavern'
        apiConfig: {
            source: 'custom', // 默认格式/源
            url: '',
            apiKey: '',
            proxyPassword: '', // 已添加
            model: '',
            max_tokens: 4096,
            temperature: 0.9,
            top_p: 0.9
        }
    };

    useEffect(() => {
        if (selectedIndex >= 0 && presets[selectedIndex]) {
            // 确保草稿有一个有效的apiMode，如果缺少则默认为'custom'。
            const presetData = _.cloneDeep(presets[selectedIndex]);
            if (!presetData.apiMode) {
                presetData.apiMode = 'custom';
            }
            // 确保apiConfig存在
            if (!presetData.apiConfig) {
                presetData.apiConfig = { ...defaultPreset.apiConfig };
            }
            // 确保source已设置
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
        const newName = `新预设 ${presets.length + 1}`;
        const newPreset = { ...defaultPreset, name: newName, apiConfig: {...defaultPreset.apiConfig} };
        await onSave(newPreset);
        setSelectedIndex(presets.length);
    };

    const handleDeleteClick = (index) => {
        if (disabled) return;
        const presetToDelete = presets[index];
        if (!window.confirm(`确定要删除预设 "${presetToDelete.name}" 吗？`)) return;
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
                <div className="sam_list_header"><span>API 预设</span><button className="sam_btn_small" onClick={handleAdd} disabled={disabled}>+</button></div>
                <ul>
                    {presets.map((p, i) => (
                        <li key={p.name + i} className={i === selectedIndex ? 'active' : ''} onClick={() => setSelectedIndex(i)}>
                            <div className="sam_list_item_content">
                                <span className="sam_list_item_name" title={p.name}>{p.name}{p.name === activePreset && ' (当前)'}</span>
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
                    <InputRow label="预设名称" value={draft.name} onChange={(v) => updateDraft('name', v)} disabled={disabled} />
                    
                    <div className="sam_form_row">
                        <label className="sam_label">API 模式</label>
                        <select 
                            className="sam_select" 
                            value={draft.apiMode || 'custom'} 
                            onChange={(e) => updateDraft('apiMode', e.target.value)} 
                            disabled={disabled}
                        >
                            <option value="custom">自定义连接</option>
                            <option value="tavern">Tavern 主 API</option>
                        </select>
                    </div>

                    {draft.apiMode === 'custom' ? (
                    <>
                        <p className="sam_help_text_small" style={{marginBottom:'10px'}}>
                            使用此模式可连接到独立于 SillyTavern 主设置的特定端点。
                        </p>
                        
                        <div className="sam_form_row">
                            <label className="sam_label">API 类型 / 源</label>
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
                            决定请求体如何为代理格式化 (例如, Gemini vs OpenAI)。
                        </p>

                        <InputRow 
                            label="API URL" 
                            value={draft.apiConfig.url} 
                            onChange={(v) => updateDraft('apiConfig.url', v)} 
                            disabled={disabled} 
                            placeholder="例如, http://127.0.0.1:5000/v1"
                        />
                        <InputRow 
                            label="API 密钥" 
                            type="password" 
                            value={draft.apiConfig.apiKey} 
                            onChange={(v) => updateDraft('apiConfig.apiKey', v)} 
                            disabled={disabled} 
                            placeholder="可选"
                        />
                        {/* [已修改] 添加了代理密码输入框 */}
                        <InputRow
                            label="代理密码"
                            type="password"
                            value={draft.apiConfig.proxyPassword || ''}
                            onChange={(v) => updateDraft('apiConfig.proxyPassword', v)}
                            disabled={disabled}
                            placeholder="可选，用于代理服务器身份验证"
                        />
                        <InputRow 
                            label="模型名称" 
                            value={draft.apiConfig.model} 
                            onChange={(v) => updateDraft('apiConfig.model', v)} 
                            disabled={disabled} 
                            placeholder="例如, gpt-4-turbo, gemini-pro, claude-3-opus"
                        />
                    </>
                    ) : (
                    <>
                        <p className="sam_help_text_small" style={{marginTop:'10px', color: '#888'}}>
                            此预设将使用 SillyTavern 主“AI 响应配置”面板中当前选择并激活的任何 API。
                            <br/><br/>
                            此处无需额外配置。
                        </p>
                    </>
                    )}

                    <h4 className="sam_subsection_title" style={{marginTop: '20px'}}>生成参数</h4>
                    <p className="sam_help_text_small">如果端点支持，则会发送这些参数。</p>
                    <InputRow label="最大令牌数" type="number" value={draft.apiConfig.max_tokens} onChange={(v) => updateDraft('apiConfig.max_tokens', v)} disabled={disabled} />
                    <InputRow label="温度" type="number" value={draft.apiConfig.temperature} onChange={(v) => updateDraft('apiConfig.temperature', v)} disabled={disabled} />
                    <InputRow label="Top P" type="number" value={draft.apiConfig.top_p} onChange={(v) => updateDraft('apiConfig.top_p', v)} disabled={disabled} />
                    
                    <div className="sam_actions" style={{marginTop: '20px'}}>
                        <button onClick={handleSaveClick} className="sam_btn sam_btn_primary" disabled={disabled}>保存更改</button>
                        <button onClick={() => onSetActive(draft.name)} className="sam_btn sam_btn_secondary" disabled={disabled || draft.name === activePreset}>设为摘要活动预设</button>
                    </div>

                </div>) : (<div className="sam_empty_state">选择一个预设进行编辑或添加新预设。</div>)}
            </div>
        </div>
    );
};

const SummaryLevelPanel = ({ level, summaries, onEdit, onDelete, disabled }) => {
    return (
        <div className="sam_summary_level_container">
            <h4 className="sam_summary_level_title">{level} 级摘要 ({summaries.length})</h4>
            {summaries.length === 0 ? (
                <p className="sam_empty_state_small">暂无 {level} 级摘要。</p>
            ) : (
                <div className="sam_summary_list">
                    {summaries.map((summary, index) => (
                        <div key={index} className="sam_summary_item">
                            <div className="sam_summary_item_header">
                                <span>范围: {summary.index_begin} - {summary.index_end}</span>
                                <button
                                    className="sam_delete_icon_small"
                                    onClick={() => onDelete(level, index)}
                                    disabled={disabled}
                                    title="删除此摘要"
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

const ExtensionDrawer = ({ children, title = "SAM 扩展", warning }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (<div className="inline-drawer"><div className="inline-drawer-toggle inline-drawer-header" onClick={() => setIsOpen(!isOpen)}><b>{title}</b>{warning && <span style={{marginLeft:'10px', color:'orange', fontSize:'0.8em'}}>⚠ {warning}</span>}<div className="inline-drawer-icon fa-solid fa-circle-chevron-down down" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} /></div>{isOpen && (<div className="inline-drawer-content">{children}</div>)}</div>);
};

// --- 主应用组件 ---

function App() {
    const [showInterface, setShowInterface] = useState(false);
    const [activeTab, setActiveTab] = useState('SUMMARY');

    const [draftSamData, setDraftSamData] = useState({});
    const [draftSamSettings, setDraftSamSettings] = useState({});
    const [draftFunctions, setDraftFunctions] = useState([]);

    const [draftSummaries, setDraftSummaries] = useState({ L1: [], L2: [], L3: [] });

    const [isDataReady, setIsDataReady] = useState(false);
    const [isBusy, setIsBusy] = useState(false);
    const [samStatusText, setSamStatusText] = useState("空闲");

    const [samDetected, setSamDetected] = useState(false);

    const [portalContainer, setPortalContainer] = useState(null);
    const [extensionsContainer, setExtensionsContainer] = useState(null);
    const nodeRef = useRef(null);

    // --- 世界信息函数和识别的辅助函数 ---

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
        } catch (e) { console.error("检查 SAM ID 时出错", e); return false; }
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
        } catch (e) { console.error("[SAM 前端] 从世界信息获取函数时出错", e); return []; }
    };

const saveFunctionsToWI = async (functions) => {
        if (!samDetected) {
            toastr.error("Cannot save: SAM Identifier not detected in World Info.");
            return;
        }

        const characterWIName = await TavernHelper.getCurrentCharPrimaryLorebook();
        if (!characterWIName){
            toastr.error("This character does not have a WI");
            return;
        }
        const worldInfoName = await TavernHelper.getWorldbook(characterWIName);

        if (!worldInfoName) {
            toastr.error("No World Info file associated with this character. Please create one first.");
            return;
        }

        const funcString = JSON.stringify(functions, null, 2);

        try {
            let create_new = false;
            let newIndex = 0;
            const entryData = {
                    name: SAM_FUNCTIONLIB_ID,
                    enabled: false,
                    strategy: {
                        type: "selective",
                        keys: [],
                        keys_secondary: { "logic": "and_any", "keys": [] },
                        "scan_depth": 3
                    },
                    "position": {
                        "type": "at_depth",
                        "role": "system",
                        "depth": 543,
                        "order": 543
                    },
                    content: funcString,
                    probability: 100,
                    recursion: {
                        "prevent_incoming": true,
                        "prevent_outgoing": true,
                        "delay_until": null
                    },
                    effect: { "sticky": null, "cooldown": null, "delay": null },
                    addMemo: true,
                    "matchPersonaDescription": false,
                    "matchCharacterDescription": false,
                    "matchCharacterPersonality": false,
                    "matchCharacterDepthPrompt": false,
                    "matchScenario": false,
                    "matchCreatorNotes": false,
                    "group": "",
                    "groupOverride": false,
                    "groupWeight": 100,
                    "caseSensitive": false,
                    "matchWholeWords": null,
                    "useGroupScoring": null,
                    "automationId": ""
                }
            await TavernHelper.updateWorldbookWith(characterWIName, (worldbook) => {
                const entries = worldbook;
                const entryKey = _.findKey(entries, (entry) => entry.name === SAM_FUNCTIONLIB_ID);

                if (entryKey) {
                    _.merge(entries[entryKey], entryData);
                } else {
                    while (entries[String(newIndex)]) newIndex++;
                    create_new = true;
                }
                return worldbook;
            });

            if (create_new){
                await TavernHelper.createWorldbookEntries(characterWIName, {
                        uid: newIndex, 
                        ...entryData
                    });
            }

            toastr.success("Functions saved to World Info Library.");
        } catch (e) {
            console.error(e);
            toastr.error("Failed to save functions to WI.");
        }
    };

    // --- 数据加载与刷新 ---

    const refreshData = useCallback(async (forceUpdate = false) => {
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
            console.error("[SAM 前端] 刷新错误:", e);
        }
    }, [showInterface, isDataReady]);

    // --- 事件监听器与心跳 ---

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
        eventSource.on(eventSource.MESSAGE_SWIPED, onInvalidate);

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

    // --- 处理程序 ---

    const handleManualRefresh = () => {
        if (window.confirm("刷新数据？未保存的更改将会丢失。")) {
            refreshData(true);
            toastr.info("界面已刷新。");
        }
    };

    const handleCommitData = async () => {
        if (!samDetected) { toastr.error("已锁定: 缺少 SAM 标识符。"); return; }
        try {
            const cleanData = { ...draftSamData };
            cleanData.responseSummary = draftSummaries;
            await sam_set_data(cleanData);
            toastr.success("数据已提交到状态。");
        } catch (e) { console.error(e); toastr.error("提交数据时出错: " + e.message); }
    };

    const handleCommitFunctions = async () => {
        if (!samDetected) { toastr.error("已锁定: 缺少 SAM 标识符。"); return; }
        if (window.confirm("这将覆盖世界信息中的函数库。要继续吗？")) {
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
        if (!window.confirm(`您确定要删除这个 ${level} 级摘要吗？`)) return;
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
            toastr.success("摘要设置已保存。");
        } catch (e) { console.error(e); toastr.error("保存摘要设置时出错: " + e.message); }
    };

    const handleSaveRegexSettings = async () => {
        try {
            await sam_set_setting('regexes', draftSamSettings.regexes);
            toastr.success("正则表达式设置已保存。");
        } catch (e) {
            console.error(e);
            toastr.error("保存正则表达式设置时出错: " + e.message);
        }
    };

    const handleTriggerSummary = async () => {
        if (!samDetected) { toastr.error("已锁定: 缺少 SAM 标识符。"); return; }
        if (isBusy) { toastr.warning("核心正忙。现在无法运行摘要。"); return; }
        toastr.info("正在触发手动摘要...");
        await sam_summary();
    };

    const handleJsonChange = (content) => {
        if (!samDetected) return;
        if (content.jsObject) { setDraftSamData(content.jsObject); }
    };

    const handleSaveApiPreset = async (presetData) => {
        try {
            await sam_save_api_preset(presetData.name, presetData);
            toastr.success(`预设 "${presetData.name}" 已保存。`);
            refreshData(true);
        } catch (e) {
            console.error(e);
            toastr.error("保存预设时出错: " + e.message);
        }
    };

    const handleDeleteApiPreset = async (presetName) => {
        try {
            await sam_delete_api_preset(presetName);
            toastr.info(`预设 "${presetName}" 已删除。`);
            if (draftSamSettings.summary_api_preset === presetName) {
                await sam_set_active_preset(null);
            }
            refreshData(true);
        } catch (e) {
            console.error(e);
            toastr.error("删除预设时出错: " + e.message);
        }
    };

    const handleSetActivePreset = async (presetName) => {
        try {
            await sam_set_active_preset(presetName);
            toastr.success(`"${presetName}" 现在是摘要的活动预设。`);
            refreshData(true);
        } catch (e) {
            console.error(e);
            toastr.error("设置活动预设时出错: " + e.message);
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
            toastr.success("设置已导出。");
        } catch (e) {
            console.error(e);
            toastr.error("导出设置失败。");
        }
    };

    const handleImportSettings = async (settingsObject) => {
        if (window.confirm("这将覆盖您当前的设置 (API预设除外)。您确定吗？")) {
            await sam_set_all_settings(settingsObject);
            refreshData(true);
        }
    };

    // --- 渲染 ---

    const drawerContent = (
        <ExtensionDrawer title={`SAM v${SCRIPT_VERSION}`} warning={!samDetected ? "未检测到" : null}>
            <div className="sam_drawer_controls">
                {!samDetected && (<div className="sam_warning_box">在世界信息中未找到 SAM 标识符。</div>)}
                 <button onClick={() => setShowInterface(true)} className="sam_menu_button full_width">打开配置管理器</button>
                <div className="sam_status_micro">状态: <span className={isBusy ? 'busy' : 'idle'}>{samStatusText}</span></div>
            </div>
        </ExtensionDrawer>
    );

    const modalContent = (
        <div className="sam_modal_overlay">
            <Draggable handle=".sam_modal_header" nodeRef={nodeRef}>
                <div className="sam_app_window" ref={nodeRef} style={activeTab === 'SUMMARY' ? { height: '95vh', maxHeight: '1200px' } : {}}>
                    <div className="sam_modal_header">
                        <div className="sam_header_title"><span className="sam_brand">SAM</span> 管理器<span className="sam_version"> v{SCRIPT_VERSION}</span></div>
                        <button onClick={() => setShowInterface(false)} className="sam_close_icon">✕</button>
                    </div>
                    {!samDetected && (<div className="sam_banner_error">未检测到 SAM 标识符 ({SAM_FUNCTIONLIB_ID})。修改角色数据的功能已被锁定。</div>)}
                    <div className="sam_tabs">
                        <button className={`sam_tab ${activeTab === 'SUMMARY' ? 'active' : ''}`} onClick={() => setActiveTab('SUMMARY')}>摘要</button>
                        <button className={`sam_tab ${activeTab === 'CONNECTIONS' ? 'active' : ''}`} onClick={() => setActiveTab('CONNECTIONS')}>连接</button>
                        <button className={`sam_tab ${activeTab === 'REGEX' ? 'active' : ''}`} onClick={() => setActiveTab('REGEX')}>正则</button>
                        <button className={`sam_tab ${activeTab === 'DATA' ? 'active' : ''}`} onClick={() => setActiveTab('DATA')}>数据</button>
                        <button className={`sam_tab ${activeTab === 'FUNCS' ? 'active' : ''}`} onClick={() => setActiveTab('FUNCS')}>函数</button>
                        <button className={`sam_tab ${activeTab === 'SETTINGS' ? 'active' : ''}`} onClick={() => setActiveTab('SETTINGS')}>设置</button>
                    </div>
                    <div className="sam_content_area">
                        {activeTab === 'DATA' && (
                            <div className={`sam_panel_content ${isBusy ? 'disabled' : ''}`}>
                                <h4 className="sam_panel_label">原始 JSON 状态 {isBusy ? "(已锁定 - 核心正忙)" : ""}</h4>
                                <div className="sam_json_wrapper">
                                    {isDataReady ? (<JSONEditor id="sam_json_edit" placeholder={draftSamData} onChange={handleJsonChange} locale={locale} theme="dark_vscode_tribute" height="100%" width="100%" colors={{ background: 'transparent' }} viewOnly={isBusy || !samDetected} />) : (<div className="sam_empty_state">正在加载数据...</div>)}
                                </div>
                                <div className="sam_actions" style={{marginTop: '10px'}}><button onClick={handleCommitData} className="sam_btn sam_btn_primary" disabled={isBusy || !samDetected}>提交数据更改</button></div>
                            </div>
                        )}
                        {activeTab === 'SUMMARY' && (
                            <div className="sam_panel_content full_height layout_column">
                                <div className="sam_summary_settings_section">
                                    <h3 className="sam_section_title">分层摘要配置</h3>

                                    <div className="sam_form_row" style={{ padding: '0 0 10px 0', borderBottom: '1px solid #444', marginBottom: '15px' }}>
                                        <label className="sam_label" style={{ width: 'auto', marginRight: '10px' }}>当前进度 (最后摘要的索引):</label>
                                        <span style={{ fontFamily: 'monospace', fontSize: '1.1em', fontWeight: 'bold' }}>
                                            {draftSamData.summary_progress || 0}
                                        </span>
                                    </div>

                                    <div className="sam_form_grid_3">
                                        <InputRow label="L1 频率" type="number" value={draftSamSettings.summary_levels?.L1?.frequency || ''} onChange={(v) => setDraftSamSettings(p => _.set({...p}, 'summary_levels.L1.frequency', v))} disabled={isBusy} />
                                        <InputRow label="L2 频率" type="number" value={draftSamSettings.summary_levels?.L2?.frequency || ''} onChange={(v) => setDraftSamSettings(p => _.set({...p}, 'summary_levels.L2.frequency', v))} disabled={isBusy} />
                                        <InputRow label="L3 频率" type="number" value={draftSamSettings.summary_levels?.L3?.frequency || ''} onChange={(v) => setDraftSamSettings(p => _.set({...p}, 'summary_levels.L3.frequency', v))} disabled={isBusy} />
                                    </div>
                                    <ToggleSwitch label="启用 L2 摘要" value={draftSamSettings.summary_levels?.L2?.enabled ?? true} onChange={(v) => setDraftSamSettings(p => _.set({...p}, 'summary_levels.L2.enabled', v))} disabled={isBusy} />
                                    <ToggleSwitch label="启用 L3 摘要" value={draftSamSettings.summary_levels?.L3?.enabled ?? true} onChange={(v) => setDraftSamSettings(p => _.set({...p}, 'summary_levels.L3.enabled', v))} disabled={isBusy} />

                                    <div className={`sam_form_column ${isBusy ? 'sam_disabled' : ''}`}><label className="sam_label">L2 生成提示</label><textarea className="sam_textarea_medium" value={draftSamSettings.summary_prompt || ''} onChange={(e) => setDraftSamSettings(p => ({...p, summary_prompt: e.target.value}))} disabled={isBusy} /></div>
                                    <div className={`sam_form_column ${isBusy ? 'sam_disabled' : ''}`}><label className="sam_label">L3 生成提示</label><textarea className="sam_textarea_medium" value={draftSamSettings.summary_prompt_L3 || ''} onChange={(e) => setDraftSamSettings(p => ({...p, summary_prompt_L3: e.target.value}))} disabled={isBusy} /></div>
                                    <div className="sam_actions"><button onClick={handleSaveSummarySettings} className="sam_btn sam_btn_primary" disabled={isBusy}>保存配置</button><button onClick={handleTriggerSummary} className="sam_btn sam_btn_secondary" disabled={isBusy || !samDetected}>立即运行摘要</button></div>
                                </div>
                                <hr className="sam_divider" />
                                <div className="sam_summary_display_area">
                                    <SummaryLevelPanel level="L3" summaries={draftSummaries.L3 || []} onEdit={handleSummaryContentChange} onDelete={handleSummaryDelete} disabled={isBusy || !samDetected} />
                                    <SummaryLevelPanel level="L2" summaries={draftSummaries.L2 || []} onEdit={handleSummaryContentChange} onDelete={handleSummaryDelete} disabled={isBusy || !samDetected} />
                                    <SummaryLevelPanel level="L1" summaries={draftSummaries.L1 || []} onEdit={handleSummaryContentChange} onDelete={handleSummaryDelete} disabled={isBusy || !samDetected} />
                                </div>
                                <div className="sam_actions" style={{marginTop:'auto', paddingTop: '10px'}}><button onClick={handleCommitData} className="sam_btn sam_btn_primary" disabled={isBusy || !samDetected}>保存所有编辑过的摘要</button></div>
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
                        {/* 已修改：状态文本更具描述性 */}
                        <div className="sam_status_bar">状态: {samDetected ? (draftSamSettings.data_enable ? "数据活动" : "数据禁用") : "缺少ID"} | 核心状态: <span className={isBusy ? 'busy' : 'idle'}>{samStatusText}</span></div>
                        <div className="sam_actions"><button onClick={handleManualRefresh} className="sam_btn sam_btn_secondary">刷新界面</button><button onClick={() => setShowInterface(false)} className="sam_btn sam_btn_secondary">关闭</button></div>
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
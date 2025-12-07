import React, { useState, useEffect } from 'react';
import Draggable from 'react-draggable';
import JSONEditor from 'react-json-editor-ajrm';
import locale from 'react-json-editor-ajrm/locale/en';
import {
    sam_get_data,
    sam_set_data,
} from './base_var_manager.js';
import './App.css';

// FIX: Explicitly get TavernHelper from the global window scope.
// This makes the global variable available within this component's module scope.
const TavernHelper = window.TavernHelper;

function App() {
    const [samData, setSamData] = useState(null);
    const [jsonData, setJsonData] = useState({});
    const [showInterface, setShowInterface] = useState(false);

    useEffect(() => {
        if (showInterface) {
            try {
                const data = sam_get_data();
                setSamData(data);
                setJsonData(data || {}); // Ensure jsonData is an object even if data is null
            } catch (error) {
                alert(`Error fetching SAM data: ${error.message}`);
            }
        }
    }, [showInterface]);

    const handleDataChange = (data) => {
        // The editor can return an error object if the JSON is invalid, so check for jsObject
        if (data.jsObject) {
            setJsonData(data.jsObject);
        }
    };

    const handleSaveChanges = () => {
        try {
            sam_set_data(jsonData);
            alert('SAM data saved successfully!');
            setShowInterface(false); // Close the window on save
        } catch (error) {
            alert(`Error saving SAM data: ${error.message}`);
        }
    };

    const handleOpen = () => setShowInterface(true);
    const handleClose = () => setShowInterface(false); // This is our "cancel" action

    // If the interface is not shown, only render the button to open it
    if (!showInterface) {
        return <div onClick={handleOpen} className="sam_menu_button">Display SAM Interface</div>;
    }

    // If the interface is shown, render the draggable modal
    return (
        <div className="sam_modal_overlay">
            <Draggable handle=".sam_modal_header">
                <div className="sam_app_container">
                    {/* This header is the handle for dragging the window */}
                    <div className="sam_modal_header">
                        <span className="sam_modal_title">SAM INTERFACE</span>
                        <button onClick={handleClose} className="sam_close_button">X</button>
                    </div>

                    <div className="sam_modal_content">
                        <div className="sam_left_panel">
                            <div className="sam_editor_wrapper">
                                <JSONEditor
                                    id="sam-json-editor"
                                    placeholder={samData}
                                    onChange={handleDataChange}
                                    locale={locale}
                                    height="100%"
                                    width="100%"
                                    theme="dark_vscode_tribute"
                                    colors={{
                                        background: '#1a1a1a',
                                        default: '#ffffff',
                                        string: '#4dbd74',
                                        number: '#63c2de',
                                        colon: '#ffffff',
                                        keys: '#63c2de',
                                        error: '#f86c6b',
                                    }}
                                />
                            </div>
                        </div>

                        <div className="sam_right_panel">
                            <textarea className="sam_summary_input" placeholder="Enter summaries here..."></textarea>
                        </div>
                    </div>

                    <div className="sam_modal_footer">
                        <button onClick={handleClose} className="sam_cancel_button">CANCEL</button>
                        <button onClick={handleSaveChanges} className="sam_save_button">COMMIT CHANGES</button>
                    </div>
                </div>
            </Draggable>
        </div>
    );
}

export default App;
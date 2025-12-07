import React, { useState, useEffect } from 'react';
import JSONEditor from 'react-json-editor-ajrm';
import locale from 'react-json-editor-ajrm/locale/en';
import {
    sam_get_data,
    sam_set_data,
} from './base_var_manager.js';
import './App.css';

function App() {
    const [samData, setSamData] = useState(null);
    const [jsonData, setJsonData] = useState({});
    const [showInterface, setShowInterface] = useState(false);

    // Fetch data only when the interface is opened
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

    const handleOpen = () => {
        setShowInterface(true);
    };

    const handleClose = () => {
        setShowInterface(false);
    };

    // If the interface is not shown, only render the button to open it
    if (!showInterface) {
        return (
            <div onClick={handleOpen} className="sam_menu_button">
                Display SAM Interface
            </div>
        );
    }

    // If the interface is shown, render the modal
    return (
        <div className="sam_modal_overlay">
            <div className="sam_app_container">
                <button onClick={handleClose} className="sam_close_button">X</button>

                <div className="sam_left_panel">
                    <h3>SAM Data Editor</h3>
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
                    <button onClick={handleSaveChanges} className="sam_save_button">
                        Commit Changes
                    </button>
                </div>

                <div className="sam_right_panel">
                    <h3>Summaries</h3>
                    <textarea className="sam_summary_input" placeholder="Enter summaries here..."></textarea>
                </div>
            </div>
        </div>
    );
}

export default App;
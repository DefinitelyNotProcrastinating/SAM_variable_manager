/* global SillyTavern */

import {
        sam_get_state,
        sam_get_data,
        sam_set_data,
        sam_abort_cycle,
    } from './base_var_manager.js';

function App() {



    function handleClick() {
        alert(`Hello, ${SillyTavern.getContext().name1}! current time is ${new Date().toLocaleTimeString()}`);
        try {
            const data = sam_get_data();
            alert(`SAM Data: ${JSON.stringify(data)}`);
        } catch (error) {
            alert(`Error fetching SAM data: ${error.message}`);
        }
    }


    // manage SAM data
    
    

    // manage summaries





    return (
        <div onClick={() => handleClick()} className="menu_button">
            Click me
        </div>
    );
}


export default App;

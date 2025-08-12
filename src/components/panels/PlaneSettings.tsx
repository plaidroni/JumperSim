import Panel from "../Panel";

function PlaneSettings(props) {
    return ( 
    <Panel
        title="Plane Settings"
        close={props.close}
        minimize={props.minimize}
        >

        {/** TODO: Attach functionality */}
        <div className="mainselection">
            <select className="weather-select-menu" id="plane-select">
                <option value="">-- Select a plane --</option>
                <option value="cessna-172">Cessna-172</option>
                <option value="skyvan">Skyvan</option>
                <option value="dc-9">DC-9</option>
                <option value="twin-otter">Twin Otter</option>
            </select>
        </div>
        
        <div id="plane-status">No plane selected</div>

        <div className="panel-controls">
            <button id="edit-plane-load">Edit Plane Load</button>
        </div>
    </Panel> 
    );
}

export default PlaneSettings;
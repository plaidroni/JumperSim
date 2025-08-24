import Panel from "../Panel";

function JumpSettings(props) {
    return ( 
        <Panel
            title="Jump Settings"
            close={props.close}
            minimize={props.minimize}>
            <label>
                Jump Name:
                <input
                    type="text"
                    id="jumpname"
                    placeholder="Enter jump name"
                    value="Untitled JumpSim"
                />
            </label>
            
            {/* TODO: Setup this functionality */}
            <label>
            Jump Height:
            <input
                type="number"
                id="pullAltitude"
                min="3000"
                max="18500"
                step="100"
                value="12500"
            />
            </label>
            <div className="panel-controls">
                {/* TODO: setup this functionality */}
                <button id="start-align-jumprun">Align Jumprun</button>
            </div>
        </Panel>
     );
}

export default JumpSettings;
import Panel from "../Panel";

/** TODO: Sync up location data */
function Location(props) {
    return ( 
        <Panel
            title="Location Info"
            close={props.close}
            minimize={props.minimize}>
            {/* <!-- <label for="dropzone-select">Choose a dropzone:</label> --> */}
            <div className="panel-controls">
                <div id="fetch-container">
                    <div id="dropzone-details">
                    </div>

                    {/* <!-- <button id="fetchWeather">Fetch Weather</button> --> */}
                    <label>Model: Open-Mateo.com</label>
                    <div
                        id="fetchWeather-loader"
                        className="dot-carousel"
                        style={{ "display": "none" }}
                    ></div>
                </div>
            </div>
        </Panel>
     );
}

export default Location;
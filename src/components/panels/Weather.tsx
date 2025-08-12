import Panel from "../Panel";

function Weather(props) {
    return ( 
        <Panel
            title="Weather"
            close={props.close}
            minimize={props.minimize}>
            <p>Weather info goes here</p>
        </Panel>
    );
}

export default Weather;
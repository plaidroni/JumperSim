import { useRef } from "react";
import Panel from "../Panel";

function SpeedSettings(props) {
    const planeSpeed = useRef(null);
    const bellySpeed = useRef(null);
    const freeflySpeed = useRef(null);
    
    // TODO: When these values are changed, update the simulation

    return ( 
        <Panel
            title="Speed Settings"
            minimize={props.minimize}
            close={props.close}
            >
            <label>
                Plane Speed (knots):
                <input
                    type="number"
                    id="planeSpeed"
                    min="50"
                    max="150"
                    step="1"
                    value="90"
                    ref={planeSpeed}
                />
            </label>
            <label>
                Belly Jumper Speed (ft/s):
                <input
                    type="number"
                    id="bellySpeed"
                    min="90"
                    max="150"
                    step="1"
                    value="130"
                    ref={bellySpeed}
                />
            </label>
            <label>
                Freefly Jumper Speed (ft/s):
                <input
                    type="number"
                    id="freeflySpeed"
                    min="100"
                    max="200"
                    step="1"
                    value="160"
                    ref={freeflySpeed}
                />
            </label>
        </Panel>
     );
}

// do i like how the labels are setup? answer: i'm not bothered enough to change it
export default SpeedSettings;



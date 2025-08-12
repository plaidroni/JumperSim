import Panel from "../Panel";

function Objects(props) {
    /** TODO: Populate Scene Objects on mount */
    
    return ( 
        <Panel
            title="Scene Objects"
            close={props.close}
            minimize={props.minimize}
        >        
            <p>Smile :D</p>
        </Panel> 
    );
}

export default Objects;
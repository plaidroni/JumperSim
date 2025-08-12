import Panel from "../Panel";

// TODO: make this better/functional
function Following(props) {
    return ( 
    <Panel
        title="Following"
        close={props.close}
        minimize={props.minimize}
        >
        <label id="following-label">
            You're not following anything.
          <span id="hidden-message">Check out the Scene Objects tab!</span>
        </label>

        <label id="following-id"></label>

        <div className="panel-controls">
          <button>Stop following</button>
        </div>

    </Panel> 
    );
}

export default Following;
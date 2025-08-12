import Panel from "../Panel";


function Playback(props) {
    return ( 
    <Panel
        title="Playback"
        minimize={props.minimize}
        close={props.close}
        >
        
        { /* TODO: Connect playback functionality */}
        <div className="panel-controls">
            <button id="start">⏮</button>
            <button id="rewind">⏴</button>
            <button id="playPause">▶</button>
            <button id="forward">⏵</button>
            <button id="end">⏭</button>
        </div>

        <input
          type="range"
          id="scrubber"
          min="0"
          max="250"
          value="0"
          step="0.1"
          style={{ flex: 1 }}
        />
        <span
          id="timeLabel"
          style={{ minWidth: '60px', textAlign: 'right', color: '#fff' }}>
            0.0s
        </span>
    </Panel> 
    );
}

export default Playback;
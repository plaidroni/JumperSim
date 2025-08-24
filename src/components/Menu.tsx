function Menu() {
    return ( 
    <div id="menu">
      <div id="logocontainer"></div>
      <div id="menu-items">
        <span className="logo-text">Jumper Sim</span>

        <div className="menu-item dropdown">
          <span>File</span>
          <div className="dropdown-menu">
            <div className="dropdown-item">
              <span>Save</span>
            </div>
            <div className="dropdown-item">
              <span>Load from File</span>
            </div>
            <div className="dropdown-item">
              <span>Auto-Save</span>
              <input
                type="checkbox"
                
              />
            </div>
          </div>
        </div>

        <div className="menu-item dropdown">
          <span>Edit</span>
          <div className="dropdown-menu">
            <div className="dropdown-item" >
              <span>Undo</span>
            </div>
            <div className="dropdown-item" >
              <span>Redo</span>
            </div>
          </div>
        </div>

        <div className="menu-item dropdown">
          <span>Formations</span>
          <div className="dropdown-menu">
            <div className="dropdown-item" >
              <span>Save Formation</span>
            </div>
            <div className="dropdown-item submenu">
              <span>Import Formation</span>
              <div className="dropdown-menu right">
                <div className="dropdown-item" >
                  <span>From .jump</span>
                </div>
                <div className="dropdown-item" >
                  <span>From SkydiveDesigner.app</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="menu-item dropdown">
          <span>Weather</span>
          <div className="dropdown-menu">
            <div className="dropdown-item" >
              <span>Undo</span>
            </div>
            <div className="dropdown-item" >
              <span>Redo</span>
            </div>
          </div>
        </div>
        <div className="menu-item dropdown">
          <span>View</span>
          <div className="dropdown-menu">
             <div className="dropdown-item">
              <span>Enable Trajectory Lines</span>
              <input
                type="checkbox"
                
              />
            </div>
            
          </div>
        </div>

        <div className="menu-item dropdown" id="window-submenu">
          <span>Window</span>
          <div className="dropdown-menu">
            <button className="dropdown-item" id="recenter-windows">
              <span>Re-center Windows</span>
            </button>
            <button className="dropdown-item" id="minimize-windows">
              <span>Minimize Windows</span>
            </button>
            <button className="dropdown-item" id="restore-windows">
              <span>Restore Windows</span>
            </button>
            <hr/>
            <div className="dropdown-item" id="show-weatherdata">
              <span>Weather</span>
              <input type="checkbox" name="show-weatherdata" checked/>
            </div>
            <div className="dropdown-item" id="show-location">
              <span>Location</span>
              <input type="checkbox" name="show-location" checked/>
            </div>
            <div className="dropdown-item" id="show-playback">
              <span>Playback Controls</span>
              <input type="checkbox" name="show-playback" checked/>
            </div>
            <div className="dropdown-item" id="show-formation">
              <span>Formation Settings</span>
              <input type="checkbox" name="show-formation" checked/>
            </div>
            <div className="dropdown-item" id="show-plane">
              <span>Plane Settings</span>
              <input type="checkbox" name="show-plane" checked/>
            </div>
            <div className="dropdown-item" id="show-objects">
              <span>Scene Objects</span>
              <input type="checkbox" name="show-objects" checked/>
            </div>
            <div className="dropdown-item" id="show-sim">
              <span>Jump Settings</span>
              <input type="checkbox" name="show-sim" checked/>
            </div>
           <div className="dropdown-item" id="show-jumprun">
              <span>Jump-Run Settings</span>
              <input type="checkbox" name="show-jumprun" checked/>
            </div> 
            <div className="dropdown-item" id="show-speed">
              <span>Speed Settings</span>
              <input type="checkbox" name="show-speed" checked/>
            </div>
            <div className="dropdown-item" id="show-following">
              <span>Following</span>
              <input type="checkbox" name="show-following" checked/>
            </div>
          </div>
        </div>
        <div className="menu-item dropdown">
          <span>Help</span>
          <div className="dropdown-menu">
            <div className="dropdown-item" >
              <span>Information</span>
            </div>
          </div>
        </div>
        <div className="menu-item dropdown">
          <span>Contributors</span>
          <div className="dropdown-menu" style={{ gap: '10px' }}>
            <span>Sevan Evans B-63914</span>
            <span>Cole Patterson</span>
            <span>Alex Olsen</span>
          </div>
        </div>

        <div className="mainselection">
          <select className="weather-select-menu" id="dropzone-select">
            <option value="">-- Select a dropzone --</option>
        </select>
        </div>
        
        </div>
      </div>
    );
}

export default Menu;
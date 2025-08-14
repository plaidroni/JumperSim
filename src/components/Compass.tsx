
// props is likely rotation/yaw
function Compass(props) {
    return (
    <div id="compassContainer" style={{ position: 'absolute', margin: '3rem'}}>
      <img src="./src/svg/compass.svg" alt="Compass" id="compass" />
    </div> );
}

export default Compass;
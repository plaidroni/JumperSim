function PanelTab({ title, maximize, close }) {
    return ( 
        <div className="minimized-tab" onClick={maximize}>
            <p>{ title }</p>
            <button onClick={close}>x</button>
        </div>
     );
}

export default PanelTab;
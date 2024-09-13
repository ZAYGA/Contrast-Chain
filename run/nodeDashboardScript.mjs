console.log('run/nodeDashboardScript.mjs');

let ws;
const reconnectInterval = 5000;
let pingInterval;

function connect() {
    ws = new WebSocket('ws://localhost:3000');
  
    ws.onopen = function() {
        console.log('Connection opened');
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => { ws.send(JSON.stringify({ type: 'get_node_info', data: Date.now() })); }, 1000);
    };
    ws.onclose = function() {
        console.info('Connection closed');
        clearInterval(pingInterval);
        setTimeout(connect, reconnectInterval); // retry connection
    };
    ws.onerror = function(error) { console.info('WebSocket error: ' + error); };
  
    ws.onmessage = function(event) {
        const message = JSON.parse(event.data);
        const data = message.data;
        switch (message.type) {
            case 'node_info':
                displayNodeInfo(data);
                break;
            default:
                break;
        }
    
        if (data.utxoCache && data.utxoCache.addressesUTXOs) {
            displayUTXOs(data.utxoCache);
        }
    };
}
connect();

const eHTML = {
    dashboard: document.getElementById('dashboard'),
    address: document.getElementById('address'),
    roles: document.getElementById('roles'),
    currentHeight: document.getElementById('currentHeight'),
}

function displayNodeInfo(data) {
    const nodeInfo = {
        address: data.address,
        roles: data.roles.join(' - '),
        currentHeight: data.currentHeight,
        blockCandidate: data.blockCandidate
    };

    eHTML.address.textContent = nodeInfo.address;
    eHTML.roles.textContent = nodeInfo.roles;
    eHTML.currentHeight.textContent = nodeInfo.currentHeight;
}

function createAddressesUTXOLine(address, amount, anchor, rule) {
    const line = document.createElement('li');
    line.classList.add('utxoLine');
    // add div for each element
    const addressDiv = document.createElement('div');
    addressDiv.style.width = '220px';
    addressDiv.textContent = address;
    line.appendChild(addressDiv);

    const amountDiv = document.createElement('div');
    amountDiv.style.width = '140px';
    amountDiv.textContent = amount;
    line.appendChild(amountDiv);

    const anchorDiv = document.createElement('div');
    anchorDiv.style.width = '160px';
    anchorDiv.textContent = anchor;
    line.appendChild(anchorDiv);

    const ruleDiv = document.createElement('div');
    ruleDiv.textContent = rule;
    line.appendChild(ruleDiv);

    return line;
}
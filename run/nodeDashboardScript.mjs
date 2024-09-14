console.log('run/nodeDashboardScript.mjs');

import utils from '../src/utils.mjs';
/**
* @typedef {import("../src/block.mjs").BlockData} BlockData
* @typedef {import("./transaction.mjs").Transaction} Transaction
*/

let ws;
const reconnectInterval = 5000;
let pingInterval;

function connectWS() {
    ws = new WebSocket('ws://localhost:3000');
  
    ws.onopen = function() {
        console.log('Connection opened');
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => { ws.send(JSON.stringify({ type: 'get_node_info', data: Date.now() })); }, 1000);
    };
    ws.onclose = function() {
        console.info('Connection closed');
        clearInterval(pingInterval);
        setTimeout(connectWS, reconnectInterval); // retry connection
    };
    ws.onerror = function(error) { console.info('WebSocket error: ' + error); };
  
    ws.onmessage = function(event) {
        const message = JSON.parse(event.data);
        const data = message.data;
        switch (message.type) {
            case 'node_info':
                displayNodeInfo(data);
                break;
            case 'broadcast_new_candidate':
                console.log('broadcast_new_candidate', data);
                break;
            case 'broadcast_finalized_block':
                console.log('broadcast_finalized_block', data);
                break;
            case 'hash_rate_updated':
                console.log('hash_rate_updated', data);
                break;
            default:
                break;
        }
    
        if (data.utxoCache && data.utxoCache.addressesUTXOs) {
            displayUTXOs(data.utxoCache);
        }
    };
}
connectWS();

const eHTML = {
    dashboard: document.getElementById('dashboard'),
    roles: document.getElementById('roles'),

    validatorAddress: document.getElementById('validatorAddress'),
    validatorBalance: document.getElementById('validatorBalance'),
    validatorHeight: document.getElementById('validatorHeight'),

    minerAddress: document.getElementById('minerAddress'),
    minerBalance: document.getElementById('minerBalance'),
    minerHeight: document.getElementById('minerHeight'),
    hashRate: document.getElementById('hashRate'),

    minerThreads: {
        wrap: document.getElementById('minerThreadsIncrementalInput'),
        input: document.getElementById('minerThreadsIncrementalInput').getElementsByTagName('input')[0],
        decrementBtn: document.getElementById('minerThreadsIncrementalInput').getElementsByTagName('button')[0],
        incrementBtn: document.getElementById('minerThreadsIncrementalInput').getElementsByTagName('button')[1],
    }
}

function displayNodeInfo(data) {
    console.log(`toto : ${data.minerThreads}`);
    eHTML.roles.textContent = data.roles.join(' - ')

    eHTML.validatorAddress.textContent = data.validatorAddress, // utils.addressUtils.formatAddress(data.validatorAddress, " ");
    eHTML.validatorBalance.textContent = utils.convert.number.formatNumberAsCurrency(data.validatorBalance);
    eHTML.validatorHeight.textContent = data.currentHeight;

    eHTML.minerAddress.textContent = data.minerAddress;
    eHTML.minerBalance.textContent = utils.convert.number.formatNumberAsCurrency(data.minerBalance);
    eHTML.minerHeight.textContent = data.highestBlockIndex;
    eHTML.hashRate.textContent = data.hashRate.toFixed(2);
    eHTML.minerThreads.input.value = data.minerThreads;
}

eHTML.minerThreads.input.addEventListener('change', function() {
    console.log('set_miner_threads', eHTML.minerThreads.input.value);
    ws.send(JSON.stringify({ type: 'set_miner_threads', data: eHTML.minerThreads.input.value }));
});
eHTML.minerThreads.decrementBtn.addEventListener('click', () => adjustValue(eHTML.minerThreads.input, -1));
eHTML.minerThreads.incrementBtn.addEventListener('click', () => adjustValue(eHTML.minerThreads.input, 1));

//#region FUNCTIONS -------------------------------------------------------
function adjustValue(targetInput, delta, min = 1, max = 16) {
    const currentValue = parseInt(targetInput.value);
    if (delta < 0) {
        targetInput.value = Math.max(currentValue + delta, min);
    } else {
        targetInput.value = Math.min(currentValue + delta, max);
    }
    targetInput.dispatchEvent(new Event('change'));
}
//#endregion --------------------------------------------------------------
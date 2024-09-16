console.log('run/nodeDashboardScript.mjs');

import { Transaction_Builder, UTXO } from '../src/transaction.mjs';
import { StakeReference } from '../src/vss.mjs';
import utils from '../src/utils.mjs';
/**
* @typedef {import("../src/block.mjs").BlockData} BlockData
* @typedef {import("./transaction.mjs").Transaction} Transaction
*/

let ws;
const WS_SETTINGS = {
    DOMAIN: 'localhost',
    PORT: 27269,
    RECONNECT_INTERVAL: 5000,
    GET_NODE_INFO_INTERVAL: 10000,
}
let pingInterval;
/** @type {UTXO[]} */
let validatorUTXOs = [];
let minerUTXOs = [];
function connectWS() {
    ws = new WebSocket(`ws://${WS_SETTINGS.DOMAIN}:${WS_SETTINGS.PORT}`);
  
    ws.onopen = function() {
        console.log('Connection opened');
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => { ws.send(JSON.stringify({ type: 'get_node_info', data: Date.now() })); }, WS_SETTINGS.GET_NODE_INFO_INTERVAL);
        ws.send(JSON.stringify({ type: 'get_node_info', data: Date.now() })); // do it once at the beginning
    };
    ws.onclose = function() {
        console.info('Connection closed');
        clearInterval(pingInterval);
        setTimeout(connectWS, WS_SETTINGS.RECONNECT_INTERVAL); // retry connection
    };
    ws.onerror = function(error) { console.info('WebSocket error: ' + error); };
  
    ws.onmessage = function(event) {
        const message = JSON.parse(event.data);
        const trigger = message.trigger;
        const data = message.data;
        switch (message.type) {
            case 'node_info':
                displayNodeInfo(data);
                validatorUTXOs = data.validatorUTXOs;
                minerUTXOs = data.minerUTXOs;
                break;
            case 'broadcast_new_candidate':
                console.log('broadcast_new_candidate', data);
                break;
            case 'broadcast_finalized_block':
                console.log('broadcast_finalized_block', data);
                break;
            case 'hash_rate_updated':
                if (isNaN(data)) { console.error(`hash_rate_updated: ${data} is not a number`); return; }
                eHTML.hashRate.textContent = data.toFixed(2);
                break;
            case 'balance_updated':
                if(trigger === eHTML.validatorAddress.textContent) { eHTML.validatorBalance.textContent = utils.convert.number.formatNumberAsCurrency(data); }
                if(trigger === eHTML.minerAddress.textContent) { eHTML.minerBalance.textContent = utils.convert.number.formatNumberAsCurrency(data); }
                break;
            default:
                break;
        }
    };
}
connectWS();

const eHTML = {
    dashboard: document.getElementById('dashboard'),
    roles: document.getElementById('roles'),

    validatorAddress: document.getElementById('validatorAddress'),
    validatorHeight: document.getElementById('validatorHeight'),
    validatorBalance: document.getElementById('validatorBalance'),
    validatorStaked: document.getElementById('staked'),
    stakeInput: {
        wrap: document.getElementById('stakeInputWrap'),
        input: document.getElementById('stakeInputWrap').getElementsByTagName('input')[0],
        confirmBtn: document.getElementById('stakeInputWrap').getElementsByTagName('button')[0],
    },

    minerAddress: document.getElementById('minerAddress'),
    minerHeight: document.getElementById('minerHeight'),
    minerBalance: document.getElementById('minerBalance'),
    hashRate: document.getElementById('hashRate'),

    minerThreads: {
        wrap: document.getElementById('minerThreadsIncrementalInput'),
        input: document.getElementById('minerThreadsIncrementalInput').getElementsByTagName('input')[0],
        decrementBtn: document.getElementById('minerThreadsIncrementalInput').getElementsByTagName('button')[0],
        incrementBtn: document.getElementById('minerThreadsIncrementalInput').getElementsByTagName('button')[1],
    }
}

function displayNodeInfo(data) {
    /** @type {StakeReference[]} */
    const validatorStakesReference = data.validatorStakes ? data.validatorStakes : false;
    const validatorStaked = validatorStakesReference ? validatorStakesReference.reduce((acc, stake) => acc + stake.amount, 0) : 0;
    const validatorBalance = data.validatorBalance ? data.validatorBalance : 0;
    const minerBalance = data.minerBalance ? data.minerBalance : 0;

    eHTML.roles.textContent = data.roles.join(' - ')

    eHTML.validatorAddress.textContent = data.validatorAddress ? data.validatorAddress : '', // utils.addressUtils.formatAddress(data.validatorAddress, " ");
    eHTML.validatorBalance.textContent = utils.convert.number.formatNumberAsCurrency(validatorBalance);
    eHTML.validatorHeight.textContent = data.currentHeight ? data.currentHeight : 0;
    eHTML.validatorStaked.textContent = utils.convert.number.formatNumberAsCurrency(validatorStaked);

    eHTML.minerAddress.textContent = data.minerAddress ? data.minerAddress : '',
    eHTML.minerBalance.textContent = utils.convert.number.formatNumberAsCurrency(minerBalance);
    eHTML.minerHeight.textContent = data.highestBlockIndex ? data.highestBlockIndex : 0;
    eHTML.minerThreads.input.value = data.minerThreads ? data.minerThreads : 1;
}
// not 'change' event because it's triggered by the browser when the input loses focus, not when the value changes
eHTML.stakeInput.input.addEventListener('input', () => {
    formatInputValueAsCurrency(eHTML.stakeInput.input);
    ws.send(JSON.stringify({ type: 'set_stake', data: eHTML.stakeInput.input.value }));
});
eHTML.stakeInput.confirmBtn.addEventListener('click', async () => {
    const amountToStake = parseInt(eHTML.stakeInput.input.value.replace(",","").replace(".",""));
    const validatorAddress = eHTML.validatorAddress.textContent;
    console.log(`amountToStake: ${amountToStake} | validatorAddress: ${validatorAddress}`);
    
    console.log('UTXOs', validatorUTXOs);
    const senderAccount = { address: validatorAddress, UTXOs: validatorUTXOs };
    const transaction = await Transaction_Builder.createStakingVss(senderAccount, validatorAddress, amountToStake);

    ws.send(JSON.stringify({ type: 'new_unsigned_transaction', data: transaction }));
    eHTML.stakeInput.input.value = 0;
});
eHTML.minerThreads.input.addEventListener('change', () => {
    console.log('set_miner_threads', eHTML.minerThreads.input.value);
    ws.send(JSON.stringify({ type: 'set_miner_threads', data: eHTML.minerThreads.input.value }));
});
eHTML.minerThreads.decrementBtn.addEventListener('click', () => adjustInputValue(eHTML.minerThreads.input, -1));
eHTML.minerThreads.incrementBtn.addEventListener('click', () => adjustInputValue(eHTML.minerThreads.input, 1));

//#region FUNCTIONS -------------------------------------------------------
function formatInputValueAsCurrency(input) {
    const cleanedValue = input.value.replace(",","").replace(".","");
    const intValue = parseInt(cleanedValue);
    input.value = utils.convert.number.formatNumberAsCurrency(intValue);
}
function adjustInputValue(targetInput, delta, min = 1, max = 16) {
    const currentValue = parseInt(targetInput.value);
    if (delta < 0) {
        targetInput.value = Math.max(currentValue + delta, min);
    } else {
        targetInput.value = Math.min(currentValue + delta, max);
    }
    targetInput.dispatchEvent(new Event('change'));
}
//#endregion --------------------------------------------------------------
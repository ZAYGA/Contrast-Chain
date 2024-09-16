console.log('run/explorerScript.mjs');

import { StakeReference } from '../src/vss.mjs';
import utils from '../src/utils.mjs';
import { BlockData } from '../src/block.mjs';
/**
* @typedef {import("../src/block.mjs").BlockData} BlockData
* @typedef {import("./transaction.mjs").Transaction} Transaction
*/

let ws;
const SETTINGS = {
    DOMAIN: 'localhost',
    PORT: 27270, // Observer port
    RECONNECT_INTERVAL: 5000,
    //GET_NODE_INFO_INTERVAL: 10000,
    ROLES: ['chainExplorer', 'blockExplorer']
}
let pingInterval;
function connectWS() {
    ws = new WebSocket(`ws://${SETTINGS.DOMAIN}:${SETTINGS.PORT}`);
  
    ws.onopen = function() {
        console.log('Connection opened');
        //if (pingInterval) clearInterval(pingInterval);
        //pingInterval = setInterval(() => { ws.send(JSON.stringify({ type: 'get_node_info', data: Date.now() })); }, SETTINGS.GET_NODE_INFO_INTERVAL);
        //ws.send(JSON.stringify({ type: 'get_node_info', data: Date.now() })); // do it once at the beginning
    };
    ws.onclose = function() {
        console.info('Connection closed');
        //clearInterval(pingInterval);
        setTimeout(connectWS, SETTINGS.RECONNECT_INTERVAL); // retry connection
    };
    ws.onerror = function(error) { console.info('WebSocket error: ' + error); };
  
    ws.onmessage = function(event) {
        const message = JSON.parse(event.data);
        const trigger = message.trigger;
        const data = message.data;
        switch (message.type) {
            case 'node_info':
                console.log('node_info', data);
                //displayNodeInfo(data);
                break;
            case 'last_confirmed_block':
                displayLastConfirmedBlock(data);
                break;
            case 'broadcast_new_candidate':
                console.log('broadcast_new_candidate', data);
                break;
            case 'new_block_confirmed':
                console.log('new_block_confirmed', data);
                displayLastConfirmedBlock(data);
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
    contrastBlockExplorer: document.getElementById('contrastBlockExplorer'),
    contrastExplorer: document.getElementById('contrastExplorer'),
    chainHeight: document.getElementById('chainHeight'),
    circulatingSupply: document.getElementById('circulatingSupply'),
    lastBlocktime: document.getElementById('lastBlocktime'),
}
//#region HTML ONE-SHOT FILLING -------------------------------------------
if (SETTINGS.ROLES.includes('chainExplorer')) {
    document.getElementById('maxSupply').textContent = utils.convert.number.formatNumberAsCurrency(utils.blockchainSettings.maxSupply)
    document.getElementById('targetBlocktime').textContent = `${utils.blockchainSettings.targetBlockTime / 1000}s`;
    document.getElementById('targetBlockday').textContent = `${(24 * 60 * 60) / (utils.blockchainSettings.targetBlockTime / 1000)}`;
}
if (SETTINGS.ROLES.includes('blockExplorer')) {
    const blockExplorerContent = BlockExplorerWidget.createBlockExplorerContent();
    document.getElementById('contrastBlockExplorer').appendChild(blockExplorerContent);
}
//#endregion --------------------------------------------------------------

class BlockExplorerWidget {
    constructor() {
        this.ep = 'cbe-'; // HTML class/id prefix - to avoid conflicts
    }

    static createBlockExplorerContent() {
        // create wrap
        const wrap = document.createElement('div');
        wrap.classList.add('blockExplorerWrap');

        // C magnet img on left side
        const img = document.createElement('img');
        img.src = 'img/C_magnet.png';
        img.alt = 'C magnet';
        wrap.appendChild(img);

        // create block chain wrap
        const chainWrap = document.createElement('div');
        chainWrap.classList.add('chainWrap');
        wrap.appendChild(chainWrap);

        // fill chainWrap with blocks

        return wrap;
    }
    static createChainOfBlocks(nbBlocks = 10) {
        const chain = document.createElement('div');
        chain.classList.add('chain');
        for (let i = 0; i < nbBlocks; i++) {
            const block = this.createBlockElement();
            chain.appendChild(block);
        }
        return chain;
    }
    static createBlockElement() {
        // create wrap
        const wrap = document.createElement('div');
        wrap.classList.add(`${this.ep}blockWrap`);

        // fill header with block data
        const blockIndex = document.createElement('div');
        blockIndex.classList.add(`${this.ep}blockIndex`);
        blockIndex.textContent = '#...';
        header.appendChild(blockIndex);

        // weight
        const weight = document.createElement('span');
        weight.classList.add('weight');
        weight.textContent = 'weight: ...';

        return wrap;
    }
}
class BlockChainElementsManager {
    constructor() {
        this.blocks = [];
    }

    addBlock(blockData) {
    }
}

//#region FUNCTIONS -------------------------------------------------------
/** @param {BlockData} blockHeader */
function displayLastConfirmedBlock(blockHeader) {
    // 1. contrastChainExplorer
    if (SETTINGS.ROLES.includes('chainExplorer')) {
        eHTML.chainHeight.textContent = blockHeader.index;
        eHTML.circulatingSupply.textContent = utils.convert.number.formatNumberAsCurrency(blockHeader.supply + blockHeader.coinBase);
        eHTML.lastBlocktime.textContent = `${((blockHeader.timestamp - blockHeader.posTimestamp) / 1000).toFixed(2)}s`;
    }

    // 2. contrastBlockExplorer
    if (SETTINGS.ROLES.includes('blockExplorer')) {
        eHTML.contrastBlockExplorer.innerHTML = '';
        eHTML.contrastBlockExplorer.appendChild(createBlockExplorerElement(blockHeader));
    }
}
//#endregion --------------------------------------------------------------
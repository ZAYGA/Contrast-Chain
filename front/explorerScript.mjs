console.log('run/explorerScript.mjs');

import { StakeReference } from '../src/vss.mjs';
import utils from '../src/utils.mjs';
import { BlockData } from '../src/block.mjs';
/**
* @typedef {import("../src/block.mjs").BlockHeader} BlockHeader
* @typedef {import("../src/block.mjs").BlockInfo} BlockInfo
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
            case 'last_confirmed_blocks':
                console.log('last_confirmed_block', data[data.length - 1]);
                displayLastConfirmedBlock(data[data.length - 1].header);
                for (const blockInfo of data) {
                    blockExplorerWidget.fillBlockInfo(blockInfo);
                }
                break;
            case 'broadcast_new_candidate':
                console.log('broadcast_new_candidate', data);
                break;
            case 'new_block_confirmed':
                console.log('new_block_confirmed', data);
                displayLastConfirmedBlock(data.header);
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
    contrastBlockExplorer: document.getElementById('cbe-contrastBlockExplorer'),
    contrastExplorer: document.getElementById('cbe-contrastExplorer'),
    chainHeight: document.getElementById('cbe-chainHeight'),
    circulatingSupply: document.getElementById('cbe-circulatingSupply'),
    lastBlocktime: document.getElementById('cbe-lastBlocktime'),
}
const cbeHTML = {
    chainWrap: () => { return document.getElementById('cbe-chainWrap') },
}
//#region HTML ONE-SHOT FILLING -------------------------------------------
if (SETTINGS.ROLES.includes('cbe-chainExplorer')) {
    document.getElementById('cbe-maxSupply').textContent = utils.convert.number.formatNumberAsCurrency(utils.blockchainSettings.maxSupply)
    document.getElementById('cbe-targetBlocktime').textContent = `${utils.blockchainSettings.targetBlockTime / 1000}s`;
    document.getElementById('cbe-targetBlockday').textContent = `${(24 * 60 * 60) / (utils.blockchainSettings.targetBlockTime / 1000)}`;
}
if (SETTINGS.ROLES.includes('cbe-blockExplorer')) {
    const blockExplorerContent = BlockExplorerWidget.createBlockExplorerContent();
    document.getElementById('cbe-contrastBlockExplorer').appendChild(blockExplorerContent);
}
//#endregion --------------------------------------------------------------

class BlockExplorerWidget {
    constructor(divToInjectId = 'cbe-contrastBlockExplorer') {
        this.containerDiv = document.getElementById(divToInjectId);

        /** @type {BlockChainElementsManager} */
        this.bcElmtsManager = new BlockChainElementsManager();
        this.initBlockExplorerContent(this.containerDiv);

        /** @type {BlockData[]} */
        this.blocksData = [];
    }
    /** @param {HTMLElement} element */
    initBlockExplorerContent(element) {
        const upperBackground = createHtmlElement('div', 'cbe-blockExplorerWrapUpperBackground', []);
        element.appendChild(upperBackground);

        // create wrap
        const wrap = createHtmlElement('div', 'cbe-blockExplorerWrap');
        element.appendChild(wrap);

        // C magnet img on left side
        const img = createHtmlElement('img', 'cbe-C-magnet-img');
        img.src = 'front/img/C_magnet.png';
        img.alt = 'C magnet';
        wrap.appendChild(img);

        // create block chain wrap
        const chainWrap = createHtmlElement('div', 'cbe-chainWrap');
        wrap.appendChild(chainWrap);

        // fill chainWrap with empty blocks
        this.bcElmtsManager.createChainOfEmptyBlocksUntilFillTheDiv(chainWrap);
    }
    fillBlockInfo(blockInfo) {
        this.blocksData.push(blockInfo);
        const index = this.blocksData.length - 1;
        this.bcElmtsManager.fillBlockElement(blockInfo, index);
    }
}
class BlockChainElementsManager {
    constructor() {
        this.blocksElements = [];
    }
    /** @param {HTMLElement} chainWrap @param {number} nbBlocks */
    createChainOfEmptyBlocksUntilFillTheDiv(chainWrap, nbBlocks = 10) {
        const parentRect = chainWrap.parentElement.getBoundingClientRect();
        for (let i = 0; i < nbBlocks; i++) {
            const block = BlockChainElementsManager.createEmptyBlockElement();
            this.blocksElements.push(block);
            chainWrap.appendChild(block);

            const blockRect = block.getBoundingClientRect();
            if (blockRect.left > parentRect.right) { break; }
        }
    }
    static createEmptyBlockElement() {
        // create wrap
        const wrap = createHtmlElement('div', undefined, ['cbe-blockWrap']);
        const blockSquare = createHtmlElement('div', undefined, ['cbe-blockSquare']);

        // fill header with block data
        const blockIndex = createHtmlElement('div', undefined, ['cbe-blockIndex']);
        blockIndex.textContent = '#...';
        blockSquare.appendChild(blockIndex);

        // weight
        const weight = createHtmlElement('div', undefined, ['cbe-weight']);
        weight.textContent = '... Ko';
        blockSquare.appendChild(weight);

        // time ago
        const timeAgo = createHtmlElement('div', undefined, ['cbe-timeAgo']);
        timeAgo.textContent = `~... min ago`;
        blockSquare.appendChild(timeAgo);

        // nb of tx
        const nbTx = createHtmlElement('div', undefined, ['cbe-nbTx']);
        nbTx.textContent = '... transactions';
        blockSquare.appendChild(nbTx);

        wrap.appendChild(blockSquare);
        return wrap;
    }
    /** @param {BlockInfo} blockInfo */
    fillBlockElement(blockInfo, elmntIndex = null) {
        console.log('elmntIndex', elmntIndex);
        const blockElement = elmntIndex === null ? this.getCorrespondingBlockElement(blockInfo.header.index) : this.blocksElements[elmntIndex];
        if (!blockElement || blockElement === -1) { console.error(`Block not found: ${elmntIndex === null ? blockInfo.header.index : elmntIndex}`); return; }

        const blockSquare = blockElement.querySelector('.cbe-blockSquare');
        const blockIndex = blockSquare.querySelector('.cbe-blockIndex');
        blockIndex.textContent = `#${blockInfo.header.index}`;

        const weight = blockSquare.querySelector('.cbe-weight');
        weight.textContent = `${(blockInfo.blockBytes / 1024).toFixed(2)} Ko`;

        const timeAgo = blockSquare.querySelector('.cbe-timeAgo');
        timeAgo.textContent = getTimeSinceBlockConfirmedString(blockInfo.header.timestamp);

        const nbTx = blockSquare.querySelector('.cbe-nbTx');
        nbTx.textContent = `${blockInfo.nbOfTxs} transactions`;
    }
    getCorrespondingBlockElement(blockHeight) {
        return this.blocksElements.find(block => block.index === blockHeight);
    }
}

const blockExplorerWidget = new BlockExplorerWidget();

//#region FUNCTIONS -------------------------------------------------------
function getTimeSinceBlockConfirmedString(timestamp) {
    const minuteSince = Math.floor((Date.now() - timestamp) / 60000);
    if (minuteSince >= 1) { return `~${minuteSince} min ago`; }

    const secondsSince = Math.floor((Date.now() - timestamp) / 1000);
    return `~${secondsSince} s ago`;
}
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
        
        
    }
}
function createHtmlElement(tag, id, classes = []) {
    const element = document.createElement(tag);
    if (id) { element.id = id; }
    classes.forEach(cl => element.classList.add(cl));
    return element;
}
//#endregion --------------------------------------------------------------
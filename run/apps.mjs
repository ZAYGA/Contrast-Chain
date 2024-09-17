import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

import { CallBackManager, WebSocketCallBack } from '../src/websocketCallback.mjs';
import { BlockUtils } from '../src/block.mjs';

/**
* @typedef {import("../src/account.mjs").Account} Account
* @typedef {import("../src/node.mjs").Node} Node
* @typedef {import("../src/block.mjs").BlockData} BlockData
*/


const APPS_VARS = {
    __filename: fileURLToPath(import.meta.url),
    __dirname: path.dirname( fileURLToPath(import.meta.url) ),
    __parentDirname: path.dirname( path.dirname( fileURLToPath(import.meta.url) ) ),
};

class AppStaticFncs {
    /** @param {Node} node */
    static extractPrivateNodeInfo(node) {
        const result = {
            roles: node.roles,
        };

        if (node.roles.includes('validator')) {
            const { balance, UTXOs, spendableBalance } = node.utxoCache.getBalanceSpendableAndUTXOs(node.account.address);
            node.account.setBalanceAndUTXOs(balance, UTXOs, spendableBalance);
            result.validatorAddress = node.account.address;
            result.validatorBalance = balance;
            result.validatorUTXOs = UTXOs;
            result.validatorSpendableBalance = spendableBalance;
            result.validatorStakes = node.vss.getAddressStakesInfo(node.account.address);
            result.validatorUtxos = node.account.UTXOs;
            result.currentHeight = node.blockchain.currentHeight;
        }

        if (node.roles.includes('miner')) {
            const { balance, UTXOs, spendableBalance } = node.utxoCache.getBalanceSpendableAndUTXOs(node.miner.address);
            result.minerAddress = node.miner.address;
            result.minerBalance = balance;
            result.minerUTXOs = UTXOs;
            result.minerSpendableBalance = spendableBalance;
            result.highestBlockIndex = node.miner.highestBlockIndex;
            result.minerThreads = node.miner.nbOfWorkers;
        }
        
        return result;
    }

    /** @param {Node} node */
    extractPublicNodeInfo(node) {
        const result = {
            roles: node.roles,
        };

        if (node.roles.includes('validator')) {
            result.validatorAddress = node.account.address;
            result.currentHeight = node.blockchain.currentHeight;
        }

        return result;
    }
}

export class DashboardWsApp {
    /** @param {Node} node */
    constructor(node) {
        /** @type {Node} */
        this.node = node;
        /** @type {CallBackManager} */
        this.callBackManager = new CallBackManager(node);
        /** @type {express.Application} */
        this.app = express();
        /** @type {WebSocketServer} */
        this.wss =  null;

        this.readableNow = () => { return `${new Date().toLocaleTimeString()}:${new Date().getMilliseconds()}` };
    }

    /** @param {string} domain - default 'localhost' @param {number} port - default 27269 */
    init(domain = 'localhost', port = 27269) {
        this.app.use(express.static(APPS_VARS.__parentDirname));
        this.app.get('/', (req, res) => { res.sendFile(APPS_VARS.__parentDirname + '/front/nodeDashboard.html'); });
        const server = this.app.listen(port, () => { console.log(`Server running on http://${domain}:${port}`); });
        this.wss = new WebSocketServer({ server });

        this.#initWebSocket();
        
        const callbacksModes = []; // we will add the modes related to the callbacks we want to init
        if (this.node.roles.includes('validator')) { callbacksModes.push('validatorDashboard'); }
        if (this.node.roles.includes('miner')) { callbacksModes.push('minerDashboard'); }
        this.callBackManager.initAllCallbacksOfMode(callbacksModes, this.wss.clients);
    }
    #initWebSocket() {
        this.wss.on('connection', this.#onConnection.bind(this));
    }
    #onConnection(ws) {
        console.log('Client connected');
        ws.on('close', function close() { console.log('Connection closed'); });
        //ws.on('ping', function incoming(data) { console.log('received: %s', data); });
        
        //ws.onmessage = this.onMessage(event);
        const messageHandler = (message) => { this.#onMessage(message, ws); };
        ws.on('message', messageHandler);
    }
    /** @param {Buffer} message @param {WebSocket} ws */
    async #onMessage(message, ws) {
        console.log(`[onMessage] this.node.account.address: ${this.node.account.address}`);
        const messageAsString = message.toString();
        const parsedMessage = JSON.parse(messageAsString);
        const data = parsedMessage.data;
        switch (parsedMessage.type) {
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong', data: Date.now() }));
                break;
            case 'get_node_info':
                ws.send(JSON.stringify({ type: 'node_info', data: AppStaticFncs.extractPrivateNodeInfo(this.node) }));
                break;
            case 'set_miner_threads':
                console.log(`Setting miner threads to ${data}`);
                this.node.miner.nbOfWorkers = data;
                break;
            case 'new_unsigned_transaction':
                console.log(`signing transaction ${data.id}`);
                const tx = await this.node.account.signTransaction(data);
                console.log('Broadcast transaction', data);
                const { broadcasted, pushedInLocalMempool, error } = this.node.pushTransaction(tx);

                if (error) { console.error('Error broadcasting transaction', error); return; }

                ws.send(JSON.stringify({ type: 'transaction_broadcasted', data: { broadcasted, pushedInLocalMempool } }));
                console.log('Transaction sent');
                break;
            default:
                ws.send(JSON.stringify({ type: 'error', data: 'unknown message type' }));
                break;
        }
    }
}

export class ObserverWsApp {
    /** @param {Node} node */
    constructor(node) {
        /** @type {Node} */
        this.node = node;
        /** @type {CallBackManager} */
        this.callBackManager = new CallBackManager(node);
        /** @type {express.Application} */
        this.app = express();
        /** @type {WebSocketServer} */
        this.wss =  null;

        this.readableNow = () => { return `${new Date().toLocaleTimeString()}:${new Date().getMilliseconds()}` };
    }

    /** @param {string} domain - default '0.0.0.0' @param {number} port - default 27270*/
    init(domain = '0.0.0.0', port = 27270) {
        this.app.use(express.static(APPS_VARS.__parentDirname));
        this.app.get('/', (req, res) => { res.sendFile(APPS_VARS.__parentDirname + '/front/explorer.html'); });
        const server = this.app.listen(port, () => { console.log(`Server running on http://${domain}:${port}`); });
        this.wss = new WebSocketServer({ server });

        this.#initWebSocket();
        
        if (!this.node.roles.includes('validator')) { throw new Error('ObserverWsApp must be used with a validator node'); }
        this.callBackManager.initAllCallbacksOfMode('observer', this.wss.clients);
    }
    #initWebSocket() {
        this.wss.on('connection', this.#onConnection.bind(this));
    }
    async #onConnection(ws) {
        console.log('Client connected');
        ws.on('close', function close() { console.log('Connection closed'); });
        //ws.on('ping', function incoming(data) { console.log('received: %s', data); });

        const toHeight = this.node.blockchain.currentHeight - 1 < 0 ? 0 : this.node.blockchain.currentHeight;
        const startHeight = toHeight - 2 < 0 ? 0 : toHeight - 2;
        const last5BlocksInfo = this.node.blockchain.lastBlock ? await this.node.getBlocksInfo(startHeight, toHeight) : [];
        ws.send(JSON.stringify({ type: 'last_confirmed_blocks', data: last5BlocksInfo }));
        
        const messageHandler = (message) => { this.#onMessage(message, ws); };
        ws.on('message', messageHandler);
    }
    /** @param {Buffer} message @param {WebSocket} ws */
    async #onMessage(message, ws) {
        console.log(`[onMessage] this.node.account.address: ${this.node.account.address}`);
        const messageAsString = message.toString();
        const parsedMessage = JSON.parse(messageAsString);
        const data = parsedMessage.data;
        switch (parsedMessage.type) {
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong', data: Date.now() }));
                break;
            case 'get_node_info':
                ws.send(JSON.stringify({ type: 'node_info', data: AppStaticFncs.extractNodeInfo(this.node) }));
                break;
            default:
                ws.send(JSON.stringify({ type: 'error', data: 'unknown message type' }));
                break;
        }
    }
}
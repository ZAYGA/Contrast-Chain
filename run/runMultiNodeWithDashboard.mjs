'use strict';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

import contrast from '../src/contrast.mjs';
import { NodeFactory } from '../src/node-factory.mjs';
import { CallBackManager, WebSocketCallBack } from '../src/websocketCallback.mjs';
/**
* @typedef {import("../src/account.mjs").Account} Account
* @typedef {import("../src/node.mjs").Node} Node
* @typedef {import("../src/block.mjs").BlockData} BlockData
*/

//#region NODE INITIALIZATION -------------------------------------------
async function initMultiNode(local = false, useDevArgon2 = false) {
    const wallet = new contrast.Wallet("22ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00", useDevArgon2);
    const restored = await wallet.restore();
    if (!restored) { console.error('Failed to restore wallet.'); return; }
    wallet.loadAccounts();
    const { derivedAccounts, avgIterations } = await wallet.deriveAccounts(2, "W");
    if (!derivedAccounts) { console.error('Failed to derive addresses.'); return; }
    wallet.saveAccounts();
    
    const factory = new NodeFactory();
    const listenAddress = local ? '/ip4/0.0.0.0/tcp/0' : '/ip4/0.0.0.0/tcp/7777'
    const multiNode = await factory.createNode(derivedAccounts[0], ['validator', 'miner'], {listenAddress});
    multiNode.minerAddress = derivedAccounts[1].address; // Specify or the miner address will be the same as the validator address
    multiNode.useDevArgon2 = useDevArgon2; // we remove that one ?
    await multiNode.start();
    multiNode.memPool.useDevArgon2 = useDevArgon2;

    return multiNode;
}
const multiNode = await initMultiNode(false);
console.log(`Multi node started, account : ${multiNode.account.address}`);
//#endregion ------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const __parentDirname = path.dirname(__dirname);
const app = express();
app.use(express.static(__parentDirname));
//app.use(express.static('public'));
app.get('/', (req, res) => { res.sendFile(__dirname + '/nodeDashboard.html'); });

const server = app.listen(3000, () => { console.log('Server running on http://localhost:3000'); });
const wss = new WebSocketServer({ server });
wss.on('connection', function connection(ws) {
    console.log('Client connected');

    ws.on('close', function close() { console.log('Connection closed'); });
    //ws.on('ping', function incoming(data) { console.log('received: %s', data); });

    //ws.on('message', function incoming(message) {
    ws.onmessage = async function(event) {
        const message = JSON.parse(event.data);
        const data = message.data;
        switch (message.type) {
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong', data: Date.now() }));
                break;
            case 'get_node_info':
                ws.send(JSON.stringify({ type: 'node_info', data: extractNodeInfo(multiNode) }));
                break;
            case 'set_miner_threads':
                console.log(`Setting miner threads to ${data}`);
                multiNode.miner.nbOfWorkers = data;
                break;
            case 'new_unsigned_transaction':
                console.log(`signing transaction ${data.id}`);
                const tx = await multiNode.account.signTransaction(data);
                console.log('Broadcast transaction', data);
                const { broadcasted, pushedInLocalMempool, error } = multiNode.pushTransaction(tx);

                if (error) { console.error('Error broadcasting transaction', error); return; }

                ws.send(JSON.stringify({ type: 'transaction_broadcasted', data: { broadcasted, pushedInLocalMempool } }));
                console.log('Transaction sent');
                break;
            default:
                ws.send(JSON.stringify({ type: 'error', data: 'unknown message type' }));
                break;
        }
    };
});
/** @param {Node} node */
function updateBalance(node) {
    const { spendableBalance, balance, UTXOs } = node.utxoCache.getBalanceSpendableAndUTXOs(node.account.address);
    node.account.setBalanceAndUTXOs(balance, UTXOs, spendableBalance);
}
/** @param {Node} node */
function extractNodeInfo(node) {
    updateBalance(node);
    const validatorAccountInfo = node.utxoCache.getBalanceSpendableAndUTXOs(node.account.address);
    const minerAccountInfo = node.utxoCache.getBalanceSpendableAndUTXOs(node.miner.address);
    return {
        roles: node.roles,

        // validator
        validatorAddress: node.account.address,
        validatorBalance: validatorAccountInfo.balance,
        validatorUTXOs: validatorAccountInfo.UTXOs,
        validatorSpendableBalance: validatorAccountInfo.spendableBalance,
        //validatorStake: node.vss.getAddressLegitimacy
        validatorStakes: node.vss.getAddressStakesInfo(node.account.address),
        validatorUtxos: node.account.UTXOs,
        currentHeight: node.blockchain.currentHeight,

        // miner
        minerAddress: node.miner.address,
        minerBalance: minerAccountInfo.balance,
        minerUTXOs: minerAccountInfo.UTXOs,
        minerSpendableBalance: minerAccountInfo.spendableBalance,
        highestBlockIndex: node.miner.highestBlockIndex,
        minerThreads: node.miner.nbOfWorkers,
    };
}

// CALLBACKS
const readableNow = () => { return `${new Date().toLocaleTimeString()}:${new Date().getMilliseconds()}` };
const callBackManager = new CallBackManager(multiNode, wss);
callBackManager.initAllCallbacksOfMode('dashboard');
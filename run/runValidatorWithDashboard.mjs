'use strict';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

import contrast from '../src/contrast.mjs';
import { NodeFactory } from '../src/node-factory.mjs';
/**
* @typedef {import("../src/account.mjs").Account} Account
* @typedef {import("../src/node.mjs").Node} Node
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

    const { signedTx, error } = await contrast.Transaction_Builder.createAndSignTransfer(derivedAccounts[0], 1000, 'W9bxy4aLJiQjX1kNgoAC');
    if (!error) { await multiNode.p2pBroadcast('new_transaction', signedTx); }

    return multiNode;
}
const multiNode = await initMultiNode(true);
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
    ws.onmessage = function(event) {
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
    const { spendableBalance, balance, UTXOs } = node.utxoCache.getBalanceSpendableAndUTXOs(node.miner.address);
    return {
        roles: node.roles,

        // validator
        validatorAddress: node.account.address,
        validatorBalance: node.account.balance,
        validatorSpendableBalance: node.account.spendableBalance,
        //validatorStake: node.vss.getAddressLegitimacy
        validatorUtxos: node.account.UTXOs,
        currentHeight: node.blockchain.currentHeight,

        // miner
        minerAddress: node.miner.address,
        minerBalance: balance,
        minerSpendableBalance: spendableBalance,
        minerUtxos: UTXOs,
        highestBlockIndex: node.miner.highestBlockIndex,
        hashRate: node.miner.hashRate,
        minerThreads: node.miner.nbOfWorkers,
    };
}

// CALLBACKS
const nodeCallbacks = {
    digestFinalizedBlock: (finalizedBlock) => {
        wss.clients.forEach(function each(client) {
            if (client.readyState !== 1) { return; }
            client.send(JSON.stringify({ type: 'broadcast_new_candidate', data: finalizedBlock }));
        });
    },
}
const minerCallbacks = {
    broadcastFinalizedBlock: (finalizedBlock) => {
        wss.clients.forEach(function each(client) {
            if (client.readyState !== 1) { return; }
            client.send(JSON.stringify({ type: 'broadcast_finalized_block', data: finalizedBlock }));
        });
    },
    hashRateUpdated: (hashRate = 0) => {
        wss.clients.forEach(function each(client) {
            if (client.readyState !== 1) { return; }
            client.send(JSON.stringify({ type: 'hash_rate_updated', data: hashRate }));
        });
    },
}

for (const [key, value] of Object.entries(nodeCallbacks)) {
    multiNode.callbacks[key] = value;
}
for (const [key, value] of Object.entries(minerCallbacks)) {
    if (!multiNode.miner) { continue; }
    multiNode.miner.callbacks[key] = value;
}
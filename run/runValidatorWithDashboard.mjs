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
    const { derivedAccounts, avgIterations } = await wallet.deriveAccounts(1, "W");
    if (!derivedAccounts) { console.error('Failed to derive addresses.'); return; }
    wallet.saveAccounts();
    
    const factory = new NodeFactory();
    const listenAddress = local ? '/ip4/0.0.0.0/tcp/0' : '/ip4/0.0.0.0/tcp/7777'
    const multiNode = await factory.createNode(derivedAccounts[0], ['validator', 'miner'], {listenAddress});
    await multiNode.start();
    multiNode.useDevArgon2 = useDevArgon2;
    multiNode.memPool.useDevArgon2 = useDevArgon2;

    return multiNode;
}
const multiNode = await initMultiNode(true);
console.log(`Multi node started, account : ${multiNode.account.address}`);
//#endregion ------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(express.static(__dirname));
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
            default:
                ws.send(JSON.stringify({ type: 'error', data: 'unknown message type' }));
                break;
        }
    };
});
/** @param {Node} node */
function extractNodeInfo(node) {
    return {
        address: node.account.address,
        roles: node.roles,
        //memPool: node.memPool,
        //utxoCache: node.utxoCache,
        currentHeight: node.blockchain.currentHeight,
        blockCandidate: node.blockCandidate
    };
}

/*

            wss.clients.forEach(function each(client) { // wss broadcast - utxoCache
                if (client.readyState === 1) {
                    client.send(JSON.stringify({ utxoCache: validatorNode.utxoCache }));
                }
            });*/

                    // wss broadcast - mempool
        /*if (validatorNode.blockCandidate.index > lastBlockIndexAndTime.index) { // new block only
            wss.clients.forEach(function each(client) {
                if (client.readyState === 1) {
                    client.send(JSON.stringify({ memPool: validatorNode.memPool }));
                }
            });
        }*/
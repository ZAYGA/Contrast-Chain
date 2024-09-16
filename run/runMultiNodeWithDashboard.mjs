'use strict';
import { DashboardWsApp } from './apps.mjs';

import contrast from '../src/contrast.mjs';
import { NodeFactory } from '../src/node-factory.mjs';
import { CallBackManager, WebSocketCallBack } from '../src/websocketCallback.mjs';
/**
* @typedef {import("../src/account.mjs").Account} Account
* @typedef {import("../src/node.mjs").Node} Node
*/

//#region NODE INITIALIZATION -------------------------------------------
const nodePrivateKey = "22ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00";
async function initMultiNode(local = false, useDevArgon2 = false) {
    const wallet = new contrast.Wallet(nodePrivateKey, useDevArgon2);
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

// DASHBOARD APP INITIALIZATION -----------------------------------------
const dashboardWsApp = new DashboardWsApp(multiNode);
dashboardWsApp.init('localhost', 27269);
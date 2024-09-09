import contrast from '../src/contrast.mjs';
import { NodeFactory } from '../src/node-factory.mjs';

/**
* @typedef {import("../src/account.mjs").Account} Account
* @typedef {import("../src/node.mjs").Node} Node
*/

/** @param {Node[]} nodes */
async function waitForP2PNetworkReady(nodes, maxAttempts = 30, interval = 1000) {
    console.log('Waiting for P2P network to initialize...');
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const allNodesConnected = nodes.every(node => {
            const peerCount = node.p2pNetwork.getConnectedPeers().length;
            return peerCount >= 1; // We only need one connection in this test
        });

        if (allNodesConnected) { console.log('P2P network is ready'); return; }

        await new Promise(resolve => setTimeout(resolve, interval));
    }

    throw new Error('P2P network failed to initialize within the expected time');
}
async function main() {
    const useDevArgon2 = false;
    const wallet = new contrast.Wallet("00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00", useDevArgon2);
    const restored = await wallet.restore();
    if (!restored) { console.error('Failed to restore wallet.'); return; }

    wallet.loadAccounts();
    const { derivedAccounts, avgIterations } = await wallet.deriveAccounts(1, "W");
    if (!derivedAccounts) { console.error('Failed to derive addresses.'); return; }
    wallet.saveAccounts();
    
    const factory = new NodeFactory();
    const validatorNode = await factory.createNode(derivedAccounts[0], 'validator');
    validatorNode.useDevArgon2 = useDevArgon2;
    validatorNode.memPool.useDevArgon2 = useDevArgon2;
    await validatorNode.start();
    console.log('Validator node started');

    await waitForP2PNetworkReady([validatorNode]);
    
    while (true) { await new Promise(resolve => setTimeout(resolve, 1000)); }
}

main().catch(console.error);
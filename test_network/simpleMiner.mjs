import contrast from '../src/contrast.mjs';
import { NodeFactory } from '../src/node-factory.mjs';

/**
* @typedef {import("../src/account.mjs").Account} Account
* @typedef {import("../src/node.mjs").Node} Node
*/

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
    const minerNode = await factory.createNode(derivedAccounts[0], 'miner', {listenAddress: '/ip4/0.0.0.0/tcp/7777'});
    minerNode.useDevArgon2 = useDevArgon2;
    minerNode.memPool.useDevArgon2 = useDevArgon2;
    await minerNode.start();
    console.log('Miner node started');

    while (true) { await new Promise(resolve => setTimeout(resolve, 1000)); }
}

main().catch(console.error);
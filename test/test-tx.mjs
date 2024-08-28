import assert from 'assert';
import { NodeManager } from '../core/node-manager.mjs';
import Transaction from '../core/transaction.mjs';

describe('Transaction to Block Inclusion Test', function() {
    let nodeManager, node, senderAccount, receiverAccount, miner, validator;

    before(async function() {
        this.timeout(10000);
        nodeManager = new NodeManager();
        node = await nodeManager.createNode('testNode', { role: 'full' });
        validator = await nodeManager.createNode('validator', { role: 'validator' });
        miner = await nodeManager.createNode('miner', { role: 'miner' });

        const topics = ['transactions', 'block_candidate', 'mined_block', 'vssShare'];
        for (const topic of topics) {
          await nodeManager.subscribeAll(topic, () => {});
        }

        await nodeManager.connectAllNodes();
        
        // Get two accounts from the node's wallet
        const accounts = node.wallet.getAccounts();
        senderAccount = accounts[0];

        const accountsValidator = validator.wallet.getAccounts();
        receiverAccount = accountsValidator[0];
 

        // If we don't have two accounts, derive a new one
        if (!receiverAccount) {
            receiverAccount = node.wallet.deriveNewAccount();
        }
    });

    after(async function() {
        await nodeManager.shutdownAllNodes();
    });

    it('should send a transaction, include it in a block, and update balance', async function() {
        // Add initial UTXO for sender account
        const initialAmount = 100;
        const initialUtxoId = 'initial_tx_id';
        await node.blockManager.utxoManager.addUTXO(initialUtxoId, 0, {
            amount: initialAmount,
            scriptPubKey: senderAccount.address
        });

        await miner.blockManager.utxoManager.addUTXO(initialUtxoId, 0, {
            amount: initialAmount,
            scriptPubKey: senderAccount.address
        });

        await validator.blockManager.utxoManager.addUTXO(initialUtxoId, 0, {
            amount: initialAmount,
            scriptPubKey: senderAccount.address
        });

        await new Promise(resolve => setTimeout(resolve, 1000));

        // Verify initial balance
        let senderBalance = await node.blockManager.utxoManager.getBalance(senderAccount.address);
        assert.strictEqual(senderBalance, initialAmount, `Initial balance should be ${initialAmount}`);

        // Create a transaction
        const transferAmount = 50;
        const tx = new Transaction(
            [{ txid: initialUtxoId, vout: 0, scriptSig: '' }],
            [
                { amount: transferAmount, scriptPubKey: receiverAccount.address },
                { amount: initialAmount - transferAmount, scriptPubKey: senderAccount.address } // Change output
            ]
        );

        // Sign the transaction using the sender's account
        senderAccount.signTransaction(tx);

        // Send the transaction
        await node.getPubSubManager().broadcast('transactions', tx);

        // Wait for the block to be processed
        await new Promise(resolve => setTimeout(resolve, 20000));

        // Verify updated balances
        senderBalance = await validator.blockManager.utxoManager.getBalance(senderAccount.address);
        const receiverBalance = await validator.blockManager.utxoManager.getBalance(receiverAccount.address);

        assert.strictEqual(senderBalance, initialAmount - transferAmount, 
            `Sender balance should be ${initialAmount - transferAmount}`);
        assert.strictEqual(receiverBalance, transferAmount, 
            `Receiver balance should be ${transferAmount}`);
    });
});
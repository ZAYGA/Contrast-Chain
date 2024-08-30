import { expect } from 'chai';
import { NodeFactory } from '../../src/node-factory.mjs';
import { Account } from '../../src/account.mjs';
import { Transaction_Builder } from '../../src/transaction.mjs';

describe('NodeFactory', function() {
    let factory;
    let accounts;
    const mnemonicHex = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00";

    before(async function() {
        this.timeout(30000); // Increase timeout for initialization
        factory = new NodeFactory();
        accounts = await factory.initialize(mnemonicHex, 10, 'W');
    });

    it('should initialize and derive accounts', function() {
        expect(accounts).to.be.an('array').that.is.not.empty;
        expect(accounts[0]).to.be.an.instanceOf(Account);
    });

    it('should create a node', async function() {
        const result = await factory.createNode(accounts[0], accounts[1], {});
        expect(result).to.have.property('node');
        expect(result).to.have.property('nodeId');
        expect(result.node).to.have.property('miner');
        expect(result.node).to.have.property('p2pNetwork');
    });

    it('should start and stop a node', async function() {
        const { node, nodeId } = await factory.createNode(accounts[2], accounts[3], {});
        await factory.startNode(nodeId);
        expect(node.p2pNetwork.isStarted()).to.be.true;
        await factory.stopNode(nodeId);
        expect(node.p2pNetwork.isStarted()).to.be.false;
    });

    it('should broadcast a transaction', async function() {
        const { node, nodeId } = await factory.createNode(accounts[8], {});
        await factory.startNode(nodeId);
        
        // Add some UTXOs to the sender's account
        const utxo = {
            amount: 10000,
            address: accounts[8].address,
            rule: 'sig_v1',
            version: 1,
            utxoPath: '0:00000000:0'
        };
        accounts[8].UTXOs.push(utxo);
        
        // Add the UTXO to the node's UTXO cache
        node.utxoCache.UTXOsByPath[utxo.utxoPath] = utxo;
        node.utxoCache.addressesUTXOs[accounts[8].address] = [utxo];
        node.utxoCache.addressesBalances[accounts[8].address] = utxo.amount;

        const transaction = await Transaction_Builder.createTransferTransaction(accounts[8], [{ recipientAddress: accounts[9].address, amount: 1000 }]);
        const signedTx = await accounts[8].signTransaction(transaction);
        const txJSON = Transaction_Builder.getTransactionJSON(signedTx);
        
        // Mock the broadcast method to check if it's called
        let broadcastCalled = false;
        node.p2pNetwork.broadcast = async (topic, message) => {
            expect(topic).to.equal('new_transaction');
            expect(message).to.have.property('transaction', txJSON);
            broadcastCalled = true;
        };
        
        await node.broadcastTransaction(txJSON);
        expect(broadcastCalled).to.be.true;
        await factory.stopNode(nodeId);
    });
});
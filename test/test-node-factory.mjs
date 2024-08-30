import { expect } from 'chai';
import { NodeFactory } from '../src/node-factory.mjs';
import { Account } from '../src/account.mjs';
import { Transaction_Builder } from '../src/transaction.mjs';

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
        const { node, nodeId } = await factory.createNode(accounts[8], accounts[9], {});
        await factory.startNode(nodeId);
        
        const transaction = await Transaction_Builder.createTransferTransaction(accounts[8], [{ recipientAddress: accounts[9].address, amount: 1000 }]);
        const signedTx = await accounts[8].signTransaction(transaction);
        const txJSON = Transaction_Builder.getTransactionJSON(signedTx);
        
        // Mock the broadcast method to check if it's called
        node.p2pNetwork.broadcast = async (topic, message) => {
            expect(topic).to.equal('new_transaction');
            expect(message).to.have.property('transaction', txJSON);
        };
        
        await factory.broadcastTransaction(nodeId, txJSON);
        await factory.stopNode(nodeId);
    });
});
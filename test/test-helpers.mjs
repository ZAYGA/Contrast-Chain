import { expect } from 'chai';
import { BlockchainHelpers } from './helpers.mjs';
import { Account } from '../src/account.mjs';
import { Node } from '../src/node.mjs';
import utils from '../src/utils.mjs';

describe('BlockchainHelpers Integration Tests', function () {
    let helpers;

    this.timeout(30000); // Increase timeout for potentially slow operations

    before(function () {
        helpers = new BlockchainHelpers(true); // Use devArgon2 for faster tests
    });

    describe('createRandomAccount', function () {
        it('should create a random account with the specified prefix', async function () {
            const account = await helpers.createRandomAccount('W');
            expect(account).to.be.instanceOf(Account);
            expect(account.address.charAt(0)).to.equal('W');
            expect(account.address).to.have.lengthOf(20);
        });

        it('should create different accounts on subsequent calls', async function () {
            const account1 = await helpers.createRandomAccount('W');
            const account2 = await helpers.createRandomAccount('W');
            expect(account1.address).to.not.equal(account2.address);
        });
    });

    describe('createMultipleRandomAccounts', function () {
        it('should create the specified number of accounts', async function () {
            const accounts = await helpers.createMultipleRandomAccounts(3, 'W');
            expect(accounts).to.have.lengthOf(3);
            accounts.forEach(account => {
                expect(account).to.be.instanceOf(Account);
                expect(account.address.charAt(0)).to.equal('W');
                expect(account.address).to.have.lengthOf(20);
            });
        });

        it('should create unique accounts', async function () {
            const accounts = await helpers.createMultipleRandomAccounts(5, 'W');
            const uniqueAddresses = new Set(accounts.map(a => a.address));
            expect(uniqueAddresses.size).to.equal(5);
        });
    });

    describe('createNode', function () {
        it('should create a node with the specified account and roles', async function () {
            const account = await helpers.createRandomAccount('W');
            const roles = ['validator', 'miner'];
            const p2pOptions = { testOption: true };

            const node = await helpers.createNode(account, roles, p2pOptions);

            expect(node).to.be.instanceOf(Node);
            expect(node.account).to.equal(account);
            expect(node.roles).to.deep.equal(roles);
            expect(node.p2pNetwork.options.testOption).to.be.true;
        });
    });

    describe('createMultipleNodes', function () {
        it('should create the specified number of nodes with random accounts', async function () {
            const count = 3;
            const roles = ['validator'];
            const p2pOptions = {
                listenAddress: '/ip4/0.0.0.0/tcp/0',
                testOption: true
            };

            const nodes = await helpers.createMultipleNodes(count, roles, p2pOptions);

            expect(nodes).to.have.lengthOf(count);
            nodes.forEach(node => {
                expect(node).to.be.instanceOf(Node);
                expect(node.account).to.be.instanceOf(Account);
                expect(node.account.address.charAt(0)).to.equal('W');
                expect(node.roles).to.deep.equal(roles);
                expect(node.p2pNetwork.options.testOption).to.be.true;
            });

            // Check that all nodes have unique accounts
            const uniqueAddresses = new Set(nodes.map(n => n.account.address));
            expect(uniqueAddresses.size).to.equal(count);
        });
    });
});
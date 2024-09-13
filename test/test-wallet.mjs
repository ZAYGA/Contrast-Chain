import { expect } from 'chai';
import { Wallet } from '../src/wallet.mjs';
import { Account } from '../src/account.mjs';
import utils from '../src/utils.mjs';
import fs from 'fs/promises';
import path from 'path';

describe('Wallet Integration Tests', function () {
    this.timeout(30000); // Increase timeout for potentially slow cryptographic operations

    let wallet;
    const testMasterHex = 'f'.repeat(60);
    const testFolder = 'test_accounts';

    before(async function () {
        // Ensure test folder exists
        await fs.mkdir(testFolder, { recursive: true });
    });

    after(async function () {
        // Clean up test folder
        await fs.rm(testFolder, { recursive: true, force: true });
    });

    beforeEach(function () {
        wallet = new Wallet(testMasterHex, true); // Using devArgon2 for faster tests
    });

    describe('restore', function () {
        it('should return an Argon2 hash result', async function () {
            const result = await wallet.restore();
            expect(result).to.have.property('hex');
            expect(result).to.have.property('encoded');
        });
    });

    describe('deriveAccounts', function () {
        it('should derive the correct number of accounts', async function () {
            const { derivedAccounts } = await wallet.deriveAccounts(3, 'W');
            expect(derivedAccounts).to.have.length(3);
            expect(wallet.accounts.W).to.have.length(3);
            derivedAccounts.forEach(account => {
                expect(account).to.be.instanceOf(Account);
                expect(account.address).to.have.lengthOf(20);
                expect(account.address[0]).to.equal('W');
            });
        });

    });

    describe('saveAccounts and loadAccounts', function () {
        it('should save and load accounts correctly', async function () {
            await wallet.deriveAccounts(3, 'W');
            await wallet.saveAccounts();

            const newWallet = new Wallet(testMasterHex, true);
            const loaded = await newWallet.loadAccounts();

            expect(loaded).to.be.true;
            expect(newWallet.accountsGenerated.W).to.have.length(3);
            expect(newWallet.accountsGenerated.W[0]).to.have.property('address');
            expect(newWallet.accountsGenerated.W[0]).to.have.property('seedModifierHex');
        });
    });


    describe('loadOrCreateAccounts', function () {
        it('should create new accounts if none exist', async function () {
            const accounts = await wallet.loadOrCreateAccounts({
                masterHex: testMasterHex,
                useDevArgon2: true,
                nbOfAccounts: 3,
                addressPrefix: 'W'
            });

            expect(accounts).to.have.length(3);
            accounts.forEach(account => {
                expect(account).to.be.instanceOf(Account);
                expect(account.address[0]).to.equal('W');
            });
        });

        it('should load existing accounts if available', async function () {
            // First, create and save some accounts
            await wallet.deriveAccounts(3, 'W');
            await wallet.saveAccounts();

            // Now, try to load or create accounts
            const newWallet = new Wallet(testMasterHex, true);
            const loadedAccounts = await newWallet.loadOrCreateAccounts({
                masterHex: testMasterHex,
                useDevArgon2: true,
                nbOfAccounts: 3,
                addressPrefix: 'W'
            });

            expect(loadedAccounts).to.have.length(3);
            loadedAccounts.forEach(account => {
                expect(account).to.be.instanceOf(Account);
                expect(account.address[0]).to.equal('W');
            });
        });
    });
});
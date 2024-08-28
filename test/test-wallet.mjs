import { expect } from 'chai';
import sinon from 'sinon';
import { Wallet } from '../core/wallet.mjs';

describe('Wallet', function() {
  let wallet;
  let mockNetworkProvider;

  beforeEach(async function() {
    wallet = await Wallet.create('testPassword');
    mockNetworkProvider = {
      getBalance: sinon.stub().resolves(BigInt(1000000000000000000)), 
      sendTransaction: sinon.stub().resolves({ status: 'confirmed', txHash: '0x123' }),
      getLatestBlock: sinon.stub().resolves({ number: 100, hash: '0xabc' }),
      getTransactionsSince: sinon.stub().resolves([])
    };
    wallet.setNetworkProvider(mockNetworkProvider);
  });

  describe('Account Management', function() {
    it('should derive a new account', function() {
      const account = wallet.deriveNewAccount();
      expect(account).to.have.property('publicKey');
      expect(account).to.have.property('privateKey');
      expect(account).to.have.property('address');
    });

    it('should get all accounts', function() {
      const account1 = wallet.deriveNewAccount();
      const account2 = wallet.deriveNewAccount();
      const accounts = wallet.getAccounts();
      console.log('Derived accounts:', accounts);
      expect(accounts).to.have.lengthOf(2);
      expect(accounts[0]).to.deep.equal(account1);
      expect(accounts[1]).to.deep.equal(account2);
    });

    it('should get a specific account by address', function() {
      const account = wallet.deriveNewAccount();
      const retrievedAccount = wallet.getAccount(account.address);
      expect(retrievedAccount).to.deep.equal(account);
    });
  });

  describe('Balance Management', function() {
    it('should get balance for an account', async function() {
      const account = wallet.deriveNewAccount();
      const balance = await wallet.getBalance(account.address);
      expect(balance).to.equal(BigInt(1000000000000000000));
    });

    it('should update all balances', async function() {
      const account1 = wallet.deriveNewAccount();
      const account2 = wallet.deriveNewAccount();
      const balances = await wallet.updateAllBalances();
      console.log('Updated balances:', balances);
      expect(Object.keys(balances)).to.have.lengthOf(2);
      expect(balances[account1.address]).to.equal(BigInt(1000000000000000000));
      expect(balances[account2.address]).to.equal(BigInt(1000000000000000000));
    });
  });

  describe('Wallet Security', function() {
    it('should change password', async function() {
      await wallet.changePassword('testPassword', 'newPassword');
      try {
        await wallet.changePassword('testPassword', 'newPassword');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Invalid old password');
      }
    });


    it('should export and import wallet', async function() {
        const originalWallet = await Wallet.create('testPassword');
        const account1 = originalWallet.deriveNewAccount();
        const account2 = originalWallet.deriveNewAccount();
        
        console.log('Original wallet accounts:', JSON.stringify(originalWallet.getAccounts(), null, 2));
  
        const exportedData = await originalWallet.exportWallet('exportPassword');
        console.log('Exported wallet data:', exportedData);
  
        const importedWallet = await Wallet.importWallet(exportedData, 'exportPassword');
        
        console.log('Imported wallet accounts:', JSON.stringify(importedWallet.getAccounts(), null, 2));
  
        expect(importedWallet.mnemonic).to.equal(originalWallet.mnemonic);
        const importedAccounts = importedWallet.getAccounts();
        expect(importedAccounts).to.have.lengthOf(2);
        expect(importedAccounts[0].address).to.equal(account1.address);
        expect(importedAccounts[1].address).to.equal(account2.address);
      });

    it('should backup and restore wallet', function() {
      const account = wallet.deriveNewAccount();
      const backup = wallet.backupWallet();
      expect(backup).to.have.property('mnemonic');
      expect(backup).to.have.property('accounts');
      expect(backup.accounts).to.have.lengthOf(1);
      expect(backup.accounts[0]).to.equal(account.address);
    });
  });
  describe('Blockchain Interaction', function() {
    it('should estimate transaction fee', function() {
      const account = wallet.deriveNewAccount();
      const transaction = wallet.createTransaction(account.address, '0x1234567890123456789012345678901234567890', BigInt(1000000000000000000));
      const fee = wallet.estimateTransactionFee(transaction);
      expect(fee).to.be.a('bigint');
    });

    it('should sync with blockchain', async function() {
      await wallet.syncWithBlockchain();
      expect(mockNetworkProvider.getLatestBlock.calledOnce).to.be.true;
      expect(mockNetworkProvider.getTransactionsSince.calledOnce).to.be.true;
    });
  });

  describe('Event Emission', function() {
    it('should emit events', function(done) {
      wallet.once('accountCreated', (account) => {
        expect(account).to.have.property('address');
        done();
      });
      wallet.deriveNewAccount();
    });
  });
});
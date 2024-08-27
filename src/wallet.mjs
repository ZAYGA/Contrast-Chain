import { EventEmitter } from 'events';
import crypto from 'crypto';
import bip39 from 'bip39';
import hdkey from 'hdkey';
import secp256k1 from 'secp256k1';
import bs58 from 'bs58';
import Transaction from './transaction.mjs';
import Account from './account.mjs';
import { BlockSerializer } from './serializers/block-serializer.mjs';

class Wallet extends EventEmitter {
    constructor(node, options = {}) {
        super();
        this.node = node;
        this.mnemonic = options.mnemonic || bip39.generateMnemonic();
        this.seed = bip39.mnemonicToSeedSync(this.mnemonic, options.password);
        this.hdNode = hdkey.fromMasterSeed(this.seed);
        this.accounts = new Map();
        this.lastAccountIndex = -1;
        this.transactions = new Map();
        this.lastSyncedBlock = null;
        this.serializer = new BlockSerializer();
    }

    static async create(node, password) {
        const wallet = new Wallet(node, { password });
        await wallet.initialize();
        return wallet;
    }

    static async restore(node, mnemonic, password) {
        if (!bip39.validateMnemonic(mnemonic)) {
            throw new Error('Invalid mnemonic');
        }
        const wallet = new Wallet(node, { mnemonic, password });
        await wallet.initialize();
        return wallet;
    }

    async initialize() {
        if (this.accounts.size === 0) {
            await this.deriveNewAccount();
        }
        await this.syncWithBlockchain();
    }

    async deriveNewAccount() {
        this.lastAccountIndex++;
        const path = `m/44'/60'/0'/0/${this.lastAccountIndex}`;
        const child = this.hdNode.derive(path);
        const privateKey = child.privateKey;
        const publicKey = secp256k1.publicKeyCreate(privateKey, false).slice(1);
        const address = this.generateAddress(publicKey);
        const account = new Account(
            publicKey.toString('hex'),
            privateKey.toString('hex'),
            address
        );
        this.accounts.set(address, account);
        this.emit('accountCreated', account);
        return account;
    }

    generateAddress(publicKey) {
        const hash = crypto.createHash('sha256').update(publicKey).digest();
        const ripeMd160 = crypto.createHash('ripemd160').update(hash).digest();
        const versionedPayload = Buffer.concat([Buffer.from([0x00]), ripeMd160]);
        const checksum = crypto.createHash('sha256')
            .update(crypto.createHash('sha256').update(versionedPayload).digest())
            .digest()
            .slice(0, 4);
        const binaryAddress = Buffer.concat([versionedPayload, checksum]);
        return bs58.encode(binaryAddress);
    }

    async changePassword(oldPassword, newPassword) {
        const oldSeed = bip39.mnemonicToSeedSync(this.mnemonic, oldPassword);
        if (Buffer.compare(oldSeed, this.seed) !== 0) {
            throw new Error('Invalid old password');
        }
        this.seed = bip39.mnemonicToSeedSync(this.mnemonic, newPassword);
        this.hdNode = hdkey.fromMasterSeed(this.seed);
        this.emit('passwordChanged');
    }

    getAccounts() {
        return Array.from(this.accounts.values());
    }

    getAccount(address) {
        return this.accounts.get(address);
    }

    async getBalance(address) {
        try {
            const utxos = await this.node.getUTXOs(address);
            const balance = utxos.reduce((sum, utxo) => sum + BigInt(utxo.amount), BigInt(0));
            this.emit('balanceUpdated', { address, balance: balance.toString() });
            return balance;
        } catch (error) {
            console.error(`Error fetching balance for ${address}:`, error);
            throw new Error('Failed to fetch balance');
        }
    }

    async updateAllBalances() {
        const balances = new Map();
        for (const [address] of this.accounts) {
            balances.set(address, (await this.getBalance(address)).toString());
        }
        this.emit('allBalancesUpdated', Object.fromEntries(balances));
        return balances;
    }

    async createTransaction(fromAddress, toAddress, amount, fee = BigInt(0)) {
        const account = this.getAccount(fromAddress);
        if (!account) {
            throw new Error('Account not found');
        }

        const utxos = await this.node.getUTXOs(fromAddress);
        const totalAmount = BigInt(amount) + fee;
        let inputAmount = BigInt(0);
        const inputs = [];

        for (const utxo of utxos) {
            if (inputAmount >= totalAmount) break;
            inputs.push({
                txid: utxo.txid,
                vout: utxo.vout,
                amount: BigInt(utxo.amount),
                scriptPubKey: utxo.scriptPubKey
            });
            inputAmount += BigInt(utxo.amount);
        }

        if (inputAmount < totalAmount) {
            throw new Error('Insufficient funds');
        }

        const outputs = [
            { amount: amount.toString(), scriptPubKey: toAddress }
        ];

        if (inputAmount > totalAmount) {
            outputs.push({
                amount: (inputAmount - totalAmount).toString(),
                scriptPubKey: fromAddress // Change address
            });
        }

        const transaction = new Transaction(inputs, outputs);
        transaction.sign(account.privateKey);

        return transaction;
    }

    async sendTransaction(transaction) {
        try {
            const result = await this.node.broadcastTransaction(transaction);
            this.transactions.set(transaction.txid, {
                timestamp: Date.now(),
                transaction,
                status: 'sent'
            });
            this.emit('transactionSent', { txid: transaction.txid, result });
            return result;
        } catch (error) {
            console.error('Error broadcasting transaction:', error);
            throw new Error('Failed to send transaction');
        }
    }

    getTransactionHistory(address = null) {
        if (address) {
            return Array.from(this.transactions.values()).filter(tx => 
                tx.transaction.inputs.some(input => input.scriptPubKey === address) ||
                tx.transaction.outputs.some(output => output.scriptPubKey === address)
            );
        }
        return Array.from(this.transactions.values());
    }

    async exportWallet(password) {
        const walletData = {
            mnemonic: this.mnemonic,
            accounts: Array.from(this.accounts.entries()).map(([address, account]) => ({
                publicKey: account.publicKey,
                address,
                index: this.getAccounts().indexOf(account)
            }))
        };
        const iv = crypto.randomBytes(16);
        const key = crypto.scryptSync(password, 'salt', 32);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        let encrypted = cipher.update(JSON.stringify(walletData), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const tag = cipher.getAuthTag();
        return `${iv.toString('hex')}:${encrypted}:${tag.toString('hex')}`;
    }

    static async importWallet(node, encryptedData, password) {
        const [ivHex, encrypted, tagHex] = encryptedData.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const key = crypto.scryptSync(password, 'salt', 32);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        const walletData = JSON.parse(decrypted);
        
        const wallet = new Wallet(node, { mnemonic: walletData.mnemonic, password });
        for (const accData of walletData.accounts) {
            const account = await wallet.deriveNewAccount();
            if (account.publicKey !== accData.publicKey || account.address !== accData.address) {
                throw new Error(`Wallet import failed: derived account does not match. 
                    Derived: ${account.address}, Expected: ${accData.address}`);
            }
        }
        await wallet.syncWithBlockchain();
        return wallet;
    }

    async syncWithBlockchain() {
        try {
            const latestBlock = await this.node.getLatestBlock();
            const newTransactions = await this.node.getTransactionsSince(this.lastSyncedBlock);
            this.lastSyncedBlock = this.serializer.decompressAndDeserialize(latestBlock);
            
            for (const tx of newTransactions) {
                const transaction = Transaction.fromJSON(tx);
                this.transactions.set(transaction.txid, {
                    timestamp: Date.now(),
                    transaction,
                    status: 'confirmed'
                });
            }
            
            this.emit('walletSynced', { 
                latestBlockHeight: this.lastSyncedBlock.index,
                newTransactionsCount: newTransactions.length 
            });
            
            await this.updateAllBalances();
        } catch (error) {
            console.error('Error syncing with blockchain:', error);
            throw new Error('Failed to sync with blockchain');
        }
    }

    estimateTransactionFee(transaction) {
        // This is a placeholder. In a real implementation, you'd calculate based on network conditions and transaction size
        const baseRate = BigInt(10); // satoshis per byte
        const estimatedSize = transaction.getSize();
        return baseRate * BigInt(estimatedSize);
    }
}

export { Wallet };
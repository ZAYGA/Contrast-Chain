import { HashFunctions, AsymetricFunctions } from './conCrypto.mjs';
import { Account } from './account.mjs';
import utils from './utils.mjs';
import localStorage_v1 from "../storage/local-storage-management.mjs";

export class AddressTypeInfo {
    name = '';
    description = '';
    zeroBits = 0;
    nbOfSigners = 1;
}

class generatedAccount {
    address = '';
    seedModifierHex = '';
}
export class Wallet {
    constructor(masterHex, devmode = false) {
        /** @type {string} */
        this.masterHex = masterHex; // 30 bytes - 60 chars
        /** @type {Object<string, Account[]>} */
        this.accounts = { // max accounts per type = 65 536
            W: [],
            C: [],
            S: [],
            P: [],
            U: []
        };
        /** @type {Object<string, generatedAccount[]>} */
        this.accountsGenerated = {
            W: [],
            C: [],
            S: [],
            P: [],
            U: []
        };

        this.devmode = devmode;
    }
    static async restore(mnemonicHex = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", devmode = false) {
        const argon2HashResult = await HashFunctions.Argon2(mnemonicHex, "Contrast's Salt Isnt Pepper But It Is Tasty", 27, 1024, 1, 2, 26);
        if (!argon2HashResult) { return false; }

        return new Wallet(argon2HashResult.hex, devmode);
    }
    saveAccounts() {
        const id = this.masterHex.slice(0, 6);
        const folder = this.devmode ? `accounts(dev)/${id}_accounts` : `accounts/${id}_accounts`;
        localStorage_v1.saveJSON(folder, this.accountsGenerated);
    }
    loadAccounts() {
        const id = this.masterHex.slice(0, 6);
        const folder = this.devmode ? `accounts(dev)/${id}_accounts` : `accounts/${id}_accounts`;
        const accountsGenerated = localStorage_v1.loadJSON(folder);
        if (!accountsGenerated) { return false; }

        this.accountsGenerated = accountsGenerated;
        return true;
    }
    async deriveAccounts(nbOfAccounts = 1, addressPrefix = "C") {
        const nbOfExistingAccounts = this.accounts[addressPrefix].length;
        const iterationsPerAccount = []; // used for control

        for (let i = nbOfExistingAccounts; i < nbOfAccounts; i++) {
            if (this.accountsGenerated[addressPrefix][i]) { // from saved account
                const { address, seedModifierHex } = this.accountsGenerated[addressPrefix][i];
                const keyPair = await this.#deriveKeyPair(seedModifierHex);
                const account = new Account(keyPair.pubKeyHex, keyPair.privKeyHex, address);

                iterationsPerAccount.push(1);
                this.accounts[addressPrefix].push(account);
                continue;
            }

            const { account, iterations } = await this.tryDerivationUntilValidAccount(i, addressPrefix);
            if (!account) { console.error('deriveAccounts interrupted!'); return false; }

            iterationsPerAccount.push(iterations);
            this.accounts[addressPrefix].push(account);
        }
        
        const derivedAccounts = this.accounts[addressPrefix].slice(nbOfExistingAccounts);
        if (derivedAccounts.length !== nbOfAccounts) { console.error('Failed to derive all accounts'); return false; }
        return { derivedAccounts, avgIterations: (iterationsPerAccount.reduce((a, b) => a + b, 0) / nbOfAccounts).toFixed(2) };
    }
    async tryDerivationUntilValidAccount(accountIndex = 0, desiredPrefix = "C") {
        /** @type {AddressTypeInfo} */
        const addressTypeInfo = utils.addressUtils.glossary[desiredPrefix];
        if (addressTypeInfo === undefined) { throw new Error(`Invalid desiredPrefix: ${desiredPrefix}`); }

        // To be sure we have enough iterations, but avoid infinite loop
        const maxIterations = 65_536 * (2 ** addressTypeInfo.zeroBits); // max with zeroBits(16): 65 536 * (2^16) => 4 294 967 296
        const seedModifierStart = accountIndex * maxIterations; // max with accountIndex: 65 535 * 4 294 967 296 => 281 470 681 743 360
        for (let i = 0; i < maxIterations; i++) {
            const seedModifier = seedModifierStart + i;
            const seedModifierHex = seedModifier.toString(16).padStart(12, '0'); // padStart(12, '0') => 48 bits (6 bytes), maxValue = 281 474 976 710 655
            
            try {
                const keyPair = await this.#deriveKeyPair(seedModifierHex);
                const account = await this.#deriveAccount(keyPair, desiredPrefix);
                if (account) {
                    this.accountsGenerated[desiredPrefix].push({ address: account.address, seedModifierHex });
                    return { account, iterations: i }; 
                }
            } catch (error) {
                const errorSkippingLog = ['Address does not meet the security level'];
                if (!errorSkippingLog.includes(error.message.slice(0,40))) { console.error(error.stack); }
            }
        }

        return false;
    }
    async #deriveKeyPair(seedModifierHex) {
        const seedHex = await HashFunctions.SHA256(this.masterHex + seedModifierHex);

        const keyPair = await AsymetricFunctions.generateKeyPairFromHash(seedHex);
        if (!keyPair) { throw new Error('Failed to generate key pair'); }

        return keyPair;
    }
    async #deriveAccount(keyPair, desiredPrefix = "C") {
        const argon2Fnc = this.devmode ? HashFunctions.devArgon2 : HashFunctions.Argon2;
        const addressBase58 = await utils.addressUtils.deriveAddress(argon2Fnc, keyPair.pubKeyHex);
        if (!addressBase58) { throw new Error('Failed to derive address'); }

        if (addressBase58.substring(0, 1) !== desiredPrefix) { return false; }
        
        utils.addressUtils.conformityCheck(addressBase58);
        await utils.addressUtils.securityCheck(addressBase58, keyPair.pubKeyHex);

        return new Account(keyPair.pubKeyHex, keyPair.privKeyHex, addressBase58);
    }
}
import { AsymetricFunctions } from './conCrypto.mjs';

/**
* @typedef {import("../src/transaction.mjs").Transaction} Transaction
* @typedef {import("../src/transaction.mjs").UTXO} UTXO
*/

export class Account {
    /** @type {string} */
   #privKey = '';
   /** @type {string} */
   #pubKey = '';

   constructor(pubKey = '', privKey = '', address = '') {
       this.#pubKey = pubKey;
       this.#privKey = privKey;

       /** @type {string} */
       this.address = address;
       /** @type {UTXO[]} */
       this.UTXOs = [];
       /** @type {number} */
       this.balance = 0;
   }

   /** @param {Transaction} transaction */
   async signTransaction(transaction) {
       if (typeof this.#privKey !== 'string') { throw new Error('Invalid private key'); }

       const { signatureHex } = await AsymetricFunctions.signMessage(transaction.id, this.#privKey, this.#pubKey);
       if (!Array.isArray(transaction.witnesses)) { 
        throw new Error('Invalid witnesses'); }
       if (transaction.witnesses.includes(signatureHex)) { throw new Error('Signature already included'); }

       transaction.witnesses.push(`${signatureHex}:${this.#pubKey}`);

       return transaction;
   }
   /**
    * @param {number} balance
    * @param {UTXO[]} UTXOs
    */
   setBalanceAndUTXOs(balance, UTXOs) {
       if (typeof balance !== 'number') { throw new Error('Invalid balance'); }
       if (!Array.isArray(UTXOs)) { throw new Error('Invalid UTXOs'); }

       this.balance = balance;
       this.UTXOs = UTXOs;
   }
}
import { Transaction, TransactionIO, Transaction_Builder } from './transaction.mjs';
import { AsymetricFunctions } from './conCrypto.mjs';

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
       /** @type {TransactionIO[]} */
       this.UTXOs = [];
       /** @type {number} */
       this.balance = 0;
   }

   /** @param {Transaction} transaction */
   async signAndReturnTransaction(transaction) {
       if (typeof this.#privKey !== 'string') { throw new Error('Invalid private key'); }

       const message = transaction.id
       const { signatureHex } = await AsymetricFunctions.signMessage(message, this.#privKey, this.#pubKey);
       if (!Array.isArray(transaction.witnesses)) { 
        throw new Error('Invalid witnesses'); }
       if (transaction.witnesses.includes(signatureHex)) { throw new Error('Signature already included'); }

       transaction.witnesses.push(`${signatureHex}:${this.#pubKey}`);

       return transaction;
   }
   /**
    * @param {number} balance
    * @param {TransactionIO[]} UTXOs
    */
   setBalanceAndUTXOs(balance, UTXOs) {
       if (typeof balance !== 'number') { throw new Error('Invalid balance'); }
       if (!Array.isArray(UTXOs)) { throw new Error('Invalid UTXOs'); }

       this.balance = balance;
       this.UTXOs = UTXOs;
   }
}
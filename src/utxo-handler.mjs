class UTXOHandler {
    constructor(utxoManager) {
      this.utxoManager = utxoManager;
    }
  
    async processTransaction(tx) {
      await this.removeSpentOutputs(tx);
      await this.addNewOutputs(tx);
    }
  
    async removeSpentOutputs(tx) {
      if (!tx.inputs) {
        return;
      }
      for (const input of tx.inputs) {
        await this.utxoManager.removeUTXO(input.txid, input.vout);
      }
    }
  
    async addNewOutputs(tx) {
      console.log(`Adding UTXOs for transaction ${JSON.stringify(tx)}`);
      if (!tx.outputs) {
        return;
      }

      tx.outputs.forEach((output, index) => {
        this.utxoManager.addUTXO(tx.id, index, {
          amount: output.amount,
          scriptPubKey: output.scriptPubKey
        });
      });
    }
  
    async updateUTXOSet(block) {
      console.warn(`Updating UTXO set for block ${JSON.stringify(block)}`);
      if (!block.transactions) {
        return;
      }
      for (const tx of block.transactions) {
        await this.processTransaction(tx);
      }
    }
  
    async getBalance(address) {
      let balance = 0;
      for await (const [key, utxo] of this.utxoManager.db.iterator()) {
        if (utxo.scriptPubKey === address) {
          balance += utxo.amount;
        }
      }
      return balance;
    }
  }

  export { UTXOHandler };
  
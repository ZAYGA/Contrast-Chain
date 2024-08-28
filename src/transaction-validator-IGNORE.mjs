class TransactionValidator {
    constructor(utxoManager) {
      this.utxoManager = utxoManager;
    }
  
    async isValidTransaction(tx) {
      if (this.isCoinbaseTransaction(tx)) {
        return true;
      }
      
      const inputAmount = await this.calculateInputAmount(tx);
      const outputAmount = this.calculateOutputAmount(tx);
  
      return inputAmount >= outputAmount;
    }
  
    isCoinbaseTransaction(tx) {
      // reject undefined or null tx
      if (!tx.inputs) {
        return false;
      }
      return tx.inputs.length === 0 && tx.outputs.length === 1;
    }
  
    async calculateInputAmount(tx) {
      let inputAmount = 0;

      // parse the inputs and get the UTXO
      if (!tx.inputs) {
        console.error('Invalid transaction: No inputs');
        return 0;

      }

      if (tx.inputs.length === 0) {
        console.error('Invalid transaction: No inputs');
        return 0;
      }

      for (const input of tx.inputs) {
        console.log(`Validating input ${JSON.stringify(input)}`);
        const utxo = await this.utxoManager.getUTXO(input.txid, input.vout);
        if (!utxo) {
          console.error('Invalid transaction: UTXO not found');
          return 0; // Invalid transaction if any input is not found
        }
        inputAmount += utxo.amount;
      }
      return inputAmount;
    }
  
    calculateOutputAmount(tx) {

      if (!tx.outputs) {
        return 0;
      }

      if (tx.outputs.length === 0) {
        return 0;
      }

      return tx.outputs.reduce((sum, output) => sum + output.amount, 0);
    }
}

  export { TransactionValidator };
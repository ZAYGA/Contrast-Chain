import Transaction from './transaction.mjs';

export const utils = {
  createCoinbaseTransaction(minerAddress, blockReward = 50) {
    return new Transaction([], [{
      amount: blockReward,
      scriptPubKey: minerAddress
    }]);
  },

}

